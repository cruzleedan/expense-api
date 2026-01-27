import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { expenseReportsRouter } from './routes/expenseReports.js';
import { expenseLinesRouter, expenseLineDirectRouter } from './routes/expenseLines.js';
import { receiptsRouter, receiptDirectRouter } from './routes/receipts.js';
import { healthRouter } from './routes/health.js';
import { rolesRouter } from './routes/roles.js';
import { workflowRouter } from './routes/workflow.js';
import { logger } from './utils/logger.js';

const app = new OpenAPIHono();

// Global middleware
app.use('*', secureHeaders());
app.use('*', cors({
  origin: '*', // Configure appropriately for production
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
  credentials: true,
}));
app.use('*', honoLogger((message, ...rest) => {
  logger.debug(message, { details: rest });
}));
app.use('*', errorHandler);

// Rate limiting for all routes (except health checks)
app.use('/auth/*', rateLimit());
app.use('/expense-reports/*', rateLimit());
app.use('/expense-lines/*', rateLimit());
app.use('/receipts/*', rateLimit());
app.use('/roles/*', rateLimit());
app.use('/workflow/*', rateLimit());

// Health check routes (no rate limiting)
app.route('/health', healthRouter);

// Auth routes
app.route('/auth', authRouter);

// Expense report routes
app.route('/expense-reports', expenseReportsRouter);

// Nested routes for expense lines under reports
app.route('/expense-reports/:reportId/lines', expenseLinesRouter);

// Direct expense line routes
app.route('/expense-lines', expenseLineDirectRouter);

// Nested routes for receipts under reports
app.route('/expense-reports/:reportId/receipts', receiptsRouter);

// Direct receipt routes
app.route('/receipts', receiptDirectRouter);

// Role and permission management routes (v3.0)
app.route('/roles', rolesRouter);

// Workflow and approval routes (v3.0)
app.route('/workflow', workflowRouter);

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Expense API',
    version: '3.0.0',
    description: 'Mobile-first REST API for expense management with RBAC, workflow approval, and audit logging',
    contact: {
      name: 'API Support',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
  ],
  tags: [
    { name: 'Health', description: 'Health check endpoints' },
    { name: 'Authentication', description: 'User authentication and OAuth' },
    { name: 'Expense Reports', description: 'Expense report management' },
    { name: 'Expense Lines', description: 'Expense line items' },
    { name: 'Receipts', description: 'Receipt upload and management' },
    { name: 'Roles', description: 'Role management (v3.0)' },
    { name: 'Permissions', description: 'Permission registry (v3.0)' },
    { name: 'User Roles', description: 'User role assignment (v3.0)' },
    { name: 'Workflows', description: 'Workflow definitions (v3.0)' },
    { name: 'Report Workflow', description: 'Report approval workflow actions (v3.0)' },
  ],
  security: [{ Bearer: [] }],
  components: {
    securitySchemes: {
      Bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token',
      },
    },
  },
});

// Swagger UI
app.get('/docs', swaggerUI({ url: '/openapi.json' }));

// Root route
app.get('/', (c) => {
  return c.json({
    name: 'Expense API',
    version: '3.0.0',
    documentation: '/docs',
    openapi: '/openapi.json',
  });
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: 'Not found',
        code: 'NOT_FOUND',
      },
    },
    404
  );
});

export { app };
