import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { ParsedReceiptData } from '../types/index.js';

/**
 * Response from receipt-parser-app API
 */
interface ReceiptParserAPIResponse {
  merchant_name: string;
  merchant_address?: string;
  merchant_phone?: string;
  date?: string;
  time?: string;
  items: Array<{
    name: string;
    quantity?: number;
    unit_price?: number;
    total_price: number;
  }>;
  subtotal?: number;
  tax?: number;
  tip?: number;
  discount?: number;
  total: number;
  payment_method?: string;
  receipt_number?: string;
  processing_metadata: {
    ocr_time_ms: number;
    llm_time_ms: number;
    total_time_ms: number;
    ocr_confidence: number;
  };
}

/**
 * Convert receipt-parser-app response to our ParsedReceiptData format
 */
function transformResponse(response: ReceiptParserAPIResponse): ParsedReceiptData {
  return {
    vendor: response.merchant_name,
    merchant_name: response.merchant_name,
    merchant_address: response.merchant_address,
    merchant_phone: response.merchant_phone,
    date: response.date,
    time: response.time,
    total: response.total,
    subtotal: response.subtotal,
    tax: response.tax,
    tip: response.tip,
    discount: response.discount,
    payment_method: response.payment_method,
    receipt_number: response.receipt_number,
    items: response.items?.map(item => ({
      description: item.name,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      amount: item.total_price,
    })),
    processing_metadata: response.processing_metadata,
  };
}

/**
 * Call the receipt-parser-app service to parse a receipt image/PDF.
 * Sends the file as multipart/form-data.
 * Returns null on failure (graceful degradation).
 */
export async function parseReceipt(
  filePath: string,
  mimeType: string
): Promise<ParsedReceiptData | null> {
  const url = `${env.RECEIPT_PARSER_URL}/parse`;

  try {
    logger.debug('Calling receipt parser service', { url, filePath, mimeType });

    // Read the file from disk
    const fs = await import('fs/promises');
    const fileBuffer = await fs.readFile(filePath);
    const fileName = filePath.split('/').pop() || 'receipt';

    // Create FormData with the file
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(env.RECEIPT_PARSER_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn('Receipt parser returned error', {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const result = (await response.json()) as ReceiptParserAPIResponse;

    // Transform to our format
    const parsedData = transformResponse(result);

    logger.info('Receipt parsed successfully', {
      vendor: parsedData.vendor,
      total: parsedData.total,
      processingTimeMs: result.processing_metadata?.total_time_ms,
    });

    return parsedData;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        logger.error('Receipt parser timed out', {
          timeout: env.RECEIPT_PARSER_TIMEOUT,
        });
      } else if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
        logger.error('Receipt parser service unavailable', {
          url,
          error: error.message,
        });
      } else {
        logger.error('Receipt parser error', { error: error.message });
      }
    }

    // Graceful degradation - return null on any error
    return null;
  }
}

/**
 * Parse a receipt from a buffer (for use with S3 storage)
 */
export async function parseReceiptFromBuffer(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ParsedReceiptData | null> {
  const url = `${env.RECEIPT_PARSER_URL}/parse`;

  try {
    logger.debug('Calling receipt parser service with buffer', { url, fileName, mimeType });

    // Create FormData with the file
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(env.RECEIPT_PARSER_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn('Receipt parser returned error', {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const result = (await response.json()) as ReceiptParserAPIResponse;

    // Transform to our format
    const parsedData = transformResponse(result);

    logger.info('Receipt parsed successfully', {
      vendor: parsedData.vendor,
      total: parsedData.total,
      processingTimeMs: result.processing_metadata?.total_time_ms,
    });

    return parsedData;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        logger.error('Receipt parser timed out', {
          timeout: env.RECEIPT_PARSER_TIMEOUT,
        });
      } else if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
        logger.error('Receipt parser service unavailable', {
          url,
          error: error.message,
        });
      } else {
        logger.error('Receipt parser error', { error: error.message });
      }
    }

    // Graceful degradation - return null on any error
    return null;
  }
}

/**
 * Check if the receipt parser service is available.
 */
export async function isParserAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${env.RECEIPT_PARSER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Re-parse a receipt that's already stored in the system.
 * Returns parsed data with processing metadata.
 */
export interface ReparseReceiptResult {
  success: boolean;
  data?: ParsedReceiptData;
  error?: {
    code: string;
    message: string;
  };
  processingTimeMs: number;
}

export async function reparseReceipt(
  filePath: string,
  mimeType: string
): Promise<ReparseReceiptResult> {
  const startTime = Date.now();

  try {
    const data = await parseReceipt(filePath, mimeType);
    const processingTimeMs = Date.now() - startTime;

    if (!data) {
      return {
        success: false,
        error: {
          code: 'PARSE_FAILED',
          message: 'Failed to parse receipt data',
        },
        processingTimeMs,
      };
    }

    return {
      success: true,
      data,
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
