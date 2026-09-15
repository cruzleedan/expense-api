import { query, transaction } from '../db/client.js';
import type { Receipt, ExpenseLine } from '../types/index.js';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../types/index.js';
import { verifyReportOwnership } from './expenseReport.service.js'; // kept for listReceipts ownership check
import { sha256 } from '../utils/hash.js';
import { getStorage } from '../storage/localStorage.js';
import type { PresignedDownloadUrl } from '../storage/storage.interface.js';
import { parseReceiptFromBuffer, type ReparseReceiptResult } from './receiptParser.service.js';
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
import { detectReceiptMimeType } from '../utils/fileSignature.js';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

export interface UploadReceiptInput {
  lineId?: string;
  file: Buffer;
  fileName: string;
  mimeType: string;
  icr?: boolean;
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
  if (input.lineId) {
    const lineResult = await query<{ user_id: string }>(
      'SELECT user_id FROM expense_lines WHERE id = $1 AND deleted_at IS NULL',
      [input.lineId]
    );
    if (lineResult.rows.length === 0) throw new NotFoundError('Expense line');
    if (lineResult.rows[0].user_id !== userId) throw new ForbiddenError('Access denied to this expense line');
  }

  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(`Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  if (input.file.length > env.MAX_FILE_SIZE) {
    throw new ValidationError(`File too large. Maximum size: ${env.MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  if (input.file.length === 0) {
    throw new ValidationError('Receipt file cannot be empty');
  }

  const detectedMimeType = detectReceiptMimeType(input.file);
  if (!detectedMimeType || detectedMimeType !== input.mimeType) {
    throw new ValidationError('File content does not match the declared receipt type');
  }

  const fileHash = sha256(input.file);

  const existingResult = await query<Receipt>('SELECT * FROM receipts WHERE file_hash = $1', [fileHash]);
  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];
    if (existing.user_id !== userId) throw new ConflictError('Duplicate receipt: this file has already been uploaded');

    if (input.lineId) {
      await query(
        `INSERT INTO receipt_line_associations (receipt_id, line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [existing.id, input.lineId]
      );
    }

    if (!input.icr) throw new ConflictError('Duplicate receipt: this file has already been uploaded');

    let parsedData = existing.parsed_data ?? null;
    const hadCachedParsedData = !!parsedData;
    if (!parsedData) {
      parsedData = await parseReceiptFromBuffer(input.file, input.fileName, input.mimeType);
      if (parsedData) {
        await query('UPDATE receipts SET parsed_data = $1 WHERE id = $2', [JSON.stringify(parsedData), existing.id]);
        existing.parsed_data = parsedData;
      }
    }

    logger.info('Duplicate receipt upload reused for ICR', {
      receiptId: existing.id,
      lineId: input.lineId ?? null,
      reusedCachedParsedData: hadCachedParsedData,
      parsed: !!parsedData,
    });

    return { receipt: existing, parsedData };
  }

  const storage = getStorage();
  const filePath = await storage.save(input.file, input.fileName);

  const result = await query<Receipt>(
    `INSERT INTO receipts (user_id, file_path, file_name, file_hash, mime_type, file_size, thumbnail_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, filePath, input.fileName, fileHash, input.mimeType, input.file.length, null]
  );

  const receipt = result.rows[0];
  let parsedData: ParsedReceiptData | null = null;

  if (input.lineId) {
    await query(
      `INSERT INTO receipt_line_associations (receipt_id, line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [receipt.id, input.lineId]
    );
  }

  if (input.icr) {
    parsedData = await parseReceiptFromBuffer(input.file, input.fileName, input.mimeType);
    if (parsedData) {
      await query('UPDATE receipts SET parsed_data = $1 WHERE id = $2', [JSON.stringify(parsedData), receipt.id]);
      receipt.parsed_data = parsedData;
    }
  }

  logger.info('Receipt uploaded', { receiptId: receipt.id, lineId: input.lineId ?? null, icr: input.icr, parsed: !!parsedData });

  return { receipt, parsedData };
}

export async function getReceiptById(
  receiptId: string,
  userId: string
): Promise<Receipt> {
  const result = await query<Receipt>(
    'SELECT * FROM receipts WHERE id = $1',
    [receiptId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Receipt');
  }

  const receipt = result.rows[0];

  if (receipt.user_id !== userId) {
    throw new ForbiddenError('Access denied to this receipt');
  }

  return receipt;
}

export async function listReceipts(
  reportId: string,
  userId: string,
  params: PaginationParams
): Promise<{ receipts: Receipt[]; total: number }> {
  await verifyReportOwnership(reportId, userId);

  const offset = getOffset(params);
  const values: unknown[] = [reportId];
  let paramIndex = 2;

  let searchClause = '';
  const searchCondition = buildSearchCondition(params.search, RECEIPT_SEARCHABLE_FIELDS, paramIndex);
  if (searchCondition) {
    searchClause = `AND ${searchCondition.condition}`;
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const orderBy = buildOrderByClause(params, RECEIPT_SORTABLE_FIELDS, 'r.created_at DESC');

  // Receipts for a report = receipts linked to any line belonging to that report
  const baseFrom = `
    FROM receipts r
    JOIN receipt_line_associations rla ON rla.receipt_id = r.id
    JOIN expense_lines el ON el.id = rla.line_id
    WHERE el.report_id = $1 ${searchClause}
  `;

  const [dataResult, countResult] = await Promise.all([
    query<Receipt>(
      `SELECT DISTINCT r.* ${baseFrom} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(DISTINCT r.id) as count ${baseFrom}`,
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
  await getReceiptById(receiptId, userId);

  // Verify all lines belong to this user
  for (const lineId of lineIds) {
    const lineResult = await query<{ user_id: string }>(
      'SELECT user_id FROM expense_lines WHERE id = $1 AND deleted_at IS NULL',
      [lineId]
    );
    if (lineResult.rows.length === 0) throw new NotFoundError(`Expense line ${lineId}`);
    if (lineResult.rows[0].user_id !== userId) throw new ForbiddenError(`Access denied to expense line ${lineId}`);
  }

  await transaction(async (client) => {
    for (const lineId of lineIds) {
      await client.query(
        `INSERT INTO receipt_line_associations (receipt_id, line_id)
         VALUES ($1, $2) ON CONFLICT (receipt_id, line_id) DO NOTHING`,
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
  lineId?: string;
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
  if (input.lineId) {
    const lineResult = await query<{ user_id: string }>(
      'SELECT user_id FROM expense_lines WHERE id = $1 AND deleted_at IS NULL',
      [input.lineId]
    );
    if (lineResult.rows.length === 0) throw new NotFoundError('Expense line');
    if (lineResult.rows[0].user_id !== userId) throw new ForbiddenError('Access denied to this expense line');
  }

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
    contentLength: input.fileSize,
  });

  await query(
    `INSERT INTO pending_receipt_uploads
       (user_id, storage_key, line_id, file_name, mime_type, expected_size, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      presigned.key,
      input.lineId ?? null,
      input.fileName,
      input.mimeType,
      input.fileSize,
      presigned.expiresAt,
    ]
  );

  logger.info('Presigned upload URL generated', { lineId: input.lineId ?? null, key: presigned.key });

  return {
    uploadUrl: presigned.url,
    key: presigned.key,
    expiresAt: presigned.expiresAt,
  };
}

export interface ConfirmUploadInput {
  lineId?: string;
  key: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  fileHash?: string;
  icr?: boolean;
}

interface PendingReceiptUpload {
  id: string;
  user_id: string;
  storage_key: string;
  line_id: string | null;
  file_name: string;
  mime_type: string;
  expected_size: number;
  expires_at: Date;
  consumed_at: Date | null;
}

async function discardPendingUpload(pending: PendingReceiptUpload): Promise<void> {
  await query(
    `UPDATE pending_receipt_uploads
     SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [pending.id]
  );

  try {
    await getStorage().delete(pending.storage_key);
  } catch (error) {
    logger.warn('Failed to remove rejected pending receipt object', {
      pendingUploadId: pending.id,
      error,
    });
  }
}

export async function confirmUpload(
  userId: string,
  input: ConfirmUploadInput
): Promise<UploadReceiptResult> {
  const pendingResult = await query<PendingReceiptUpload>(
    `SELECT * FROM pending_receipt_uploads
     WHERE storage_key = $1 AND user_id = $2`,
    [input.key, userId]
  );
  if (pendingResult.rows.length === 0) {
    throw new ValidationError('Upload capability is invalid or belongs to another user');
  }

  const pending = pendingResult.rows[0];
  if (pending.consumed_at) {
    throw new ConflictError('Upload capability has already been consumed');
  }
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await discardPendingUpload(pending);
    throw new ValidationError('Upload capability has expired');
  }

  const mismatchedHint =
    (input.lineId !== undefined && input.lineId !== pending.line_id) ||
    (input.fileName !== undefined && input.fileName !== pending.file_name) ||
    (input.mimeType !== undefined && input.mimeType !== pending.mime_type) ||
    (input.fileSize !== undefined && input.fileSize !== pending.expected_size);
  if (mismatchedHint) {
    throw new ValidationError('Confirmation metadata does not match the upload request');
  }

  const storage = getStorage();
  let fileBuffer: Buffer;
  try {
    fileBuffer = await storage.get(pending.storage_key);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new ValidationError('File not found in storage. Upload may have failed.');
    }
    throw error;
  }

  if (fileBuffer.length !== pending.expected_size || fileBuffer.length > env.MAX_FILE_SIZE) {
    await discardPendingUpload(pending);
    throw new ValidationError('Stored file size does not match the authorized upload size');
  }

  const detectedMimeType = detectReceiptMimeType(fileBuffer);
  if (!detectedMimeType || detectedMimeType !== pending.mime_type) {
    await discardPendingUpload(pending);
    throw new ValidationError('Stored file content does not match the authorized receipt type');
  }

  const fileHash = sha256(fileBuffer);
  if (input.fileHash !== undefined && input.fileHash.toLowerCase() !== fileHash) {
    await discardPendingUpload(pending);
    throw new ValidationError('Stored file hash does not match the confirmation hint');
  }

  // Move verified bytes to a fresh server-owned key. The original presigned URL
  // may remain valid until expiry, so its key must never become permanent evidence.
  const finalStorageKey = await storage.save(fileBuffer, pending.file_name);

  let transactionResult: { receipt?: Receipt; duplicate: boolean };
  try {
    transactionResult = await transaction(async (client) => {
      const lockedPending = await client.query<PendingReceiptUpload>(
        `SELECT * FROM pending_receipt_uploads
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [pending.id, userId]
      );
      const current = lockedPending.rows[0];
      if (!current || current.consumed_at || new Date(current.expires_at).getTime() <= Date.now()) {
        throw new ConflictError('Upload capability is no longer valid');
      }

      const existingResult = await client.query<{ id: string }>(
        'SELECT id FROM receipts WHERE file_hash = $1',
        [fileHash]
      );

      if (existingResult.rows.length > 0) {
        await client.query(
          `UPDATE pending_receipt_uploads
           SET consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [current.id]
        );
        return { duplicate: true };
      }

      const result = await client.query<Receipt>(
        `INSERT INTO receipts (user_id, file_path, file_name, file_hash, mime_type, file_size, thumbnail_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          finalStorageKey,
          current.file_name,
          fileHash,
          detectedMimeType,
          fileBuffer.length,
          null,
        ]
      );

      if (current.line_id) {
        await client.query(
          `INSERT INTO receipt_line_associations (receipt_id, line_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [result.rows[0].id, current.line_id]
        );
      }

      await client.query(
        `UPDATE pending_receipt_uploads
         SET consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [current.id]
      );

      return { receipt: result.rows[0], duplicate: false };
    });
  } catch (error) {
    await storage.delete(finalStorageKey).catch((cleanupError) => {
      logger.warn('Failed to clean up uncommitted receipt object', { finalStorageKey, cleanupError });
    });
    throw error;
  }

  await storage.delete(pending.storage_key).catch((error) => {
    logger.warn('Failed to clean up consumed pending receipt object', {
      pendingUploadId: pending.id,
      error,
    });
  });

  if (transactionResult.duplicate || !transactionResult.receipt) {
    await storage.delete(finalStorageKey).catch((error) => {
      logger.warn('Failed to clean up duplicate receipt object', { finalStorageKey, error });
    });
    throw new ConflictError('Duplicate receipt: this file has already been uploaded');
  }

  const receipt = transactionResult.receipt;
  let parsedData: ParsedReceiptData | null = null;

  if (input.icr) {
    parsedData = await parseReceiptFromBuffer(fileBuffer, pending.file_name, detectedMimeType);

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
    lineId: pending.line_id,
    pendingUploadId: pending.id,
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
