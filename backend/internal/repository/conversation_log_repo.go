package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
)

type conversationLogRepository struct{ db *sql.DB }

// NewConversationLogRepository creates the compressed conversation log repository.
func NewConversationLogRepository(db *sql.DB) conversationlog.Repository {
	return &conversationLogRepository{db: db}
}

var conversationLogInsertColumns = []string{
	"record_key", "request_id", "conversation_id", "turn_index", "user_id", "username_snapshot", "user_email_snapshot",
	"api_key_id", "api_key_name_snapshot", "group_id", "group_name_snapshot", "account_id", "account_name_snapshot",
	"provider", "endpoint", "protocol", "transport", "model", "status", "status_code", "latency_ms",
	"message_count", "tool_call_count", "has_reasoning_summary", "payload_codec", "payload_schema", "payload_checksum",
	"payload", "raw_size_bytes", "stored_size_bytes", "preview", "truncated", "started_at", "completed_at", "expires_at",
}

func (r *conversationLogRepository) InsertBatch(ctx context.Context, records []*conversationlog.Record) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("nil conversation log repository")
	}
	if len(records) == 0 {
		return 0, nil
	}
	values := make([]any, 0, len(records)*len(conversationLogInsertColumns))
	rows := make([]string, 0, len(records))
	for _, record := range records {
		if record == nil {
			continue
		}
		if record.RecordKey == "" {
			return 0, errors.New("conversation log record key is required")
		}
		rowValues := conversationLogInsertValues(record)
		placeholders := make([]string, len(rowValues))
		for i := range rowValues {
			placeholders[i] = fmt.Sprintf("$%d", len(values)+i+1)
		}
		rows = append(rows, "("+strings.Join(placeholders, ",")+")")
		values = append(values, rowValues...)
	}
	if len(rows) == 0 {
		return 0, nil
	}
	query := "INSERT INTO conversation_logs (" + strings.Join(conversationLogInsertColumns, ",") + ") VALUES " +
		strings.Join(rows, ",") + " ON CONFLICT (record_key) DO NOTHING"
	_, err := r.db.ExecContext(ctx, query, values...)
	if err != nil {
		return 0, err
	}
	return int64(len(rows)), nil
}

func conversationLogInsertValues(record *conversationlog.Record) []any {
	return []any{
		record.RecordKey, truncateString(record.RequestID, 128), truncateString(record.ConversationID, 128), record.TurnIndex,
		nullInt64Ptr(record.UserID), truncateString(record.UsernameSnapshot, 255), truncateString(record.UserEmailSnapshot, 320),
		nullInt64Ptr(record.APIKeyID), truncateString(record.APIKeyNameSnapshot, 255), nullInt64Ptr(record.GroupID),
		truncateString(record.GroupNameSnapshot, 255), nullInt64Ptr(record.AccountID), truncateString(record.AccountNameSnapshot, 255),
		truncateString(record.Provider, 64), truncateString(record.Endpoint, 128), truncateString(record.Protocol, 64),
		record.Transport, truncateString(record.Model, 255), record.Status, record.StatusCode, record.LatencyMS,
		record.MessageCount, record.ToolCallCount, record.HasReasoningSummary, "zstd", record.Encoded.SchemaVersion,
		record.Encoded.Checksum, record.Encoded.Payload, record.Encoded.RawSize, record.Encoded.CompressedSize,
		truncateString(record.Preview, 512), record.Truncated, record.StartedAt.UTC(), record.CompletedAt.UTC(), record.ExpiresAt.UTC(),
	}
}

