import { pool } from '../db/pool.js';

// Các key không bao giờ được ghi vào nhật ký (SEC-07).
const FORBIDDEN_KEYS = /pass|token|secret|cookie|hash|key/i;

const redact = (metadata) => {
  if (!metadata) return null;
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    safe[key] = typeof value === 'string' ? value.slice(0, 200) : value;
  }
  return JSON.stringify(safe);
};

/**
 * Ghi một sự kiện vào audit_logs. Lỗi ghi log không làm hỏng request.
 * @param {{ actorUserId?: string|null, eventType: string, outcome: 'success'|'failure',
 *           ip?: string|null, metadata?: Record<string, unknown> }} event
 * @param {import('pg').PoolClient | import('pg').Pool} [db]
 */
export const writeAudit = async (event, db = pool) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, event_type, outcome, client_ip, metadata_redacted)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.actorUserId ?? null,
        event.eventType,
        event.outcome,
        event.ip?.slice(0, 45) ?? null,
        redact(event.metadata),
      ]
    );
  } catch (error) {
    if (db !== pool) throw error; // trong transaction thì để transaction rollback
    console.error('Không ghi được audit log:', error.message);
  }
};
