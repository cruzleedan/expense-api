import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { StorageProvider } from './storage.interface.js';
import { env } from '../config/env.js';
import { NotFoundError } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? env.UPLOAD_DIR;
  }

  async save(file: Buffer, filename: string): Promise<string> {
    // Generate unique path: uploads/YYYY/MM/uuid-filename
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const uniqueId = randomUUID();
    const safeFilename = this.sanitizeFilename(filename);
    const relativePath = join(year, month, `${uniqueId}-${safeFilename}`);
    const fullPath = join(this.baseDir, relativePath);

    // Ensure directory exists
    await fs.mkdir(dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, file);
    logger.debug('File saved to local storage', { path: relativePath });

    return relativePath;
  }

  async get(path: string): Promise<Buffer> {
    const fullPath = join(this.baseDir, path);

    try {
      return await fs.readFile(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('File');
      }
      throw error;
    }
  }

  async delete(path: string): Promise<void> {
    const fullPath = join(this.baseDir, path);

    try {
      await fs.unlink(fullPath);
      logger.debug('File deleted from local storage', { path });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Ignore if file doesn't exist
    }
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = join(this.baseDir, path);

    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  getUrl(path: string): string {
    // For local storage, return a relative URL that can be served
    return `/files/${path}`;
  }

  private sanitizeFilename(filename: string): string {
    // Remove path separators and limit length
    return filename
      .replace(/[/\\]/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 100);
  }
}

// Singleton instance
let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    storageInstance = new LocalStorageProvider();
  }
  return storageInstance;
}

// Allow setting a different storage provider (for testing or cloud migration)
export function setStorage(provider: StorageProvider): void {
  storageInstance = provider;
}