func (r *conversationLogRepository) List(ctx context.Context, filter conversationlog.Filter, page, pageSize int) (*conversationlog.Page, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	where, args := buildConversationLogWhere(filter)
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM conversation_logs l "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	queryArgs := append([]any(nil), args...)
	queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	rows, err := r.db.QueryContext(ctx, "SELECT "+conversationLogListColumns+" FROM conversation_logs l "+where+
		fmt.Sprintf(" ORDER BY l.created_at DESC,l.id DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2), queryArgs...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]*conversationlog.Record, 0, pageSize)
	for rows.Next() {
		item, err := scanConversationLog(rows, false)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	pages := 0
	if total > 0 {
		pages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	return &conversationlog.Page{Items: items, Total: total, Page: page, PageSize: pageSize, Pages: pages}, nil
}

func (r *conversationLogRepository) Get(ctx context.Context, id int64) (*conversationlog.Record, error) {
	item, err := scanConversationLog(r.db.QueryRowContext(ctx,
		"SELECT "+conversationLogDetailColumns+" FROM conversation_logs l WHERE l.id=$1", id), true)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, conversationlog.ErrNotFound
	}
	return item, err
}

func (r *conversationLogRepository) PreviewDelete(ctx context.Context, filter conversationlog.Filter) (*conversationlog.DeletePreview, error) {
	if err := validateConversationDeleteFilter(filter); err != nil {
		return nil, err
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	where, args := buildConversationLogWhere(filter)
	var count, maxID int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(MAX(l.id),0) FROM conversation_logs l "+where, args...).Scan(&count, &maxID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &conversationlog.DeletePreview{MatchedCount: count, SnapshotMaxID: maxID, FilterHash: conversationlog.FilterHash(filter, maxID)}, nil
}

func (r *conversationLogRepository) DeleteByFilter(ctx context.Context, filter conversationlog.Filter, snapshotMaxID int64, batchSize int) (int64, error) {
	if err := validateConversationDeleteFilter(filter); err != nil {
		return 0, err
	}
	if snapshotMaxID <= 0 {
		return 0, nil
	}
	if batchSize < 1 || batchSize > 1000 {
		batchSize = 200
	}
	var deleted int64
	for {
		where, args := buildConversationLogWhere(filter)
		args = append(args, snapshotMaxID, batchSize)
		result, err := r.db.ExecContext(ctx, `WITH selected AS (
			SELECT l.id FROM conversation_logs l `+where+fmt.Sprintf(` AND l.id <= $%d
			ORDER BY l.id LIMIT $%d FOR UPDATE SKIP LOCKED
		) DELETE FROM conversation_logs l USING selected s WHERE l.id=s.id`, len(args)-1, len(args)), args...)
		if err != nil {
			return deleted, err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return deleted, err
		}
		deleted += count
		if count < int64(batchSize) {
			return deleted, nil
		}
	}
}

func (r *conversationLogRepository) DeleteExpired(ctx context.Context, cutoff time.Time, batchSize int) (int64, error) {
	if batchSize < 1 || batchSize > 10000 {
		batchSize = 5000
	}
	result, err := r.db.ExecContext(ctx, `WITH selected AS (
		SELECT id FROM conversation_logs WHERE expires_at <= $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
	) DELETE FROM conversation_logs l USING selected s WHERE l.id=s.id`, cutoff.UTC(), batchSize)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

const conversationLogListColumns = `l.id,l.request_id,l.conversation_id,l.turn_index,l.user_id,l.username_snapshot,
	l.user_email_snapshot,l.api_key_id,l.api_key_name_snapshot,l.group_id,l.group_name_snapshot,l.account_id,
	l.account_name_snapshot,l.provider,l.endpoint,l.protocol,l.transport,l.model,l.status,l.status_code,l.latency_ms,
	l.message_count,l.tool_call_count,l.has_reasoning_summary,l.raw_size_bytes,l.stored_size_bytes,l.preview,l.truncated,
	l.started_at,l.completed_at,l.expires_at,l.created_at`

const conversationLogDetailColumns = conversationLogListColumns + `,l.payload_codec,l.payload_schema,l.payload_checksum,l.payload`

type conversationRow interface{ Scan(...any) error }

func scanConversationLog(row conversationRow, detail bool) (*conversationlog.Record, error) {
	item := &conversationlog.Record{}
	var userID, apiKeyID, groupID, accountID sql.NullInt64
	var payloadCodec string
	dest := []any{&item.ID, &item.RequestID, &item.ConversationID, &item.TurnIndex, &userID, &item.UsernameSnapshot,
		&item.UserEmailSnapshot, &apiKeyID, &item.APIKeyNameSnapshot, &groupID, &item.GroupNameSnapshot, &accountID,
		&item.AccountNameSnapshot, &item.Provider, &item.Endpoint, &item.Protocol, &item.Transport, &item.Model, &item.Status,
		&item.StatusCode, &item.LatencyMS, &item.MessageCount, &item.ToolCallCount, &item.HasReasoningSummary,
		&item.Encoded.RawSize, &item.Encoded.CompressedSize, &item.Preview, &item.Truncated, &item.StartedAt, &item.CompletedAt,
		&item.ExpiresAt, &item.CreatedAt}
	if detail {
		dest = append(dest, &payloadCodec, &item.Encoded.SchemaVersion, &item.Encoded.Checksum, &item.Encoded.Payload)
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	item.UserID = nullInt64Pointer(userID)
	item.APIKeyID = nullInt64Pointer(apiKeyID)
	item.GroupID = nullInt64Pointer(groupID)
	item.AccountID = nullInt64Pointer(accountID)
	if detail {
		if payloadCodec != "zstd" {
			return nil, fmt.Errorf("unsupported conversation log codec %q", payloadCodec)
		}
		item.Encoded.CodecVersion = conversationlog.CodecVersion
	}
	return item, nil
}

func nullInt64Pointer(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func buildConversationLogWhere(filter conversationlog.Filter) (string, []any) {
	clauses := []string{"TRUE"}
	args := make([]any, 0, 12)
	add := func(expression string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(expression, len(args)))
	}
	if filter.UserID != nil {
		add("l.user_id=$%d", *filter.UserID)
	}
	if filter.APIKeyID != nil {
		add("l.api_key_id=$%d", *filter.APIKeyID)
	}
	if filter.GroupID != nil {
		add("l.group_id=$%d", *filter.GroupID)
	}
	if filter.AccountID != nil {
		add("l.account_id=$%d", *filter.AccountID)
	}
	if value := strings.TrimSpace(strings.ToLower(filter.Provider)); value != "" {
		add("l.provider=$%d", value)
	}
	if value := strings.TrimSpace(strings.ToLower(filter.Protocol)); value != "" {
		add("l.protocol=$%d", value)
	}
	if value := strings.TrimSpace(strings.ToLower(filter.Transport)); value != "" {
		add("l.transport=$%d", value)
	}
	if value := strings.TrimSpace(filter.Model); value != "" {
		add("l.model=$%d", value)
	}
	if value := strings.TrimSpace(strings.ToLower(filter.Status)); value != "" {
		add("l.status=$%d", value)
	}
	if value := strings.TrimSpace(filter.RequestID); value != "" {
		add("l.request_id=$%d", value)
	}
	if value := strings.TrimSpace(filter.Keyword); value != "" {
		add(`(l.request_id ILIKE $%[1]d OR l.model ILIKE $%[1]d OR l.preview ILIKE $%[1]d OR
			l.username_snapshot ILIKE $%[1]d OR l.user_email_snapshot ILIKE $%[1]d OR l.api_key_name_snapshot ILIKE $%[1]d)`, "%"+escapeLikePattern(truncateString(value, 128))+"%")
	}
	if filter.StartAt != nil {
		add("l.created_at >= $%d", filter.StartAt.UTC())
	}
	if filter.EndAt != nil {
		add("l.created_at <= $%d", filter.EndAt.UTC())
	}
	return "WHERE " + strings.Join(clauses, " AND "), args
}

func validateConversationDeleteFilter(filter conversationlog.Filter) error {
	if filter.StartAt == nil || filter.EndAt == nil || !filter.StartAt.Before(*filter.EndAt) {
		return errors.New("conversation log filter delete requires a valid explicit time range")
	}
	return nil
}
