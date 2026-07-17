package conversationlog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

var ErrNotFound = errors.New("conversation log not found")

// Record is one client-visible request/response turn ready for persistence.
type Record struct {
	ID                  int64      `json:"id"`
	RecordKey           string     `json:"-"`
	RequestID           string     `json:"request_id"`
	ConversationID      string     `json:"conversation_id"`
	TurnIndex           int        `json:"turn_index"`
	UserID              *int64     `json:"user_id,omitempty"`
	UsernameSnapshot    string     `json:"username_snapshot"`
	UserEmailSnapshot   string     `json:"user_email_snapshot"`
	APIKeyID            *int64     `json:"api_key_id,omitempty"`
	APIKeyNameSnapshot  string     `json:"api_key_name_snapshot"`
	GroupID             *int64     `json:"group_id,omitempty"`
	GroupNameSnapshot   string     `json:"group_name_snapshot"`
	AccountID           *int64     `json:"account_id,omitempty"`
	AccountNameSnapshot string     `json:"account_name_snapshot"`
	Provider            string     `json:"provider"`
	Endpoint            string     `json:"endpoint"`
	Protocol            string     `json:"protocol"`
	Transport           string     `json:"transport"`
	Model               string     `json:"model"`
	Status              string     `json:"status"`
	StatusCode          int        `json:"status_code"`
	LatencyMS           int64      `json:"latency_ms"`
	MessageCount        int        `json:"message_count"`
	ToolCallCount       int        `json:"tool_call_count"`
	HasReasoningSummary bool       `json:"has_reasoning_summary"`
	Preview             string     `json:"preview"`
	Truncated           bool       `json:"truncated"`
	StartedAt           time.Time  `json:"started_at"`
	CompletedAt         time.Time  `json:"completed_at"`
	ExpiresAt           time.Time  `json:"expires_at"`
	CreatedAt           time.Time  `json:"created_at"`
	Encoded             EncodedLog `json:"-"`
}

// Filter contains metadata-only conversation log filters.
type Filter struct {
	UserID    *int64     `json:"user_id,omitempty"`
	APIKeyID  *int64     `json:"api_key_id,omitempty"`
	GroupID   *int64     `json:"group_id,omitempty"`
	AccountID *int64     `json:"account_id,omitempty"`
	Provider  string     `json:"provider,omitempty"`
	Protocol  string     `json:"protocol,omitempty"`
	Transport string     `json:"transport,omitempty"`
	Model     string     `json:"model,omitempty"`
	Status    string     `json:"status,omitempty"`
	RequestID string     `json:"request_id,omitempty"`
	Keyword   string     `json:"keyword,omitempty"`
	StartAt   *time.Time `json:"start_at,omitempty"`
	EndAt     *time.Time `json:"end_at,omitempty"`
}

// Page is a paginated metadata-only result.
type Page struct {
	Items    []*Record `json:"items"`
	Total    int64     `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"page_size"`
	Pages    int       `json:"pages"`
}

// DeletePreview captures a stable high-water mark for destructive filtering.
type DeletePreview struct {
	MatchedCount  int64  `json:"matched_count"`
	SnapshotMaxID int64  `json:"snapshot_max_id"`
	FilterHash    string `json:"filter_hash"`
}

// FilterHash binds a delete filter to its preview high-water mark.
func FilterHash(filter Filter, snapshotMaxID int64) string {
	payload := struct {
		Filter Filter `json:"filter"`
		MaxID  int64  `json:"snapshot_max_id"`
	}{filter, snapshotMaxID}
	raw, _ := json.Marshal(payload)
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

// Repository persists compressed conversation turns.
type Repository interface {
	InsertBatch(context.Context, []*Record) (int64, error)
	List(context.Context, Filter, int, int) (*Page, error)
	Get(context.Context, int64) (*Record, error)
	PreviewDelete(context.Context, Filter) (*DeletePreview, error)
	DeleteByFilter(context.Context, Filter, int64, int) (int64, error)
	DeleteExpired(context.Context, time.Time, int) (int64, error)
}
