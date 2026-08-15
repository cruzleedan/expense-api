import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { RouteHandler } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import { getUiSchema } from '../services/formDesigner.service.js';
import { ScreenIdParamSchema, UiSchemaQuerySchema, UiSchemaResponseSchema } from '../schemas/formDesigner.js';
import { ErrorSchema, AuthHeaderSchema } from '../schemas/common.js';

const uiSchemasRouter = new OpenAPIHono();

// Authenticated (any role) — not an admin route. No requirePermission here.
uiSchemasRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// GET /v1/ui-schemas/{screenId} — role-aware, assembled form schema for the
// expense app client. Response is hand-built to exactly match WORK-0021's
// existing Flutter contract (bare `key`, not `fieldKey`) — see
// getUiSchema() in formDesigner.service.ts and context/work/0010, "Watch
// this one — the camelCase middleware will break the contract" callout.
// ============================================================================

const getUiSchemaRoute = createRoute({
  method: 'get',
  path: '/{screenId}',
  tags: ['UI Schemas'],
  summary: 'Get a role-aware UI schema',
  description: 'Assembles the published form for screenId into the JSON shape the expense app client parses. Hidden-for-role fields are dropped from the array entirely.',
  security,
  request: { params: ScreenIdParamSchema, query: UiSchemaQuerySchema, headers: AuthHeaderSchema },
  responses: {
    200: { description: 'UI schema', content: { 'application/json': { schema: UiSchemaResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'No published form for this screenId', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const getUiSchemaHandler: RouteHandler<typeof getUiSchemaRoute> = async (c) => {
  const { screenId } = c.req.valid('param');
  const { role } = c.req.valid('query');
  const schema = await getUiSchema(screenId, role);
  return c.json(schema, 200);
};
uiSchemasRouter.openapi(getUiSchemaRoute, getUiSchemaHandler);

export { uiSchemasRouter };
