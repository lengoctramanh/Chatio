/**
 * Task 6A: mỗi cặp tài khoản chỉ có một chat riêng.
 * Giữ nguyên migration Task 4, chỉ bổ sung bảng ánh xạ và quyền truy cập cần thiết.
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE direct_conversation_pairs (
      conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      user_low UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      user_high UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT direct_pair_order CHECK (user_low < user_high),
      CONSTRAINT direct_pair_unique UNIQUE (user_low, user_high)
    );

    -- Giữ lại hội thoại riêng đã tồn tại trước migration (nếu có).
    -- Nếu dữ liệu cũ trùng cặp, UNIQUE làm migration thất bại thay vì âm thầm bỏ sót.
    WITH old_pairs AS (
      SELECT c.id, ARRAY_AGG(DISTINCT m.user_id ORDER BY m.user_id) AS users
        FROM conversations c
        JOIN conversation_members m ON m.conversation_id = c.id AND m.left_at IS NULL
       WHERE c.type = 'direct'
       GROUP BY c.id
      HAVING COUNT(DISTINCT m.user_id) = 2
    )
    INSERT INTO direct_conversation_pairs (conversation_id, user_low, user_high)
    SELECT id, users[1], users[2] FROM old_pairs;

    -- PostgreSQL cần UPDATE privilege trên ít nhất một cột cho SELECT FOR UPDATE/FOR SHARE.
    -- Chỉ cấp UPDATE trên cột trạng thái hội thoại và thời điểm rời nhóm, không cấp DELETE.
    -- Hỗ trợ cả môi trường test không tạo role chatio_app.
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatio_app') THEN
        GRANT SELECT, INSERT ON TABLE conversations, conversation_members,
          messages, direct_conversation_pairs TO chatio_app;
        GRANT UPDATE (status) ON TABLE conversations TO chatio_app;
        GRANT UPDATE (left_at) ON TABLE conversation_members TO chatio_app;
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE direct_conversation_pairs;');
};
