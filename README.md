# Expense API

A mobile-first REST API for expense management built with Hono, TypeScript, and PostgreSQL.

## Features

- **Authentication**: JWT-based auth with `jose`, OAuth2 support for Google and Facebook
- **Expense Reports**: Create, read, update, delete expense reports
- **Expense Lines**: Manage individual expense items within reports
- **Receipts**: Upload receipt images/PDFs with duplicate detection (SHA-256)
- **Receipt Parsing**: Optional ICR integration with external parser service
- **AI Chat**: LLM-powered expense chat via Ollama
- **Analytics**: Expense analytics, insights, and anomaly detection
- **Workflow**: Approval workflow for expense reports
- **RBAC**: Role-based access control with permissions
- **Rate Limiting**: Configurable rate limits per endpoint
- **Pagination**: All list endpoints support pagination
- **OpenAPI**: Swagger UI at `/docs`

## Tech Stack

- **Runtime**: Node.js 22 LTS
- **Framework**: Hono (OpenAPI via `@hono/zod-openapi`)
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL 16 with pgvector (native SQL via `pg`)
- **Authentication**: JWT with `jose`
- **Validation**: Zod
- **Containerization**: Docker

## Quick Start

### Using Docker (Recommended)

No local Node.js or npm required — everything runs in containers.

```bash
# Clone the repository
git clone <repository-url>
cd expense-api

# Copy and configure environment (JWT_SECRET required)
cp .env.example .env
# Edit .env — set JWT_SECRET to a random string of at least 32 characters

# Start all services (development mode with hot reload)
docker compose -f compose.dev.yaml up -d

# The API will be available at http://localhost:3002
# Swagger docs: http://localhost:3002/docs

# Rebuild and restart (after code or dependency changes)
docker compose -f compose.dev.yaml up -d --build

# View logs
docker compose -f compose.dev.yaml logs -f expense-api

# Stop services
docker compose -f compose.dev.yaml down
```

### Production Build

Production requires `JWT_SECRET` and `POSTGRES_PASSWORD` to be set in the environment (no defaults).

```bash
export JWT_SECRET=<your-secret>
export POSTGRES_PASSWORD=<your-password>
docker compose -f compose.prod.yaml up -d
```

### Local Development (if Node.js is installed)

```bash
# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your settings

# Start PostgreSQL via Docker
docker run -d \
  --name expense-postgres \
  -e POSTGRES_USER=expense_user \
  -e POSTGRES_PASSWORD=expense_pass \
  -e POSTGRES_DB=expense_db \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Initialize database schema and seed data
npm run db:init

# Start development server
npm run dev
```

## Environment Variables

### Core

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production/test) | `development` |
| `PORT` | Server port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | required |

### JWT

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret (min 32 chars) | required |
| `JWT_ACCESS_EXPIRES_IN` | Access token expiry | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiry | `7d` |

### OAuth

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | optional |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | optional |
| `GOOGLE_REDIRECT_URI` | Google OAuth redirect URI | optional |
| `FACEBOOK_CLIENT_ID` | Facebook OAuth client ID | optional |
| `FACEBOOK_CLIENT_SECRET` | Facebook OAuth client secret | optional |
| `FACEBOOK_REDIRECT_URI` | Facebook OAuth redirect URI | optional |

### File Storage

| Variable | Description | Default |
|----------|-------------|---------|
| `UPLOAD_DIR` | Local upload directory | `./uploads` |
| `MAX_FILE_SIZE` | Max upload size in bytes | `10485760` (10MB) |
| `S3_ENDPOINT` | S3/R2 endpoint URL | optional |
| `S3_ACCESS_KEY_ID` | S3/R2 access key | optional |
| `S3_SECRET_ACCESS_KEY` | S3/R2 secret key | optional |
| `S3_BUCKET` | S3/R2 bucket name | optional |
| `S3_REGION` | S3/R2 region | `auto` |
| `S3_PRESIGNED_URL_EXPIRES` | Presigned URL TTL (seconds) | `3600` |

### Receipt Parser

| Variable | Description | Default |
|----------|-------------|---------|
| `RECEIPT_PARSER_URL` | Receipt parser service URL | `http://receipt-parser-app:3000` |
| `RECEIPT_PARSER_TIMEOUT` | Parser request timeout (ms) | `30000` |

### Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | `60000` (1 min) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |
| `RATE_LIMIT_AUTH_MAX_REQUESTS` | Max auth requests per window | `20` |

### LLM (Ollama)

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_HOST` | Ollama service URL | `http://shared-ollama:11434` |
| `OLLAMA_MODEL` | Chat model | `qwen2.5:7b` |
| `OLLAMA_EMBED_MODEL` | Embedding model | `nomic-embed-text` |
| `OLLAMA_TIMEOUT` | Ollama request timeout (ms) | `120000` |

## Identifying the Environment

The root endpoint (`GET /`) returns the current environment:

```bash
curl http://localhost:3002/
```

```json
{
  "name": "Expense API",
  "version": "3.0.0",
  "environment": "development",
  "documentation": "/docs",
  "openapi": "/openapi.json"
}
```

`environment` will be `"development"`, `"production"`, or `"test"` depending on `NODE_ENV`.

## API Endpoints

