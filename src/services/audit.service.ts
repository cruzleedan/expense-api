import { createHash } from 'crypto';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type {
  AuditLog,
  AuditLogChanges,
  AuditActionCategory,
  AuthUser,
} from '../types/index.js';

/**
 * Audit Service
 * Implements blockchain-style chain hashing for tamper-evident audit logs
 */

// Sensitive actions that require extra flagging
const SENSITIVE_ACTIONS = [
  'user.delete',
  'user.impersonate',
  'role.assign.admin',
  'role.assign.finance',
  'audit.export',
  'audit.archive',
  'system.restore',
  'emergency.access',
  'emergency.override',
  'report.force_approve',
  'workflow.override',
];

/**
 * Log an audit event with chain hashing
 */
export async function logAuditEvent(params: {
  actorId: string | null;
  actorEmail?: string;
  actorRoles?: string[];
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  action: string;
  actionCategory?: AuditActionCategory;
  resourceType: string;
  resourceId?: string;
  resourceVersion?: number;
  changes?: AuditLogChanges;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const {
    actorId,
    actorEmail,
    actorRoles,
    ipAddress,
    userAgent,
    sessionId,
    action,
    actionCategory,
    resourceType,
    resourceId,
    resourceVersion,
    changes,
    metadata,
  } = params;

  // Generate event ID
  const eventId = crypto.randomUUID();
  const timestamp = new Date();

  // Get previous event for chain hash
  const previousEventResult = await db.query<{ event_id: string; chain_hash: string }>(
    `SELECT event_id, chain_hash FROM audit_logs
     ORDER BY timestamp DESC
     LIMIT 1`
  );

  const previousEvent = previousEventResult.rows[0];

  // Calculate data hash (hash of event content)
  const hashInput = JSON.stringify({
    event_id: eventId,
    timestamp: timestamp.toISOString(),
    actor_id: actorId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    changes,
    metadata,
  }, Object.keys({
    event_id: eventId,
    timestamp: timestamp.toISOString(),
    actor_id: actorId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    changes,
    metadata,
  }).sort());

  const dataHash = createHash('sha256').update(hashInput).digest('hex');

  // Calculate chain hash (previous_chain_hash + data_hash)
  let chainHash: string;
  if (previousEvent) {
    const chainInput = `${previousEvent.chain_hash}|${dataHash}`;
    chainHash = createHash('sha256').update(chainInput).digest('hex');
  } else {
    chainHash = dataHash; // First event in chain
  }

  // Determine if this is a sensitive action
  const isSensitive = SENSITIVE_ACTIONS.includes(action);

  // Get actor details if not provided
  let finalActorEmail = actorEmail;
  let finalActorRoles = actorRoles;

  if (actorId && (!finalActorEmail || !finalActorRoles)) {
    const actorResult = await db.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [actorId]
    );
    if (actorResult.rows.length > 0) {
      finalActorEmail = finalActorEmail || actorResult.rows[0].email;
    }

    if (!finalActorRoles) {
      const rolesResult = await db.query<{ name: string }>(
        `SELECT r.name FROM roles r
         JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [actorId]
      );
      finalActorRoles = rolesResult.rows.map(r => r.name);
    }
  }

  // Insert audit log
  await db.query(
    `INSERT INTO audit_logs (
       event_id, timestamp, actor_id, actor_email, actor_roles,
       ip_address, user_agent, session_id,
       action, action_category, resource_type, resource_id, resource_version,
       changes, metadata,
       data_hash, chain_hash, previous_event_id,
       is_sensitive
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15,
       $16, $17, $18,
       $19
     )`,
    [
      eventId, timestamp, actorId, finalActorEmail, finalActorRoles,
      ipAddress || null, userAgent || null, sessionId || null,
      action, actionCategory || null, resourceType, resourceId || null, resourceVersion || null,
      changes ? JSON.stringify(changes) : null, metadata ? JSON.stringify(metadata) : null,
      dataHash, chainHash, previousEvent?.event_id || null,
      isSensitive,
    ]
  );

  // Log sensitive actions to system logger as well
  if (isSensitive) {
    logger.warn('Sensitive action performed', {
      eventId,
      action,
      actorId,
      actorEmail: finalActorEmail,
      resourceType,
      resourceId,
    });
  }

  return eventId;
}

/**
 * Helper function to log audit events from request context
 */
export async function logAuditFromContext(
  user: AuthUser | null,
  action: string,
  resourceType: string,
  resourceId: string | undefined,
  options?: {
    changes?: AuditLogChanges;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    actionCategory?: AuditActionCategory;
    resourceVersion?: number;
  }
): Promise<string> {
  return logAuditEvent({
    actorId: user?.id || null,
    actorEmail: user?.email,
    actorRoles: user?.roles,
    action,
    resourceType,
    resourceId,
    ...options,
  });
}

/**
 * Get audit logs with filtering
 */
export async function getAuditLogs(options: {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  actionCategory?: AuditActionCategory;
  startDate?: Date;
  endDate?: Date;
  isSensitive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AuditLog[]; total: number }> {
  const {
    actorId,
    resourceType,
    resourceId,
    action,
    actionCategory,
    startDate,
    endDate,
    isSensitive,
    limit = 50,
    offset = 0,
  } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (actorId) {
    conditions.push(`actor_id = $${paramIndex++}`);
    params.push(actorId);
  }
  if (resourceType) {
    conditions.push(`resource_type = $${paramIndex++}`);
    params.push(resourceType);
  }
  if (resourceId) {
    conditions.push(`resource_id = $${paramIndex++}`);
    params.push(resourceId);
  }
  if (action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(action);
  }
  if (actionCategory) {
    conditions.push(`action_category = $${paramIndex++}`);
    params.push(actionCategory);
  }
  if (startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(endDate);
  }
  if (isSensitive !== undefined) {
    conditions.push(`is_sensitive = $${paramIndex++}`);
    params.push(isSensitive);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // Get logs
  const logsResult = await db.query<AuditLog>(
    `SELECT * FROM audit_logs ${whereClause}
     ORDER BY timestamp DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return { logs: logsResult.rows, total };
}

/**
 * Get audit history for a specific resource
 */
export async function getResourceAuditHistory(
  resourceType: string,
  resourceId: string
): Promise<AuditLog[]> {
  const result = await db.query<AuditLog>(
    `SELECT * FROM audit_logs
     WHERE resource_type = $1 AND resource_id = $2
     ORDER BY timestamp ASC`,
    [resourceType, resourceId]
  );
  return result.rows;
}

/**
 * Verify audit log chain integrity
 */
export async function verifyChainIntegrity(
  startDate?: Date,
  endDate?: Date
): Promise<{
  totalEvents: number;
  verified: number;
  violations: Array<{ eventId: string; expectedHash: string; actualHash: string }>;
}> {
  let query = `SELECT event_id, data_hash, chain_hash, previous_event_id
               FROM audit_logs`;
  const params: unknown[] = [];

  if (startDate || endDate) {
    const conditions: string[] = [];
    if (startDate) {
      conditions.push(`timestamp >= $${params.length + 1}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`timestamp <= $${params.length + 1}`);
      params.push(endDate);
    }
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY timestamp ASC`;

  const result = await db.query<{
    event_id: string;
    data_hash: string;
    chain_hash: string;
    previous_event_id: string | null;
  }>(query, params);

  const events = result.rows;
  const violations: Array<{ eventId: string; expectedHash: string; actualHash: string }> = [];
  let verified = 0;

  // Build a map of event_id to chain_hash for quick lookup
  const chainHashMap = new Map<string, string>();
  for (const event of events) {
    chainHashMap.set(event.event_id, event.chain_hash);
  }

  for (const event of events) {
    let expectedChainHash: string;

    if (event.previous_event_id) {
      const previousChainHash = chainHashMap.get(event.previous_event_id);
      if (previousChainHash) {
        const chainInput = `${previousChainHash}|${event.data_hash}`;
        expectedChainHash = createHash('sha256').update(chainInput).digest('hex');
      } else {
        // Previous event not in our result set (might be outside date range)
        // We can't verify this event's chain hash
        continue;
      }
    } else {
      // First event in chain
      expectedChainHash = event.data_hash;
    }

    if (event.chain_hash === expectedChainHash) {
      verified++;
    } else {
      violations.push({
        eventId: event.event_id,
        expectedHash: expectedChainHash,
        actualHash: event.chain_hash,
      });
    }
  }

  return {
    totalEvents: events.length,
    verified,
    violations,
  };
}

/**
 * Export audit logs to JSON format
 */
export async function exportAuditLogs(options: {
  startDate: Date;
  endDate: Date;
  resourceType?: string;
  actorId?: string;
}): Promise<{
  exportDate: string;
  dateRange: { start: string; end: string };
  totalRecords: number;
  records: AuditLog[];
  integrityCheck: { verified: number; violations: number };
}> {
  const { logs, total } = await getAuditLogs({
    ...options,
    limit: 100000, // Large limit for export
    offset: 0,
  });

  const integrity = await verifyChainIntegrity(options.startDate, options.endDate);

  return {
    exportDate: new Date().toISOString(),
    dateRange: {
      start: options.startDate.toISOString(),
      end: options.endDate.toISOString(),
    },
    totalRecords: total,
    records: logs,
    integrityCheck: {
      verified: integrity.verified,
      violations: integrity.violations.length,
    },
  };
}

/**
 * Calculate changes between old and new values
 */
export function calculateChanges(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  fieldsToTrack?: string[]
): AuditLogChanges {
  const changes: AuditLogChanges = {};
  const fields = fieldsToTrack || [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])];

  for (const field of fields) {
    const oldVal = oldValue[field];
    const newVal = newValue[field];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { from: oldVal, to: newVal };
    }
  }

  return changes;
}
