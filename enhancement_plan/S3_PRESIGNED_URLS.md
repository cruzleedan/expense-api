# S3 Presigned URLs Implementation

## Overview

The receipt upload/download feature has been revised to use S3 bucket storage (Cloudflare R2) with presigned URLs. This approach allows clients to upload files directly to S3, bypassing the API server and reducing bandwidth/memory usage.

## Backend Changes

### New Environment Variables

```env
S3_ENDPOINT=https://<account-id>.<jurisdiction>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
S3_BUCKET=your-bucket-name
S3_REGION=auto
S3_PRESIGNED_URL_EXPIRES=3600  # optional, defaults to 1 hour
```

### New Dependencies

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### New API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/expense-reports/:reportId/receipts/upload-url` | Get presigned URL for upload |
| POST | `/v1/expense-reports/:reportId/receipts/confirm-upload` | Confirm upload after file uploaded to S3 |
| GET | `/v1/receipts/:id/download-url` | Get presigned URL for download |

### Existing Endpoints (Still Available)

The original endpoints still work for backward compatibility:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/expense-reports/:reportId/receipts` | Upload via multipart/form-data (server proxies to S3) |
| GET | `/v1/receipts/:id/file` | Download file (server streams from S3) |

---

## Frontend Implementation Guide

### Upload Flow (New Presigned URL Approach)

The upload process is now a 3-step flow:

```
1. Request upload URL from API
2. Upload file directly to S3 using presigned URL
3. Confirm upload with API to create receipt record
```

#### Step 1: Request Upload URL

```typescript
interface UploadUrlRequest {
  fileName: string;
  mimeType: string;
  fileSize: number;
}

interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

async function requestUploadUrl(
  reportId: string,
  file: File,
  token: string
): Promise<UploadUrlResponse> {
  const response = await fetch(
    `${API_BASE_URL}/v1/expense-reports/${reportId}/receipts/upload-url`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to get upload URL');
  }

  return response.json();
}
```

#### Step 2: Upload to S3

```typescript
async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error('Failed to upload file to S3');
  }
}
```

#### Step 3: Compute File Hash & Confirm Upload

```typescript
interface ConfirmUploadRequest {
  key: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  icr?: boolean;
}

interface Receipt {
  id: string;
  reportId: string;
  filePath: string;
  fileName: string;
  fileHash: string;
  mimeType: string;
  fileSize: number;
  parsedData: Record<string, unknown> | null;
  createdAt: string;
}

interface ConfirmUploadResponse {
  receipt: Receipt;
  parsedData?: Record<string, unknown>;
}

// Compute SHA-256 hash of file
async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function confirmUpload(
  reportId: string,
  key: string,
  file: File,
  fileHash: string,
  token: string,
  icr: boolean = false
): Promise<ConfirmUploadResponse> {
  const response = await fetch(
    `${API_BASE_URL}/v1/expense-reports/${reportId}/receipts/confirm-upload`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        fileHash,
        icr,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to confirm upload');
  }

  return response.json();
}
```

#### Complete Upload Function

```typescript
async function uploadReceipt(
  reportId: string,
  file: File,
  token: string,
  options: { icr?: boolean; onProgress?: (progress: number) => void } = {}
): Promise<ConfirmUploadResponse> {
  const { icr = false, onProgress } = options;

  // Step 1: Get presigned upload URL
  onProgress?.(10);
  const { uploadUrl, key } = await requestUploadUrl(reportId, file, token);

  // Step 2: Compute file hash (for deduplication)
  onProgress?.(20);
  const fileHash = await computeFileHash(file);

  // Step 3: Upload directly to S3
  onProgress?.(30);
  await uploadToS3(uploadUrl, file);
  onProgress?.(80);

  // Step 4: Confirm upload with API
  const result = await confirmUpload(reportId, key, file, fileHash, token, icr);
  onProgress?.(100);

  return result;
}
```

### Download Flow (New Presigned URL Approach)

```typescript
interface DownloadUrlResponse {
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  expiresAt: string;
}

async function getDownloadUrl(
  receiptId: string,
  token: string
): Promise<DownloadUrlResponse> {
  const response = await fetch(
    `${API_BASE_URL}/v1/receipts/${receiptId}/download-url`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to get download URL');
  }

  return response.json();
}

async function downloadReceipt(receiptId: string, token: string): Promise<void> {
  const { downloadUrl, fileName } = await getDownloadUrl(receiptId, token);

  // Option 1: Open in new tab
  window.open(downloadUrl, '_blank');

  // Option 2: Trigger download
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// For displaying images inline
function useReceiptImageUrl(receiptId: string, token: string) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getDownloadUrl(receiptId, token)
      .then(({ downloadUrl }) => {
        if (mounted) setImageUrl(downloadUrl);
      })
      .catch(console.error);

    return () => { mounted = false; };
  }, [receiptId, token]);

  return imageUrl;
}
```

### React Component Example

```tsx
import { useState, useCallback } from 'react';

interface ReceiptUploaderProps {
  reportId: string;
  token: string;
  onUploadComplete: (receipt: Receipt) => void;
}

export function ReceiptUploader({ reportId, token, onUploadComplete }: ReceiptUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Maximum size: 10MB');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const result = await uploadReceipt(reportId, file, token, {
        icr: true, // Enable receipt parsing
        onProgress: setProgress,
      });
      onUploadComplete(result.receipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [reportId, token, onUploadComplete]);

  return (
    <div>
      <input
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploading && (
        <div>
          <progress value={progress} max={100} />
          <span>{progress}%</span>
        </div>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

### Receipt Image Display Component

```tsx
interface ReceiptImageProps {
  receiptId: string;
  token: string;
  alt?: string;
}

export function ReceiptImage({ receiptId, token, alt = 'Receipt' }: ReceiptImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getDownloadUrl(receiptId, token)
      .then(({ downloadUrl }) => {
        if (mounted) {
          setImageUrl(downloadUrl);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { mounted = false; };
  }, [receiptId, token]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Failed to load image</div>;
  if (!imageUrl) return null;

  return <img src={imageUrl} alt={alt} />;
}
```

---

## Key Differences from Previous Implementation

| Aspect | Before (Multipart) | After (Presigned URLs) |
|--------|-------------------|------------------------|
| Upload path | Client → API → S3 | Client → S3 directly |
| Download path | S3 → API → Client | S3 → Client directly |
| Server memory | High (buffers file) | Low (only metadata) |
| Server bandwidth | High | Low |
| Upload speed | Slower (double hop) | Faster (direct) |
| File hash | Server computes | Client computes |
| CORS | Not needed | Required on S3 bucket |

## Cloudflare R2 CORS Configuration

You need to configure CORS on your R2 bucket to allow direct uploads from the browser:

```json
[
  {
    "AllowedOrigins": ["https://your-frontend-domain.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

For development, you can temporarily allow all origins:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

## Error Handling

| Error | HTTP Status | Cause |
|-------|-------------|-------|
| Invalid file type | 400 | File MIME type not in allowed list |
| File too large | 400 | File exceeds MAX_FILE_SIZE |
| Storage does not support presigned URLs | 400 | S3 not configured (using local storage) |
| File not found in storage | 400 | Upload to S3 failed or key is wrong |
| Duplicate receipt | 409 | File with same SHA-256 hash already exists |
| Report not found | 404 | Invalid reportId |
| Unauthorized | 401 | Missing or invalid JWT token |
| Forbidden | 403 | User doesn't own the report |
