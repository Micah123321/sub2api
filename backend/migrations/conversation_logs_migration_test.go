package migrations

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConversationLogsMigrationDefinesCompressedRetainedTurns(t *testing.T) {
	content, err := FS.ReadFile("183_conversation_logs.sql")
	require.NoError(t, err)

	sql := strings.Join(strings.Fields(string(content)), " ")
	require.Contains(t, sql, "CREATE TABLE IF NOT EXISTS conversation_logs")
	require.Contains(t, sql, "record_key UUID NOT NULL")
	require.Contains(t, sql, "UNIQUE (record_key)")
	require.Contains(t, sql, "payload BYTEA NOT NULL")
	require.Contains(t, sql, "CHECK (payload_codec = 'zstd')")
	require.Contains(t, sql, "payload_checksum ~ '^[0-9a-f]{64}$'")
	require.Contains(t, sql, "stored_size_bytes = octet_length(payload)")
	require.Contains(t, sql, "expires_at TIMESTAMPTZ NOT NULL")
	require.Contains(t, sql, "ALTER COLUMN payload SET STORAGE EXTERNAL")
	require.Contains(t, sql, "transport IN ('http', 'sse', 'ws')")
	require.Contains(t, sql, "status IN ('completed', 'failed', 'partial', 'blocked', 'cancelled')")
	require.Contains(t, sql, "message_count >= 0 AND tool_call_count >= 0")
	require.Contains(t, sql, "has_reasoning_summary BOOLEAN NOT NULL DEFAULT FALSE")
	require.Contains(t, sql, "completed_at >= started_at")
}

func TestConversationLogsMigrationPreservesIdentitySnapshots(t *testing.T) {
	content, err := FS.ReadFile("183_conversation_logs.sql")
	require.NoError(t, err)

	sql := strings.Join(strings.Fields(string(content)), " ")
	for _, identity := range []string{"users", "api_keys", "groups", "accounts"} {
		require.Contains(t, sql, "REFERENCES "+identity+"(id) ON DELETE SET NULL")
	}
	for _, snapshot := range []string{
		"username_snapshot",
		"user_email_snapshot",
		"api_key_name_snapshot",
		"group_name_snapshot",
		"account_name_snapshot",
	} {
		require.Contains(t, sql, snapshot)
	}
}
