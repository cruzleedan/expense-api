import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type {
  StorageProvider,
  PresignedUrlOptions,
  PresignedUploadUrl,
  PresignedDownloadUrl,
} from './storage.interface.js';
import { env } from '../config/env.js';
import { NotFoundError } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private defaultExpiresIn: number;

  constructor() {
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
      throw new Error('S3 storage requires S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET');
    }

    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });

    this.bucket = env.S3_BUCKET;
    this.defaultExpiresIn = env.S3_PRESIGNED_URL_EXPIRES;
  }

  private generateKey(filename: string): string {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const uniqueId = randomUUID();
    const safeFilename = this.sanitizeFilename(filename);
    return `${year}/${month}/${uniqueId}-${safeFilename}`;
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[/\\]/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 100);
  }

  async save(file: Buffer, filename: string): Promise<string> {
    const key = this.generateKey(filename);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
      })
    );

    logger.debug('File saved to S3', { key });
    return key;
  }

  async get(path: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: path,
        })
      );

      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) {
        throw new NotFoundError('File');
      }

      return Buffer.from(bytes);
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new NotFoundError('File');
      }
      throw error;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: path,
        })
      );
      logger.debug('File deleted from S3', { path });
    } catch (error) {
      // S3 doesn't throw on deleting non-existent objects, but log any other errors
      logger.error('Error deleting file from S3', { path, error });
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: path,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  getUrl(path: string): string {
    // Return the S3 key - actual URL should be obtained via presigned URL
    return path;
  }

  supportsPresignedUrls(): boolean {
    return true;
  }

  async getPresignedUploadUrl(
    filename: string,
    options?: PresignedUrlOptions
  ): Promise<PresignedUploadUrl> {
    const key = this.generateKey(filename);
    const expiresIn = options?.expiresIn ?? this.defaultExpiresIn;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options?.contentType,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    logger.debug('Generated presigned upload URL', { key, expiresAt });

    return { url, key, expiresAt };
  }

  async getPresignedDownloadUrl(
    path: string,
    options?: PresignedUrlOptions
  ): Promise<PresignedDownloadUrl> {
    const expiresIn = options?.expiresIn ?? this.defaultExpiresIn;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: path,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    logger.debug('Generated presigned download URL', { path, expiresAt });

    return { url, expiresAt };
  }
}
