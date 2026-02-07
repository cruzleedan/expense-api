import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { errorHandler, globalErrorHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { camelCaseResponse } from './middleware/camelCase.js';
import { authRouter } from './routes/auth.js';
import { expenseReportsRouter } from './routes/expenseReports.js';
import { expenseLinesRouter, expenseLineDirectRouter } from './routes/expenseLines.js';
import { receiptsRouter, receiptDirectRouter } from './routes/receipts.js';
import { healthRouter } from './routes/health.js';
import { rolesRouter } from './routes/roles.js';
import { workflowRouter } from './routes/workflow.js';
import { usersRouter } from './routes/users.js';
import { expenseCategoriesRouter } from './routes/expenseCategories.js';
import { permissionsRouter } from './routes/permissions.js';
import { projectsRouter } from './routes/projects.js';
import { expensePoliciesRouter } from './routes/expensePolicies.js';
import { llmPromptTemplatesRouter } from './routes/llmPromptTemplates.js';
import { chatRouter } from './routes/chat.js';
import { analyticsRouter } from './routes/analytics.js';
import { insightsRouter } from './routes/insights.js';
import { anomaliesRouter } from './routes/anomalies.js';
import { adminAnalyticsRouter } from './routes/adminAnalytics.js';
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
app.use('*', camelCaseResponse);

// Health check routes (no versioning, no rate limiting)
app.route('/health', healthRouter);

// Rate limiting for v1 routes
app.use('/v1/auth/*', rateLimit());
app.use('/v1/expense-reports/*', rateLimit());
app.use('/v1/expense-lines/*', rateLimit());
app.use('/v1/receipts/*', rateLimit());
app.use('/v1/roles/*', rateLimit());
app.use('/v1/workflow/*', rateLimit());
app.use('/v1/users/*', rateLimit());
app.use('/v1/expense-categories/*', rateLimit());
app.use('/v1/permissions/*', rateLimit());
app.use('/v1/projects/*', rateLimit());
app.use('/v1/expense-policies/*', rateLimit());
app.use('/v1/llm-prompt-templates/*', rateLimit());
app.use('/v1/chat/*', rateLimit());
app.use('/v1/analytics/*', rateLimit());
app.use('/v1/insights/*', rateLimit());
app.use('/v1/anomalies/*', rateLimit());
app.use('/v1/admin/*', rateLimit());

// API v1 routes
app.route('/v1/auth', authRouter);
app.route('/v1/expense-reports', expenseReportsRouter);
app.route('/v1/expense-reports/:reportId/lines', expenseLinesRouter);
app.route('/v1/expense-lines', expenseLineDirectRouter);
app.route('/v1/expense-reports/:reportId/receipts', receiptsRouter);
app.route('/v1/receipts', receiptDirectRouter);
app.route('/v1/roles', rolesRouter);
app.route('/v1/workflow', workflowRouter);
app.route('/v1/users', usersRouter);
app.route('/v1/expense-categories', expenseCategoriesRouter);
app.route('/v1/permissions', permissionsRouter);
app.route('/v1/projects', projectsRouter);
app.route('/v1/expense-policies', expensePoliciesRouter);
app.route('/v1/llm-prompt-templates', llmPromptTemplatesRouter);
app.route('/v1/chat', chatRouter);
app.route('/v1/analytics', analyticsRouter);
app.route('/v1/insights', insightsRouter);
app.route('/v1/anomalies', anomaliesRouter);
app.route('/v1/admin/analytics', adminAnalyticsRouter);

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.0.0',
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
      url: 'http://localhost:3000/v1',
      description: 'Development server (v1)',
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
    { name: 'Users', description: 'User management' },
    { name: 'Expense Categories', description: 'Expense category management' },
    { name: 'Projects', description: 'Project and client management (v5.0)' },
    { name: 'Expense Policies', description: 'Expense policy rules and enforcement (v5.0)' },
    { name: 'LLM Prompt Templates', description: 'LLM prompt template management (v5.0)' },
    { name: 'Chat', description: 'AI chat assistant for expense insights' },
    { name: 'Analytics', description: 'Expense analytics and spending data' },
    { name: 'Insights', description: 'Proactive spending insights and recommendations' },
    { name: 'Anomalies', description: 'Expense anomaly detection and review' },
    { name: 'Admin Analytics', description: 'Admin analytics dashboard for LLM usage and org-wide metrics' },
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
app.get('/docs', swaggerUI({ url: './openapi.json' }));

// Root route
app.get('/', (c) => {
  return c.json({
    name: 'Expense API',
    version: '3.0.0',
    documentation: '/docs',
    openapi: '/openapi.json',
  });
});

// Global error handler (catches errors from OpenAPI routes)
app.onError(globalErrorHandler);

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
