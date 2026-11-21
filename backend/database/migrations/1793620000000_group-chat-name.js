/**
 * Task 6B: thêm cột tên nhóm (name) cho bảng conversations.
 * Giữ nguyên migration cũ, chỉ bổ sung cột và quyền truy cập cần thiết.
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations
      ADD COLUMN name VARCHAR(100);

    ALTER TABLE conversations
      ADD CONSTRAINT conversations_group_name_check
        CHECK (
          (type = 'direct' AND name IS NULL)
          OR (type = 'group' AND name IS NOT NULL AND char_length(btrim(name)) BETWEEN 1 AND 100)
        );

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatio_app') THEN
        GRANT SELECT, INSERT, UPDATE (name) ON TABLE conversations TO chatio_app;
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conversations
      DROP CONSTRAINT IF EXISTS conversations_group_name_check,
      DROP COLUMN IF EXISTS name;
  `);
};