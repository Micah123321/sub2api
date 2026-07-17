-- Compressed, admin-only conversation history.
-- One row represents one completed request/response turn. Binary media is
-- represented by metadata in the payload rather than copied into this table.
CREATE TABLE IF NOT EXISTS conversation_logs (
    id                    BIGSERIAL PRIMARY KEY,
    record_key            UUID NOT NULL,
    request_id            VARCHAR(128) NOT NULL DEFAULT '',
    conversation_id       VARCHAR(128) NOT NULL DEFAULT '',
    turn_index            INT NOT NULL DEFAULT 0,
    user_id               BIGINT REFERENCES users(id) ON DELETE SET NULL,
    username_snapshot     VARCHAR(255) NOT NULL DEFAULT '',
    user_email_snapshot   VARCHAR(320) NOT NULL DEFAULT '',
    api_key_id            BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
    api_key_name_snapshot VARCHAR(255) NOT NULL DEFAULT '',
    group_id              BIGINT REFERENCES groups(id) ON DELETE SET NULL,
    group_name_snapshot   VARCHAR(255) NOT NULL DEFAULT '',
    account_id            BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    account_name_snapshot VARCHAR(255) NOT NULL DEFAULT '',
    provider              VARCHAR(64) NOT NULL DEFAULT '',
    endpoint              VARCHAR(128) NOT NULL DEFAULT '',
    protocol              VARCHAR(64) NOT NULL DEFAULT '',
    transport             VARCHAR(16) NOT NULL,
    model                 VARCHAR(255) NOT NULL DEFAULT '',
    status                VARCHAR(16) NOT NULL,
    status_code           INT NOT NULL DEFAULT 0,
    latency_ms            BIGINT NOT NULL DEFAULT 0,
    message_count         INT NOT NULL DEFAULT 0,
    tool_call_count       INT NOT NULL DEFAULT 0,
    has_reasoning_summary BOOLEAN NOT NULL DEFAULT FALSE,
    payload_codec         VARCHAR(16) NOT NULL DEFAULT 'zstd',
    payload_schema        SMALLINT NOT NULL DEFAULT 1,
    payload_checksum      CHAR(64) NOT NULL,
    payload               BYTEA NOT NULL,
    raw_size_bytes        BIGINT NOT NULL,
    stored_size_bytes     BIGINT NOT NULL,
    preview               VARCHAR(512) NOT NULL DEFAULT '',
    truncated             BOOLEAN NOT NULL DEFAULT FALSE,
    started_at            TIMESTAMPTZ NOT NULL,
    completed_at          TIMESTAMPTZ NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_conversation_logs_turn_index
        CHECK (turn_index >= 0),
    CONSTRAINT chk_conversation_logs_status_code
        CHECK (status_code BETWEEN 0 AND 599),
    CONSTRAINT chk_conversation_logs_transport
        CHECK (transport IN ('http', 'sse', 'ws')),
    CONSTRAINT chk_conversation_logs_status
        CHECK (status IN ('completed', 'failed', 'partial', 'blocked', 'cancelled')),
    CONSTRAINT chk_conversation_logs_latency
        CHECK (latency_ms >= 0),
    CONSTRAINT chk_conversation_logs_counts
        CHECK (message_count >= 0 AND tool_call_count >= 0),
    CONSTRAINT chk_conversation_logs_payload_codec
        CHECK (payload_codec = 'zstd'),
    CONSTRAINT chk_conversation_logs_payload_schema
        CHECK (payload_schema >= 1),
    CONSTRAINT chk_conversation_logs_payload_checksum
        CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_conversation_logs_payload_sizes
        CHECK (
            raw_size_bytes >= 0 AND
            stored_size_bytes >= 0 AND
            stored_size_bytes = octet_length(payload)
        ),
    CONSTRAINT chk_conversation_logs_expiration
        CHECK (expires_at > created_at),
    CONSTRAINT chk_conversation_logs_timestamps
        CHECK (completed_at >= started_at),
    CONSTRAINT uq_conversation_logs_record_key
        UNIQUE (record_key)
);

-- The payload is already compressed with zstd. EXTERNAL keeps it out of the
-- main tuple without spending CPU on PostgreSQL's secondary TOAST compression.
ALTER TABLE conversation_logs
    ALTER COLUMN payload SET STORAGE EXTERNAL;

CREATE INDEX IF NOT EXISTS idx_conversation_logs_created
    ON conversation_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_expires
    ON conversation_logs (expires_at, id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_user_created
    ON conversation_logs (user_id, created_at DESC, id DESC)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_logs_api_key_created
    ON conversation_logs (api_key_id, created_at DESC, id DESC)
    WHERE api_key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_logs_group_created
    ON conversation_logs (group_id, created_at DESC, id DESC)
    WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_logs_account_created
    ON conversation_logs (account_id, created_at DESC, id DESC)
    WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_logs_protocol_model_created
    ON conversation_logs (protocol, model, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_request
    ON conversation_logs (request_id)
    WHERE request_id <> '';
