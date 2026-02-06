import { query, transaction } from '../db/client.js';
import type { Receipt, ExpenseLine } from '../types/index.js';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../types/index.js';
import { verifyReportOwnership } from './expenseReport.service.js';
import { sha256 } from '../utils/hash.js';
import { getStorage } from '../storage/localStorage.js';
import type { PresignedDownloadUrl } from '../storage/storage.interface.js';
import { parseReceipt, parseReceiptFromBuffer, type ReparseReceiptResult } from './receiptParser.service.js';
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

import type { ParsedReceiptData } from '../types/index.js';

export interface UploadReceiptResult {
  receipt: Receipt;
  parsedData?: ParsedReceiptData | null;
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
    `INSERT INTO receipts (report_id, file_path, file_name, file_hash, mime_type, file_size, thumbnail_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.reportId, filePath, input.fileName, fileHash, input.mimeType, input.file.length, null]
  );

  const receipt = result.rows[0];
  let parsedData: ParsedReceiptData | null = null;

  // TODO: Generate thumbnail for image receipts (see confirmUpload for details)

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

export interface RequestUploadUrlInput {
  reportId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface RequestUploadUrlResult {
  uploadUrl: string;
  key: string;
  expiresAt: Date;
}

export async function requestUploadUrl(
  userId: string,
  input: RequestUploadUrlInput
): Promise<RequestUploadUrlResult> {
  // Verify user owns the report
  await verifyReportOwnership(input.reportId, userId);

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(
      `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Validate file size
  if (input.fileSize > env.MAX_FILE_SIZE) {
    throw new ValidationError(
      `File too large. Maximum size: ${env.MAX_FILE_SIZE / 1024 / 1024}MB`
    );
  }

  const storage = getStorage();

  if (!storage.supportsPresignedUrls() || !storage.getPresignedUploadUrl) {
    throw new ValidationError('Storage provider does not support presigned URLs');
  }

  const presigned = await storage.getPresignedUploadUrl(input.fileName, {
    contentType: input.mimeType,
  });

  logger.info('Presigned upload URL generated', {
    reportId: input.reportId,
    key: presigned.key,
  });

  return {
    uploadUrl: presigned.url,
    key: presigned.key,
    expiresAt: presigned.expiresAt,
  };
}

export interface ConfirmUploadInput {
  reportId: string;
  key: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  icr?: boolean;
}

export async function confirmUpload(
  userId: string,
  input: ConfirmUploadInput
): Promise<UploadReceiptResult> {
  // Verify user owns the report
  await verifyReportOwnership(input.reportId, userId);

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(
      `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Check for duplicate by hash
  const existingResult = await query<{ id: string }>(
    'SELECT id FROM receipts WHERE file_hash = $1',
    [input.fileHash]
  );

  if (existingResult.rows.length > 0) {
    // Delete the uploaded file since it's a duplicate
    const storage = getStorage();
    await storage.delete(input.key);
    throw new ConflictError('Duplicate receipt: this file has already been uploaded');
  }

  // Verify file exists in storage
  const storage = getStorage();
  const exists = await storage.exists(input.key);
  if (!exists) {
    throw new ValidationError('File not found in storage. Upload may have failed.');
  }

  // Create receipt record
  const result = await query<Receipt>(
    `INSERT INTO receipts (report_id, file_path, file_name, file_hash, mime_type, file_size, thumbnail_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.reportId, input.key, input.fileName, input.fileHash, input.mimeType, input.fileSize, null]
  );

  const receipt = result.rows[0];
  let parsedData: ParsedReceiptData | null = null;

  // TODO: Generate thumbnail for image receipts
  // For image MIME types (image/jpeg, image/png, etc.), generate a thumbnail
  // 1. Download the file from storage
  // 2. Use sharp or similar library to resize to 256x256
  // 3. Upload thumbnail to storage with a thumbnail key
  // 4. Update receipt.thumbnail_path with the thumbnail key
  // 5. Generate presigned URL for the thumbnail if using S3

  // If ICR requested, parse the receipt
  if (input.icr) {
    // For S3, get the file buffer and parse directly
    const fileBuffer = await storage.get(input.key);
    parsedData = await parseReceiptFromBuffer(fileBuffer, input.fileName, input.mimeType);

    if (parsedData) {
      await query(
        'UPDATE receipts SET parsed_data = $1 WHERE id = $2',
        [JSON.stringify(parsedData), receipt.id]
      );
      receipt.parsed_data = parsedData;
    }
  }

  logger.info('Receipt upload confirmed', {
    receiptId: receipt.id,
    reportId: input.reportId,
    key: input.key,
    icr: input.icr,
    parsed: !!parsedData,
  });

  return { receipt, parsedData };
}

export async function getReceiptDownloadUrl(
  receiptId: string,
  userId: string
): Promise<PresignedDownloadUrl & { fileName: string; mimeType: string }> {
  const receipt = await getReceiptById(receiptId, userId);

  const storage = getStorage();

  if (!storage.supportsPresignedUrls() || !storage.getPresignedDownloadUrl) {
    throw new ValidationError('Storage provider does not support presigned URLs');
  }

  const presigned = await storage.getPresignedDownloadUrl(receipt.file_path);

  logger.debug('Presigned download URL generated', {
    receiptId,
    expiresAt: presigned.expiresAt,
  });

  return {
    ...presigned,
    fileName: receipt.file_name,
    mimeType: receipt.mime_type,
  };
}

/**
 * Re-parse a receipt with ICR to extract updated parsed data
 */
export async function reparseReceiptById(
  receiptId: string,
  userId: string
): Promise<ReparseReceiptResult> {
  const receipt = await getReceiptById(receiptId, userId);
  const startTime = Date.now();

  const storage = getStorage();

  // Get the file from storage
  const fileBuffer = await storage.get(receipt.file_path);
  const fileName = receipt.file_path.split('/').pop() || 'receipt';

  try {
    const parsedData = await parseReceiptFromBuffer(fileBuffer, fileName, receipt.mime_type);
    const processingTimeMs = Date.now() - startTime;

    if (!parsedData) {
      logger.warn('Receipt re-parse failed', { receiptId });
      return {
        success: false,
        error: {
          code: 'PARSE_FAILED',
          message: 'Failed to parse receipt data',
        },
        processingTimeMs,
      };
    }

    // Update the receipt's parsed data
    await query(
      'UPDATE receipts SET parsed_data = $1 WHERE id = $2',
      [JSON.stringify(parsedData), receiptId]
    );

    logger.info('Receipt re-parsed successfully', {
      receiptId,
      processingTimeMs,
    });

    return {
      success: true,
      data: parsedData,
      processingTimeMs,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return {
          success: false,
          error: {
            code: 'PARSE_TIMEOUT',
            message: 'Receipt parsing timed out',
          },
          processingTimeMs,
        };
      }

      if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Receipt parser service is unavailable',
          },
          processingTimeMs,
        };
      }
    }

    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      processingTimeMs,
    };
  }
}
