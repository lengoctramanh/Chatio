import { pool } from '../db/pool.js';

const FORBIDDEN_KEYS =
  /pass|token|secret|cookie|hash|key|otp|recovery|csrf|code|url/i;

const redact = (metadata) => {
  if (!metadata) return null;

  const safe = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) continue;

    if (typeof value === 'string') {
      safe[key] = value.slice(0, 200);
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value;
    }
  }

  return JSON.stringify(safe);
};

export const writeAudit = async (event, db = pool) => {
  try {
    await db.query(
      `INSERT INTO audit_logs
        (actor_user_id, event_type, outcome, client_ip, metadata_redacted)
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
    if (db !== pool) throw error;

    console.error('Không ghi được audit log');
  }
};