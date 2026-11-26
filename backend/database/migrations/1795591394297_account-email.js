export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN email VARCHAR(254),
      ADD COLUMN email_verified_at TIMESTAMPTZ;

    CREATE UNIQUE INDEX users_email_unique_idx
      ON users (LOWER(email))
      WHERE email IS NOT NULL;

    ALTER TABLE users
      ADD CONSTRAINT users_email_verification_check
      CHECK (email_verified_at IS NULL OR email IS NOT NULL);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS users_email_unique_idx;

    ALTER TABLE users
      DROP CONSTRAINT users_email_verification_check,
      DROP COLUMN email_verified_at,
      DROP COLUMN email;
  `);
};