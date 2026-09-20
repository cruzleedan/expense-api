import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import type { StorageProvider } from './storage.interface.js';
import { env } from '../config/env.js';
import { NotFoundError, ValidationError } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { S3StorageProvider } from './s3Storage.js';

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
    const { basePath, candidatePath: fullPath } = await this.resolveContainedPath(relativePath, false);

    // Ensure directory exists
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await this.assertRealPathContained(basePath, await fs.realpath(dirname(fullPath)));

    // Write file
    await fs.writeFile(fullPath, file);
    logger.debug('File saved to local storage', { path: relativePath });

    return relativePath;
  }

  async get(path: string): Promise<Buffer> {
    try {
      const { candidatePath: fullPath } = await this.resolveContainedPath(path, true);
      return await fs.readFile(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('File');
      }
      throw error;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const { candidatePath: fullPath } = await this.resolveContainedPath(path, true);
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
    try {
      const { candidatePath: fullPath } = await this.resolveContainedPath(path, true);
      await fs.access(fullPath);
      return true;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }

  getUrl(path: string): string {
    // For local storage, return a relative URL that can be served
    return `/files/${path}`;
  }

  supportsPresignedUrls(): boolean {
    return false;
  }

  private sanitizeFilename(filename: string): string {
    // Remove path separators and limit length
    return filename
      .replace(/[/\\]/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 100);
  }

  private async resolveContainedPath(
    storagePath: string,
    requireExisting: boolean
  ): Promise<{ basePath: string; candidatePath: string }> {
    if (!storagePath || storagePath.includes('\0') || isAbsolute(storagePath)) {
      throw new ValidationError('Invalid storage path');
    }

    await fs.mkdir(this.baseDir, { recursive: true });
    const basePath = await fs.realpath(resolve(this.baseDir));
    const candidatePath = resolve(basePath, storagePath);
    this.assertLexicallyContained(basePath, candidatePath);

    if (requireExisting) {
      const realCandidatePath = await fs.realpath(candidatePath);
      this.assertRealPathContained(basePath, realCandidatePath);
      return { basePath, candidatePath: realCandidatePath };
    }

    return { basePath, candidatePath };
  }

  private assertLexicallyContained(basePath: string, candidatePath: string): void {
    const relativePath = relative(basePath, candidatePath);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new ValidationError('Invalid storage path');
    }
  }

  private assertRealPathContained(basePath: string, candidatePath: string): void {
    this.assertLexicallyContained(basePath, candidatePath);
  }
}

// Singleton instance
let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    // Use S3 storage if configured, otherwise fall back to local storage
    if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET) {
      storageInstance = new S3StorageProvider();
      logger.info('Using S3 storage provider');
    } else {
      storageInstance = new LocalStorageProvider();
      logger.info('Using local storage provider');
    }
  }
  return storageInstance;
}

// Allow setting a different storage provider (for testing or cloud migration)
export function setStorage(provider: StorageProvider): void {
  storageInstance = provider;
}
