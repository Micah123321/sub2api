package repository

import (
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/stretchr/testify/require"
)

func TestBuildConversationLogWhereUsesMetadataOnly(t *testing.T) {
	start := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	userID := int64(42)
	where, args := buildConversationLogWhere(conversationlog.Filter{
		UserID: &userID, Protocol: " OpenAI_Responses ", Status: " Completed ", Keyword: "needle", StartAt: &start, EndAt: &end,
	})
	require.Contains(t, where, "l.user_id=$1")
	require.Contains(t, where, "l.protocol=$2")
	require.Contains(t, where, "l.preview ILIKE $4")
	require.NotContains(t, strings.ToLower(where), "payload")
	require.Len(t, args, 6)
}

func TestValidateConversationDeleteFilterRequiresExplicitRange(t *testing.T) {
	require.Error(t, validateConversationDeleteFilter(conversationlog.Filter{}))
	start := time.Now().UTC()
	end := start.Add(time.Hour)
	require.NoError(t, validateConversationDeleteFilter(conversationlog.Filter{StartAt: &start, EndAt: &end}))
}

func TestConversationLogInsertValuesStartWithStableRecordKey(t *testing.T) {
	record := &conversationlog.Record{RecordKey: "4db9de85-f0d2-40c3-a527-2f68365a3373"}
	values := conversationLogInsertValues(record)
	require.Equal(t, record.RecordKey, values[0])
	require.Equal(t, len(conversationLogInsertColumns), len(values))
}

func TestConversationLogInsertBatchTreatsIdempotentConflictAsAccepted(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectExec(`INSERT INTO conversation_logs .* ON CONFLICT \(record_key\) DO NOTHING`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	repo := NewConversationLogRepository(db)
	inserted, err := repo.InsertBatch(t.Context(), []*conversationlog.Record{{
		RecordKey: "4db9de85-f0d2-40c3-a527-2f68365a3373",
	}})
	require.NoError(t, err)
	require.Equal(t, int64(1), inserted)
	require.NoError(t, mock.ExpectationsWereMet())
}
