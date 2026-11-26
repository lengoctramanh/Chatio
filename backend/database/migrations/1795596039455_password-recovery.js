export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      requested_ip VARCHAR(45),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CHECK (expires_at > created_at),
      CHECK (used_at IS NULL OR used_at >= created_at)
    );

    CREATE INDEX password_reset_user_idx
      ON password_reset_tokens(user_id);

    CREATE INDEX password_reset_expiry_idx
      ON password_reset_tokens(expires_at);

    CREATE TABLE admin_recovery_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at TIMESTAMPTZ,

      CHECK (used_at IS NULL OR used_at >= created_at)
    );

    CREATE INDEX admin_recovery_user_idx
      ON admin_recovery_codes(user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE admin_recovery_codes;
    DROP TABLE password_reset_tokens;
  `);
};