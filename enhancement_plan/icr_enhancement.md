# Backend API Requirements for Receipt-to-Expense Line Enhancements

This document outlines the backend API changes required to support the Receipt-to-Expense Line feature enhancements.

## Summary

The frontend has been updated to support enhanced ICR (Intelligent Character Recognition) workflow with bulk expense line creation and automatic receipt-to-line association. The backend needs to implement the following endpoints and modifications.

---

## New Endpoints Required

### 1. Bulk Create Expense Lines

**Endpoint:** `POST /api/v1/expense-reports/{reportId}/lines/bulk`

**Purpose:** Create multiple expense lines in a single request with optional receipt association.

**Request Body:**
```typescript
{
  lines: Array<{
    description: string;           // Required, max 200 chars
    transactionDate: string;       // Required, ISO 8601 date
    amount: number;                // Required, > 0
    currency?: string;             // Optional, defaults to report currency
    categoryCode?: string | null;  // Optional category code
    receiptId?: string;            // Optional - for auto-association
  }>
}
```

**Response:**
```typescript
{
  created: Array<ExpenseLine>;  // Successfully created expense lines
  failed: Array<{
    index: number;              // Index of the failed line in the request
    error: string;              // Error message
  }>;
}
```

**Behavior:**
- Creates expense lines in order
- If `receiptId` is provided, automatically creates a receipt-to-line association
- Uses transaction semantics: if any validation fails, returns partial success
- Returns created lines with their generated IDs
- Invalidates report totals cache

**Error Codes:**
| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid input data |
| 401 | `UNAUTHORIZED` | Not authenticated |
| 403 | `FORBIDDEN` | Not authorized for this report |
| 404 | `REPORT_NOT_FOUND` | Report does not exist |
| 404 | `RECEIPT_NOT_FOUND` | Referenced receipt does not exist |

**Example Request:**
```json
POST /api/v1/expense-reports/rpt_abc123/lines/bulk
{
  "lines": [
    {
      "description": "Office Supplies - Staples",
      "transactionDate": "2026-02-01",
      "amount": 45.67,
      "currency": "USD",
      "categoryCode": "OFFICE",
      "receiptId": "rcpt_xyz789"
    },
    {
      "description": "Team Lunch",
      "transactionDate": "2026-02-01",
      "amount": 125.00,
      "currency": "USD",
      "categoryCode": "MEALS"
    }
  ]
}
```

**Example Response:**
```json
{
  "created": [
    {
      "id": "line_001",
      "reportId": "rpt_abc123",
      "description": "Office Supplies - Staples",
      "transactionDate": "2026-02-01",
      "amount": 45.67,
      "currency": "USD",
      "categoryCode": "OFFICE",
      "createdAt": "2026-02-03T10:30:00Z",
      "updatedAt": "2026-02-03T10:30:00Z"
    },
    {
      "id": "line_002",
      "reportId": "rpt_abc123",
      "description": "Team Lunch",
      "transactionDate": "2026-02-01",
      "amount": 125.00,
      "currency": "USD",
      "categoryCode": "MEALS",
      "createdAt": "2026-02-03T10:30:00Z",
      "updatedAt": "2026-02-03T10:30:00Z"
    }
  ],
  "failed": []
}
```

---

### 2. Re-parse Receipt with ICR (Enhancement)

**Endpoint:** `GET /api/v1/receipts/{receiptId}/parse`

**Purpose:** Re-process a receipt with ICR to extract updated parsed data.

**This endpoint may already exist.** If not, implement as follows:

