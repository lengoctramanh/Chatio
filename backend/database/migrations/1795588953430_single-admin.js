export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF (SELECT COUNT(*) FROM users WHERE global_role = 'admin') > 1 THEN
        RAISE EXCEPTION 'Migration failed: multiple admin accounts exist';
      END IF;
    END;
    $$;

    CREATE UNIQUE INDEX users_single_admin_idx
      ON users(global_role)
      WHERE global_role = 'admin';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS users_single_admin_idx;
  `);
};