import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { ParsedReceiptData } from '../types/index.js';

export interface ReceiptParserResponse {
  success: boolean;
  data?: ParsedReceiptData;
  error?: string;
}

/**
 * Call the receipt-parser-app service to parse a receipt image/PDF.
 * Returns null on failure (graceful degradation).
 */
export async function parseReceipt(
  filePath: string,
  mimeType: string
): Promise<ParsedReceiptData | null> {
  const url = `${env.RECEIPT_PARSER_URL}/parse`;

  try {
    logger.debug('Calling receipt parser service', { url, filePath, mimeType });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath,
        mimeType,
      }),
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

    const result = (await response.json()) as ReceiptParserResponse;

    if (!result.success || !result.data) {
      logger.warn('Receipt parser failed to parse', { error: result.error });
      return null;
    }

    logger.info('Receipt parsed successfully', {
      vendor: result.data.vendor,
      total: result.data.total,
    });

    return result.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        logger.error('Receipt parser timed out', {
          timeout: env.RECEIPT_PARSER_TIMEOUT,
        });
      } else if (error.message.includes('fetch')) {
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
