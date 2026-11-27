export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_verification_tokens
      ADD COLUMN email VARCHAR(254) NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_verification_tokens
      DROP COLUMN email;
  `);
};