/**
 * Converts a snake_case string to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Converts a camelCase string to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Builds UPDATE SET clause fields from an input object.
 * Returns the SQL fragments, values array, and next parameter index.
 *
 * @param input - Object with camelCase keys and values to update
 * @param fieldMap - Maps camelCase input keys to snake_case DB columns
 * @param startIndex - Starting parameter index (default 1)
 */
export function buildUpdateFields<T extends object>(
  input: T,
  fieldMap: { [K in keyof T]?: string },
  startIndex = 1
): { updates: string[]; values: unknown[]; nextIndex: number } {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = startIndex;

  for (const [inputKey, dbColumn] of Object.entries(fieldMap)) {
    const value = input[inputKey as keyof T];
    if (value !== undefined) {
      updates.push(`${dbColumn} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  return { updates, values, nextIndex: paramIndex };
}

/**
 * Recursively transforms all object keys from snake_case to camelCase
 */
export function keysToCamel<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => keysToCamel(item)) as T;
  }

  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const converted: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const camelKey = snakeToCamel(key);
      converted[camelKey] = keysToCamel((obj as Record<string, unknown>)[key]);
    }
    return converted as T;
  }

  return obj;
}
