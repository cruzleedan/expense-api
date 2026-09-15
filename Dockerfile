# Clean, lockfile-based installation shared by build and verification stages.
FROM node:22-alpine AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM dependencies AS builder
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Runs the same repository gates as CI without using host node_modules.
FROM builder AS verification
RUN apk add --no-cache bash coreutils postgresql-client
COPY scripts ./scripts
COPY context ./context
COPY contracts ./contracts
COPY AGENTS.md README.md ./
RUN npm run check

FROM builder AS production-dependencies
RUN npm prune --omit=dev
# Keep production-only metadata consistent with its actual installed tree.
# npm 10 otherwise rejects missing dev declarations during SBOM generation, and
# a pre-prune --omit=dev SBOM can omit dependencies promoted by pruning.
RUN npm pkg delete devDependencies
RUN npm sbom --omit=dev --sbom-format=cyclonedx --sbom-type=application > sbom.cdx.json
# Fail closed on production high/critical findings, including registry errors.
RUN npm audit --omit=dev --audit-level=high

# Production stage
FROM node:22-alpine AS production

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=production-dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=nodejs:nodejs /app/package*.json ./
COPY --from=production-dependencies --chown=nodejs:nodejs /app/sbom.cdx.json ./

RUN mkdir -p /app/uploads && chown nodejs:nodejs /app/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

CMD ["node", "dist/index.js"]
