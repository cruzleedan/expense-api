import { query, transaction } from '../db/client.js';
import type { Receipt, ExpenseLine } from '../types/index.js';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../types/index.js';
import { verifyReportOwnership } from './expenseReport.service.js';
import { sha256 } from '../utils/hash.js';
import { getStorage } from '../storage/localStorage.js';
import { parseReceipt } from './receiptParser.service.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  RECEIPT_SORTABLE_FIELDS,
  RECEIPT_SEARCHABLE_FIELDS,
  type PaginationParams,
} from '../utils/pagination.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

export interface UploadReceiptInput {
  reportId: string;
  file: Buffer;
  fileName: string;
  mimeType: string;
  icr?: boolean; // Intelligent Character Recognition
}

export interface UploadReceiptResult {
  receipt: Receipt;
  parsedData?: Record<string, unknown> | null;
}

export async function uploadReceipt(
  userId: string,
  input: UploadReceiptInput
): Promise<UploadReceiptResult> {
  // Verify user owns the report
  await verifyReportOwnership(input.reportId, userId);

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(
      `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Validate file size
  if (input.file.length > env.MAX_FILE_SIZE) {
    throw new ValidationError(
      `File too large. Maximum size: ${env.MAX_FILE_SIZE / 1024 / 1024}MB`
    );
  }

  // Compute hash for deduplication
  const fileHash = sha256(input.file);

  // Check for duplicate
  const existingResult = await query<{ id: string }>(
    'SELECT id FROM receipts WHERE file_hash = $1',
    [fileHash]
  );

  if (existingResult.rows.length > 0) {
    throw new ConflictError('Duplicate receipt: this file has already been uploaded');
  }

  // Save file to storage
  const storage = getStorage();
  const filePath = await storage.save(input.file, input.fileName);

  // Create receipt record
  const result = await query<Receipt>(
    `INSERT INTO receipts (report_id, file_path, file_name, file_hash, mime_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.reportId, filePath, input.fileName, fileHash, input.mimeType, input.file.length]
  );

  const receipt = result.rows[0];
  let parsedData: Record<string, unknown> | null = null;

  // If ICR requested, parse the receipt
  if (input.icr) {
    const fullPath = `${env.UPLOAD_DIR}/${filePath}`;
    parsedData = await parseReceipt(fullPath, input.mimeType);

    if (parsedData) {
      // Update receipt with parsed data
      await query(
        'UPDATE receipts SET parsed_data = $1 WHERE id = $2',
        [JSON.stringify(parsedData), receipt.id]
      );
      receipt.parsed_data = parsedData;
    }
  }

  logger.info('Receipt uploaded', {
    receiptId: receipt.id,
    reportId: input.reportId,
    icr: input.icr,
    parsed: !!parsedData,
  });

  return { receipt, parsedData };
}

export async function getReceiptById(
  receiptId: string,
  userId: string
): Promise<Receipt> {
  const result = await query<Receipt & { user_id: string }>(
    `SELECT r.*, er.user_id
     FROM receipts r
     JOIN expense_reports er ON r.report_id = er.id
     WHERE r.id = $1`,
    [receiptId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Receipt');
  }

  const receipt = result.rows[0];

  if (receipt.user_id !== userId) {
    throw new ForbiddenError('Access denied to this receipt');
  }

  const { user_id: _, ...receiptData } = receipt;
  return receiptData as Receipt;
}

export async function listReceipts(
  reportId: string,
  userId: string,
  params: PaginationParams
): Promise<{ receipts: Receipt[]; total: number }> {
  // Verify user owns the report
  await verifyReportOwnership(reportId, userId);

  const offset = getOffset(params);
  const conditions = ['report_id = $1'];
  const values: unknown[] = [reportId];
  let paramIndex = 2;

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    RECEIPT_SEARCHABLE_FIELDS,
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.join(' AND ');

  // Build ORDER BY clause with allowed fields, default to created_at DESC
  const orderBy = buildOrderByClause(
    params,
    RECEIPT_SORTABLE_FIELDS,
    'created_at DESC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<Receipt>(
      `SELECT * FROM receipts WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM receipts WHERE ${whereClause}`,
      values
    ),
  ]);

  return {
    receipts: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function deleteReceipt(
  receiptId: string,
  userId: string
): Promise<void> {
  const receipt = await getReceiptById(receiptId, userId);

  // Delete file from storage
  const storage = getStorage();
  await storage.delete(receipt.file_path);

  // Delete from database (cascades to associations)
  await query('DELETE FROM receipts WHERE id = $1', [receiptId]);

  logger.info('Receipt deleted', { receiptId });
}

export async function associateReceiptWithLines(
  receiptId: string,
  lineIds: string[],
  userId: string
): Promise<void> {
  const receipt = await getReceiptById(receiptId, userId);

  // Verify all lines belong to the same report as the receipt
  for (const lineId of lineIds) {
    const lineResult = await query<ExpenseLine>(
      'SELECT report_id FROM expense_lines WHERE id = $1',
      [lineId]
    );

    if (lineResult.rows.length === 0) {
      throw new NotFoundError(`Expense line ${lineId}`);
    }

    if (lineResult.rows[0].report_id !== receipt.report_id) {
      throw new ValidationError(
        'Receipt can only be associated with expense lines from the same report'
      );
    }
  }

  // Use transaction to ensure atomicity
  await transaction(async (client) => {
    for (const lineId of lineIds) {
      await client.query(
        `INSERT INTO receipt_line_associations (receipt_id, line_id)
         VALUES ($1, $2)
         ON CONFLICT (receipt_id, line_id) DO NOTHING`,
        [receiptId, lineId]
      );
    }
  });

  logger.info('Receipt associated with lines', { receiptId, lineIds });
}

export async function removeReceiptLineAssociation(
  receiptId: string,
  lineId: string,
  userId: string
): Promise<void> {
  // Verify ownership
  await getReceiptById(receiptId, userId);

  await query(
    'DELETE FROM receipt_line_associations WHERE receipt_id = $1 AND line_id = $2',
    [receiptId, lineId]
  );

  logger.info('Receipt-line association removed', { receiptId, lineId });
}

export async function getReceiptAssociations(
  receiptId: string,
  userId: string
): Promise<ExpenseLine[]> {
  // Verify ownership
  await getReceiptById(receiptId, userId);

  const result = await query<ExpenseLine>(
    `SELECT el.*
     FROM expense_lines el
     JOIN receipt_line_associations rla ON el.id = rla.line_id
     WHERE rla.receipt_id = $1
     ORDER BY el.transaction_date DESC`,
    [receiptId]
  );

  return result.rows;
}

export async function getReceiptFile(
  receiptId: string,
  userId: string
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const receipt = await getReceiptById(receiptId, userId);

  const storage = getStorage();
  const buffer = await storage.get(receipt.file_path);

  return {
    buffer,
    mimeType: receipt.mime_type,
    fileName: receipt.file_name,
  };
}