**Response:**
```typescript
{
  success: boolean;
  data?: ParsedReceiptData;
  error?: {
    code: string;
    message: string;
  };
  processingTimeMs: number;
}

interface ParsedReceiptData {
  merchant_name?: ParsedField;
  transaction_date?: ParsedField;
  total_amount?: ParsedField;
  subtotal?: ParsedField;
  tax_amount?: ParsedField;
  currency?: ParsedField;
  payment_method?: ParsedField;
  line_items?: Array<{
    description: ParsedField;
    quantity?: ParsedField;
    unit_price?: ParsedField;
    total?: ParsedField;
  }>;
  raw_text?: string;
}

interface ParsedField {
  value: any;
  confidence: number;  // 0-1 confidence score
  source: 'icr';
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

**Behavior:**
- Retrieves the receipt file from storage
- Processes it through the ICR/OCR service
- Returns extracted data with confidence scores
- Updates the receipt's `parsedData` field in the database

**Error Codes:**
| Status | Code | Description |
|--------|------|-------------|
| 401 | `UNAUTHORIZED` | Not authenticated |
| 403 | `FORBIDDEN` | Not authorized for this receipt |
| 404 | `RECEIPT_NOT_FOUND` | Receipt does not exist |
| 408 | `PARSE_TIMEOUT` | ICR service timed out |
| 422 | `LOW_QUALITY` | Image quality too low for parsing |
| 503 | `SERVICE_UNAVAILABLE` | ICR service unavailable |

---

## Existing Endpoint Modifications

### 1. Confirm Receipt Upload (Enhancement)

**Endpoint:** `POST /api/v1/expense-reports/{reportId}/receipts/confirm-upload`

**Current behavior:** Accepts `icr` flag and returns parsed data when enabled.

**Enhancement needed:** Ensure the response includes a `thumbnailUrl` field for image receipts.

**Enhanced Response:**
```typescript
{
  receipt: {
    id: string;
    reportId: string;
    fileName: string;
    fileHash: string;
    mimeType: string;
    fileSize: number;
    parsedData: SimpleReceiptData | null;
    thumbnailUrl?: string;  // NEW: URL for thumbnail image
    createdAt: string;
  };
  parsedData?: ParsedReceiptData;  // Detailed parsed data when ICR enabled
}
```

**Thumbnail Generation:**
- Generate a thumbnail (e.g., 128x128 or 256x256) for image receipts
- Store in S3 alongside the original
- Return a presigned URL or CDN URL

---

### 2. Get Receipt Download URL

**Endpoint:** `GET /api/v1/receipts/{receiptId}/download-url`

This endpoint exists and works correctly. No changes needed.

---

### 3. Receipt Associations

**Endpoint:** `POST /api/v1/receipts/{receiptId}/associate`

This endpoint exists. The bulk create endpoint should internally use this logic when `receiptId` is provided.

---

## Database Schema Considerations

### ExpenseLine Table
No changes required. The `receiptId` in the bulk create request is used for association, not stored on the expense line directly.

### ReceiptLineAssociation Table
Should already exist with schema:
```sql
CREATE TABLE receipt_line_associations (
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_id UUID NOT NULL REFERENCES expense_lines(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (receipt_id, line_id)
);
```

### Receipt Table
Consider adding a `thumbnail_path` column:
```sql
ALTER TABLE receipts ADD COLUMN thumbnail_path VARCHAR(500);
```

---

## Performance Considerations

### Bulk Create
- Use batch insert for efficiency
- Create associations in the same transaction
- Consider using a database transaction for atomicity
- Limit batch size (e.g., max 100 lines per request)

### ICR Processing
- Implement with reasonable timeout (30s recommended)
- Consider async processing for large files
- Cache parsed results to avoid re-processing

### Thumbnail Generation
- Generate asynchronously after upload confirmation
- Use a message queue if high volume expected
- Cache thumbnails with appropriate TTL

---

## API Versioning

All endpoints should be under `/api/v1/`. If breaking changes are needed, consider:
- Deprecation notices in response headers
- Version bumping for major changes

---

## Testing Recommendations

### Bulk Create Tests
1. Create multiple lines successfully
2. Partial failure (some lines invalid)
3. All lines fail validation
4. Receipt association works correctly
5. Invalid receipt ID handling
6. Report not found
7. Unauthorized access

### Re-parse Tests
1. Successful re-parse with updated data
2. Low quality image rejection
3. Service timeout handling
4. Invalid receipt ID

### Integration Tests
1. Full flow: Upload with ICR -> Review -> Bulk create with association
2. Re-parse after initial parse
3. Association verification after bulk create

---

## Implementation Priority

| Priority | Feature | Effort |
|----------|---------|--------|
| 1 (High) | Bulk create expense lines | Medium |
| 2 (High) | Receipt-to-line auto-association in bulk create | Low |
| 3 (Medium) | Re-parse endpoint (if not exists) | Medium |
| 4 (Low) | Thumbnail generation | Medium |

---

## Security Considerations

1. **Authorization**: Verify user has access to the report before any operation
2. **Input Validation**: Validate all input fields, especially amounts and dates
3. **Rate Limiting**: Apply rate limits to prevent abuse
4. **File Validation**: Ensure receipt files are valid before ICR processing

---

## Monitoring & Logging

Recommended metrics to track:
- Bulk create success/failure rates
- Average lines per bulk request
- ICR processing time
- Thumbnail generation time
- Association creation success rate
