import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import {
  uploadReceipt,
  getReceiptById,
  listReceipts,
  deleteReceipt,
  associateReceiptWithLines,
  removeReceiptLineAssociation,
  getReceiptAssociations,
  getReceiptFile,
} from '../services/receipt.service.js';
import { paginate } from '../utils/pagination.js';
import { ValidationError } from '../types/index.js';
import {
  ReceiptSchema,
  ReceiptUploadResponseSchema,
  ReceiptListResponseSchema,
  AssociateReceiptSchema,
  ReceiptAssociationsResponseSchema,
  ReceiptListQuerySchema,
} from '../schemas/receipt.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';

// Router for receipts under reports: /expense-reports/:reportId/receipts
const receiptsRouter = new OpenAPIHono();

// Router for direct receipt access: /receipts/:id
const receiptDirectRouter = new OpenAPIHono();

// All routes require authentication
receiptsRouter.use('*', authMiddleware);
receiptDirectRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// Helper to parse ICR parameter
function parseIcrParam(value: string | undefined): boolean {
  if (!value) return false;
  return value === 'true' || value === 'Y' || value === '1';
}

// List receipts for a report
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Receipts'],
  summary: 'List receipts',
  description: 'Get paginated list of receipts for a report',
  security,
  request: {
    query: ReceiptListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of receipts',
      content: { 'application/json': { schema: ReceiptListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptsRouter.openapi(listRoute, async (c) => {
  const userId = getUserId(c);
  const reportId = c.req.param('reportId');
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const { receipts, total } = await listReceipts(reportId, userId, paginationParams);

  return c.json(paginate(receipts, total, paginationParams), 200);
});

// Upload receipt - Note: multipart/form-data doesn't have full OpenAPI schema support in zod-openapi
const uploadRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Receipts'],
  summary: 'Upload receipt',
  description: 'Upload a receipt image or PDF. Use multipart/form-data with "file" field. Set "icr=true" to parse the receipt.',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary', description: 'Receipt file (JPEG, PNG, GIF, WebP, PDF)' }),
            icr: z.string().optional().openapi({ description: 'Set to "true" or "Y" to enable receipt parsing' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Receipt uploaded',
      content: { 'application/json': { schema: ReceiptUploadResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Duplicate receipt',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptsRouter.openapi(uploadRoute, async (c) => {
  const userId = getUserId(c);
  const reportId = c.req.param('reportId');

  const formData = await c.req.formData();
  const file = formData.get('file');
  const icrParam = formData.get('icr');

  if (!file || !(file instanceof File)) {
    throw new ValidationError('File is required');
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const icr = parseIcrParam(icrParam?.toString());

  const result = await uploadReceipt(userId, {
    reportId,
    file: fileBuffer,
    fileName: file.name,
    mimeType: file.type,
    icr,
  });

  if (icr && result.parsedData) {
    return c.json({
      receipt: result.receipt,
      parsedData: result.parsedData,
    }, 201);
  }

  return c.json({ receipt: result.receipt }, 201);
});

// Get receipt by ID
const getReceiptRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Receipts'],
  summary: 'Get receipt',
  description: 'Get a specific receipt by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Receipt details',
      content: { 'application/json': { schema: ReceiptSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptDirectRouter.openapi(getReceiptRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const receipt = await getReceiptById(id, userId);

  return c.json(receipt, 200);
});

// Download receipt file
const downloadRoute = createRoute({
  method: 'get',
  path: '/{id}/file',
  tags: ['Receipts'],
  summary: 'Download receipt file',
  description: 'Download the receipt file',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Receipt file',
      content: {
        'application/octet-stream': {
          schema: z.any().openapi({ type: 'string', format: 'binary' }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptDirectRouter.openapi(downloadRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const { buffer, mimeType, fileName } = await getReceiptFile(id, userId);

  c.header('Content-Type', mimeType);
  c.header('Content-Disposition', `attachment; filename="${fileName}"`);
  c.header('Content-Length', buffer.length.toString());

  return c.body(buffer);
});

// Delete receipt
const deleteReceiptRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Receipts'],
  summary: 'Delete receipt',
  description: 'Delete a receipt and its file',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Receipt deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptDirectRouter.openapi(deleteReceiptRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  await deleteReceipt(id, userId);

  return c.json({ message: 'Receipt deleted' }, 200);
});

// Get receipt associations
const getAssociationsRoute = createRoute({
  method: 'get',
  path: '/{id}/associations',
  tags: ['Receipts'],
  summary: 'Get receipt associations',
  description: 'Get expense lines associated with this receipt',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Associated expense lines',
      content: { 'application/json': { schema: ReceiptAssociationsResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptDirectRouter.openapi(getAssociationsRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const lines = await getReceiptAssociations(id, userId);

  return c.json({ lines }, 200);
});

// Associate receipt with expense lines
const associateRoute = createRoute({
  method: 'post',
  path: '/{id}/associate',
  tags: ['Receipts'],
  summary: 'Associate receipt with expense lines',
  description: 'Link a receipt to one or more expense lines (must be from the same report)',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: AssociateReceiptSchema } },
    },
  },
  responses: {
    200: {
      description: 'Receipt associated',
      content: { 'application/json': { schema: MessageSchema } },
    },
    400: {
      description: 'Validation error (lines must be from same report)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Receipt or line not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptDirectRouter.openapi(associateRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const { lineIds } = c.req.valid('json');

  await associateReceiptWithLines(id, lineIds, userId);

  return c.json({ message: 'Receipt associated with expense lines' }, 200);
});

// Remove receipt-line association
const LineIdParamSchema = z.object({
  id: z.string().uuid(),
  lineId: z.string().uuid(),
});

const removeAssociationRoute = createRoute({
  method: 'delete',
  path: '/{id}/associate/{lineId}',
  tags: ['Receipts'],
  summary: 'Remove receipt-line association',
  description: 'Remove the association between a receipt and an expense line',
  security,
  request: {
    params: LineIdParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Association removed',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

receiptDirectRouter.openapi(removeAssociationRoute, async (c) => {
  const userId = getUserId(c);
  const { id, lineId } = c.req.valid('param');

  await removeReceiptLineAssociation(id, lineId, userId);

  return c.json({ message: 'Association removed' }, 200);
});

export { receiptsRouter, receiptDirectRouter };