All endpoints are prefixed with `/v1`. Health endpoints are at `/health` (no prefix).

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/auth/register` | Register with email/password |
| POST | `/v1/auth/login` | Login with email/password |
| POST | `/v1/auth/refresh` | Refresh access token |
| POST | `/v1/auth/logout` | Logout (revoke refresh token) |
| GET | `/v1/auth/google` | Initiate Google OAuth |
| GET | `/v1/auth/google/callback` | Google OAuth callback |
| GET | `/v1/auth/facebook` | Initiate Facebook OAuth |
| GET | `/v1/auth/facebook/callback` | Facebook OAuth callback |

### Expense Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/expense-reports` | List reports (paginated) |
| POST | `/v1/expense-reports` | Create report |
| GET | `/v1/expense-reports/:id` | Get report |
| PUT | `/v1/expense-reports/:id` | Update report |
| DELETE | `/v1/expense-reports/:id` | Delete report |

### Expense Lines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/expense-reports/:reportId/lines` | List lines (paginated) |
| POST | `/v1/expense-reports/:reportId/lines` | Create line |
| GET | `/v1/expense-lines/:id` | Get line |
| PUT | `/v1/expense-lines/:id` | Update line |
| DELETE | `/v1/expense-lines/:id` | Delete line |

### Receipts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/expense-reports/:reportId/receipts` | List receipts (paginated) |
| POST | `/v1/expense-reports/:reportId/receipts` | Upload receipt |
| GET | `/v1/receipts/:id` | Get receipt |
| GET | `/v1/receipts/:id/file` | Download receipt file |
| DELETE | `/v1/receipts/:id` | Delete receipt |
| POST | `/v1/receipts/:id/associate` | Link to expense lines |
| DELETE | `/v1/receipts/:id/associate/:lineId` | Remove association |

### Users & RBAC

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/v1/users` | User management |
| GET/POST/PUT/DELETE | `/v1/roles` | Role management |
| GET/POST/PUT/DELETE | `/v1/permissions` | Permission management |

### Expense Metadata

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/v1/expense-categories` | Expense categories |
| GET/POST/PUT/DELETE | `/v1/expense-policies` | Expense policies |
| GET/POST/PUT/DELETE | `/v1/projects` | Projects |

### Workflow

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/v1/workflow` | Approval workflow |

### AI / Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/chat` | LLM-powered expense chat |
| GET | `/v1/analytics` | Expense analytics |
| GET | `/v1/insights` | Expense insights |
| GET | `/v1/anomalies` | Anomaly detection |
| GET | `/v1/admin/analytics` | Admin analytics |
| GET/POST/PUT/DELETE | `/v1/llm-prompt-templates` | LLM prompt templates |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Full health status |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |

## Usage Examples

### Register a User

```bash
curl -X POST http://localhost:3002/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "SecurePass123!"}'
```

### Login

```bash
curl -X POST http://localhost:3002/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "SecurePass123!"}'
```

### Create Expense Report

```bash
curl -X POST http://localhost:3002/v1/expense-reports \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"title": "Business Trip Q1", "description": "Travel expenses"}'
```

### Upload Receipt with ICR

```bash
curl -X POST http://localhost:3002/v1/expense-reports/<report_id>/receipts \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@receipt.pdf" \
  -F "icr=true"
```

## Receipt Upload

- **Supported formats**: JPEG, PNG, GIF, WebP, PDF
- **Max file size**: 10MB (configurable)
- **Duplicate detection**: SHA-256 hash prevents duplicate uploads (returns 409 Conflict)
- **ICR parameter**: Set `icr=true` to parse receipt via external service
- **Storage**: Local filesystem by default; S3/R2 supported via env vars

## Database Schema

The database uses PostgreSQL 16 with pgvector. Tables:
- `users` - User accounts
- `refresh_tokens` - JWT refresh token storage
- `expense_reports` - Expense reports
- `expense_lines` - Individual expense items
- `receipts` - Uploaded receipt files
- `receipt_line_associations` - Many-to-many receipts ↔ lines
- `roles`, `permissions` - RBAC
- `expense_categories`, `expense_policies`, `projects` - Expense metadata
- `workflow` - Approval workflow state

See [src/db/schema.sql](src/db/schema.sql) for the full schema.

## Project Structure

```
expense-api/
├── src/
│   ├── config/          # Environment configuration (Zod-validated)
│   ├── db/              # Database client, schema, and seed files
│   ├── jobs/            # Background job scheduler
│   ├── middleware/      # Hono middleware
│   ├── routes/          # API route handlers
│   ├── schemas/         # Zod/OpenAPI schemas
│   ├── services/        # Business logic
│   ├── storage/         # File storage abstraction (local + S3/R2)
│   ├── types/           # TypeScript types
│   ├── utils/           # Utility functions
│   ├── app.ts           # Hono app setup and route registration
│   └── index.ts         # Entry point
├── Dockerfile
├── Dockerfile.dev
├── compose.dev.yaml
├── compose.prod.yaml
├── package.json
├── tsconfig.json
└── README.md
```

## Storage Abstraction

File storage is abstracted via the `StorageProvider` interface, supporting local disk and S3/R2 out of the box:

```typescript
interface StorageProvider {
  save(file: Buffer, filename: string): Promise<string>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getUrl(path: string): string;
}
```

When `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_BUCKET` are set, the S3 provider is used automatically.

## Scripts

```bash
npm run dev      # Start development server with hot reload (tsx watch)
npm run build    # Compile TypeScript to JavaScript
npm run start    # Start production server (dist/index.js)
npm run db:init  # Initialize schema and seed users
```

## Dev Container Setup
```bash
git config --global credential.helper '!/usr/bin/env code --hub-credential-helper'
```

## License

MIT
