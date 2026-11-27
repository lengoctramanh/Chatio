export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT email_verification_expiry_check
        CHECK (expires_at > created_at),

      CONSTRAINT email_verification_used_at_check
        CHECK (used_at IS NULL OR used_at >= created_at)
    );

    CREATE INDEX email_verification_user_id_idx
      ON email_verification_tokens(user_id);

    CREATE INDEX email_verification_expires_at_idx
      ON email_verification_tokens(expires_at);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS email_verification_tokens;
  `);
};