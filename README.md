# Expense API

A mobile-first REST API for expense management built with Hono, TypeScript, and PostgreSQL.

## Features

- **Authentication**: JWT-based auth with `jose`, OAuth2 support for Google and Facebook
- **Expense Reports**: Create, read, update, delete expense reports
- **Expense Lines**: Manage individual expense items within reports
- **Receipts**: Upload receipt images/PDFs with duplicate detection (SHA-256)
- **Receipt Parsing**: Optional ICR integration with external parser service
- **Rate Limiting**: Configurable rate limits per endpoint
- **Pagination**: All list endpoints support pagination

## Tech Stack

- **Runtime**: Node.js 22 LTS
- **Framework**: Hono
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL (native SQL)
- **Authentication**: JWT with `jose`
- **Validation**: Zod
- **Containerization**: Docker

## Quick Start

### Using Docker (Recommended)

No local Node.js or npm required - everything runs in containers.

```bash
# Clone the repository
git clone <repository-url>
cd expense-api

# First time only: generate package-lock.json
./scripts/init.sh

# Start all services (development mode with hot reload)
docker compose up -d

# The API will be available at http://localhost:3000

# View logs
docker compose logs -f expense-api

# Stop services
docker compose down
```

### Production Build

```bash
# Build and run production image
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
  postgres:16-alpine

# Initialize database schema
psql $DATABASE_URL -f src/db/schema.sql

# Start development server
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production) | development |
| `PORT` | Server port | 3000 |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | required |
| `JWT_ACCESS_EXPIRES_IN` | Access token expiry | 15m |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiry | 7d |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | optional |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | optional |
| `FACEBOOK_CLIENT_ID` | Facebook OAuth client ID | optional |
| `FACEBOOK_CLIENT_SECRET` | Facebook OAuth client secret | optional |
| `UPLOAD_DIR` | Receipt upload directory | ./uploads |
| `MAX_FILE_SIZE` | Max upload size in bytes | 10485760 |
| `RECEIPT_PARSER_URL` | Receipt parser service URL | http://receipt-parser-app:3000 |

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register with email/password |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout (revoke refresh token) |
| GET | `/auth/google` | Initiate Google OAuth |
| GET | `/auth/google/callback` | Google OAuth callback |
| GET | `/auth/facebook` | Initiate Facebook OAuth |
| GET | `/auth/facebook/callback` | Facebook OAuth callback |

### Expense Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/expense-reports` | List reports (paginated) |
| POST | `/expense-reports` | Create report |
| GET | `/expense-reports/:id` | Get report |
| PUT | `/expense-reports/:id` | Update report |
| DELETE | `/expense-reports/:id` | Delete report |

### Expense Lines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/expense-reports/:reportId/lines` | List lines (paginated) |
| POST | `/expense-reports/:reportId/lines` | Create line |
| GET | `/expense-lines/:id` | Get line |
| PUT | `/expense-lines/:id` | Update line |
| DELETE | `/expense-lines/:id` | Delete line |

### Receipts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/expense-reports/:reportId/receipts` | List receipts (paginated) |
| POST | `/expense-reports/:reportId/receipts` | Upload receipt |
| GET | `/receipts/:id` | Get receipt |
| GET | `/receipts/:id/file` | Download receipt file |
| DELETE | `/receipts/:id` | Delete receipt |
| POST | `/receipts/:id/associate` | Link to expense lines |
| DELETE | `/receipts/:id/associate/:lineId` | Remove association |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Full health status |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |

## Usage Examples

### Register a User

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "securepassword123"}'
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "securepassword123"}'
```

### Create Expense Report

```bash
curl -X POST http://localhost:3000/expense-reports \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"title": "Business Trip Q1", "description": "Travel expenses"}'
```

### Upload Receipt with ICR

```bash
curl -X POST http://localhost:3000/expense-reports/<report_id>/receipts \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@receipt.pdf" \
  -F "icr=true"
```

## Receipt Upload

- **Supported formats**: JPEG, PNG, GIF, WebP, PDF
- **Max file size**: 10MB (configurable)
- **Duplicate detection**: SHA-256 hash prevents duplicate uploads (returns 409 Conflict)
- **ICR parameter**: Set `icr=true` to parse receipt via external service

## Database Schema

The database uses native PostgreSQL with the following tables:
- `users` - User accounts
- `refresh_tokens` - JWT refresh token storage
- `expense_reports` - Expense reports
- `expense_lines` - Individual expense items
- `receipts` - Uploaded receipt files
- `receipt_line_associations` - Many-to-many receipts ↔ lines

See [src/db/schema.sql](src/db/schema.sql) for the full schema.

## Project Structure

```
expense-api/
├── src/
│   ├── config/          # Environment configuration
│   ├── db/              # Database client and schema
│   ├── middleware/      # Hono middleware
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic
│   ├── storage/         # File storage abstraction
│   ├── types/           # TypeScript types
│   ├── utils/           # Utility functions
│   ├── app.ts           # Hono app setup
│   └── index.ts         # Entry point
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── README.md
```

## Storage Abstraction

File storage is abstracted via the `StorageProvider` interface, making it easy to migrate to cloud storage (S3, GCS) by implementing the interface:

```typescript
interface StorageProvider {
  save(file: Buffer, filename: string): Promise<string>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getUrl(path: string): string;
}
```

## Scripts

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build TypeScript to JavaScript
npm run start    # Start production server
npm run db:init  # Initialize database schema
```

## Dev Container Setup
```bash
git config --global credential.helper '!/usr/bin/env code --hub-credential-helper'
```

## License

MIT
