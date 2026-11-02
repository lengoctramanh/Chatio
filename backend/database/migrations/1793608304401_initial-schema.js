/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Tạo cấu trúc database.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,

      global_role VARCHAR(20) NOT NULL DEFAULT 'user',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT users_global_role_check
        CHECK (global_role IN ('admin', 'user')),

      CONSTRAINT users_status_check
        CHECK (status IN ('active', 'locked', 'disabled')),

      CONSTRAINT users_username_length_check
        CHECK (char_length(username) BETWEEN 3 AND 50)
    );

    CREATE TABLE sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      token_hash VARCHAR(255) NOT NULL UNIQUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,

      CONSTRAINT sessions_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

      CONSTRAINT sessions_expiry_check
        CHECK (expires_at > created_at),

      CONSTRAINT sessions_revoked_at_check
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    );

    CREATE TABLE conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT conversations_creator_fk
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT,

      CONSTRAINT conversations_type_check
        CHECK (type IN ('direct', 'group')),

      CONSTRAINT conversations_status_check
        CHECK (status IN ('active', 'closed'))
    );

    CREATE TABLE conversation_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL,
      user_id UUID NOT NULL,

      member_role VARCHAR(20) NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      left_at TIMESTAMPTZ,

      CONSTRAINT conversation_members_conversation_fk
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

      CONSTRAINT conversation_members_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE RESTRICT,

      CONSTRAINT conversation_members_role_check
        CHECK (member_role IN ('owner', 'admin', 'member')),

      CONSTRAINT conversation_members_time_check
        CHECK (left_at IS NULL OR left_at >= joined_at)
    );

    CREATE TABLE messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL,
      sender_id UUID NOT NULL,
      client_msg_id UUID NOT NULL,

      body_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT messages_conversation_fk
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

      CONSTRAINT messages_sender_fk
        FOREIGN KEY (sender_id)
        REFERENCES users(id)
        ON DELETE RESTRICT,

      CONSTRAINT messages_sender_client_id_unique
        UNIQUE (sender_id, client_msg_id),

      CONSTRAINT messages_id_conversation_unique
        UNIQUE (id, conversation_id),

      CONSTRAINT messages_body_length_check
        CHECK (
          body_text IS NULL
          OR char_length(body_text) <= 4000
        )
    );

    CREATE TABLE files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL,
      conversation_id UUID NOT NULL,
      uploaded_by UUID NOT NULL,

      original_name VARCHAR(255) NOT NULL,
      storage_key VARCHAR(500) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT files_message_conversation_fk
        FOREIGN KEY (message_id, conversation_id)
        REFERENCES messages(id, conversation_id)
        ON DELETE CASCADE,

      CONSTRAINT files_uploader_fk
        FOREIGN KEY (uploaded_by)
        REFERENCES users(id)
        ON DELETE RESTRICT,

      CONSTRAINT files_status_check
        CHECK (status IN ('pending', 'ready', 'rejected')),

      CONSTRAINT files_size_check
        CHECK (
          size_bytes >= 0
          AND size_bytes <= 10485760
        )
    );

    CREATE TABLE audit_logs (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_user_id UUID,

      event_type VARCHAR(100) NOT NULL,
      outcome VARCHAR(20) NOT NULL,
      client_ip VARCHAR(45),
      metadata_redacted TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT audit_logs_actor_fk
        FOREIGN KEY (actor_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL,

      CONSTRAINT audit_logs_outcome_check
        CHECK (outcome IN ('success', 'failure'))
    );

    CREATE INDEX sessions_user_id_idx
      ON sessions(user_id);

    CREATE INDEX sessions_expires_at_idx
      ON sessions(expires_at);

    CREATE INDEX conversations_created_by_idx
      ON conversations(created_by);

    CREATE INDEX conversation_members_conversation_id_idx
      ON conversation_members(conversation_id);

    CREATE INDEX conversation_members_user_id_idx
      ON conversation_members(user_id);

    CREATE UNIQUE INDEX conversation_members_active_unique_idx
      ON conversation_members(conversation_id, user_id)
      WHERE left_at IS NULL;

    CREATE INDEX messages_conversation_created_at_idx
      ON messages(conversation_id, created_at DESC);

    CREATE INDEX messages_sender_id_idx
      ON messages(sender_id);

    CREATE INDEX files_conversation_id_idx
      ON files(conversation_id);

    CREATE INDEX files_uploaded_by_idx
      ON files(uploaded_by);

    CREATE INDEX audit_logs_actor_user_id_idx
      ON audit_logs(actor_user_id);

    CREATE INDEX audit_logs_created_at_idx
      ON audit_logs(created_at DESC);

    CREATE INDEX audit_logs_event_type_idx
      ON audit_logs(event_type);
  `);
};

/**
 * Hoàn tác migration.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_logs;
    DROP TABLE IF EXISTS files;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversation_members;
    DROP TABLE IF EXISTS conversations;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
  `);
};