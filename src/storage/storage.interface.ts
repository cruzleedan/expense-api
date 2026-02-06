export interface PresignedUrlOptions {
  expiresIn?: number; // seconds
  contentType?: string;
}

export interface PresignedUploadUrl {
  url: string;
  key: string;
  expiresAt: Date;
}

export interface PresignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageProvider {
  /**
   * Save a file to storage
   * @param file - File buffer
   * @param filename - Original filename
   * @returns Path to the stored file
   */
  save(file: Buffer, filename: string): Promise<string>;

  /**
   * Get a file from storage
   * @param path - Path to the file
   * @returns File buffer
   */
  get(path: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param path - Path to the file
   */
  delete(path: string): Promise<void>;

  /**
   * Check if a file exists
   * @param path - Path to the file
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get the public URL for a file (if applicable)
   * @param path - Path to the file
   */
  getUrl(path: string): string;

  /**
   * Generate a presigned URL for uploading a file directly to storage
   * @param filename - Original filename
   * @param options - Presigned URL options
   * @returns Presigned upload URL and key
   */
  getPresignedUploadUrl?(
    filename: string,
    options?: PresignedUrlOptions
  ): Promise<PresignedUploadUrl>;

  /**
   * Generate a presigned URL for downloading a file directly from storage
   * @param path - Path to the file
   * @param options - Presigned URL options
   * @returns Presigned download URL
   */
  getPresignedDownloadUrl?(
    path: string,
    options?: PresignedUrlOptions
  ): Promise<PresignedDownloadUrl>;

  /**
   * Check if the storage provider supports presigned URLs
   */
  supportsPresignedUrls(): boolean;
}
