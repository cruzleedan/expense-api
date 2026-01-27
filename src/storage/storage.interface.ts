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
}
