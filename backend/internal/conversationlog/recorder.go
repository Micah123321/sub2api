package conversationlog

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const previewMaxRunes = 240

var (
	ErrRecorderFinalized = errors.New("conversation log recorder already finalized")
	ErrInvalidRetention  = errors.New("conversation log retention must be positive")
)

// Meta identifies one client-visible request/response turn.
type Meta struct {
	RequestID           string
	ConversationID      string
	TurnIndex           int
	UserID              *int64
	UsernameSnapshot    string
	UserEmailSnapshot   string
	APIKeyID            *int64
	APIKeyNameSnapshot  string
	GroupID             *int64
	GroupNameSnapshot   string
	AccountID           *int64
	AccountNameSnapshot string
	Provider            string
	Endpoint            string
	Protocol            string
	Transport           string
	Model               string
	StartedAt           time.Time
}

// Recorder captures one turn and is safe for concurrent stream callbacks.
type Recorder struct {
	mu                  sync.Mutex
	meta                Meta
	capture             Capture
	sequence            int64
	messageCount        int
	toolCallCount       int
	hasReasoningSummary bool
	responseStarted     bool
	preview             string
	finalized           *Record
}

// NewRecorder creates a bounded, turn-local recorder.
func NewRecorder(meta Meta, maxBytes int) *Recorder {
	if meta.StartedAt.IsZero() {
		meta.StartedAt = time.Now().UTC()
	}
	return &Recorder{meta: meta, capture: Capture{MaxBytes: maxBytes}}
}

// SetAccount updates the upstream account selected for this turn.
func (r *Recorder) SetAccount(accountID int64, accountName string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finalized != nil {
		return ErrRecorderFinalized
	}
	if accountID <= 0 {
		return nil
	}
	r.meta.AccountID = &accountID
	r.meta.AccountNameSnapshot = accountName
	return nil
}

// AddRequest records normalized client input and counts its messages.
func (r *Recorder) AddRequest(payload any) error {
	return r.add(EventRequest, payload, func(value any) {
		r.messageCount += requestMessageCount(value)
		if containsReasoningSummary(value) {
			r.hasReasoningSummary = true
		}
		if r.preview == "" {
			r.preview = preview(value)
		}
	})
}

// AddDelta records a response fragment. All fragments form one assistant message.
func (r *Recorder) AddDelta(payload any) error {
	return r.add(EventDelta, payload, func(value any) {
		if !r.responseStarted {
			r.responseStarted = true
			r.messageCount++
		}
		if containsReasoningSummary(value) {
			r.hasReasoningSummary = true
		}
	})
}

// AddTool records one tool call or tool result.
func (r *Recorder) AddTool(payload any) error {
	return r.add(EventTool, payload, func(value any) {
		r.toolCallCount++
		if containsReasoningSummary(value) {
			r.hasReasoningSummary = true
		}
	})
}

// Finalize encodes the captured turn. Repeated calls return the first result.
func (r *Recorder) Finalize(status string, statusCode int, retention time.Duration) (*Record, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finalized != nil {
		return r.finalized, nil
	}
	if retention <= 0 {
		return nil, ErrInvalidRetention
	}
	if !validFinalStatus(status) {
		return nil, fmt.Errorf("invalid conversation log status %q", status)
	}

	completedAt := time.Now().UTC()
	r.sequence++
	if err := r.addFinalize(status, statusCode, completedAt); err != nil {
		return nil, err
	}
	encoded, err := Encode(r.capture.Events)
	if err != nil {
		return nil, err
	}
	latency := completedAt.Sub(r.meta.StartedAt).Milliseconds()
	if latency < 0 {
		latency = 0
	}
	r.finalized = &Record{
		RequestID: r.meta.RequestID, ConversationID: r.meta.ConversationID, TurnIndex: r.meta.TurnIndex,
		UserID: r.meta.UserID, UsernameSnapshot: r.meta.UsernameSnapshot, UserEmailSnapshot: r.meta.UserEmailSnapshot,
		APIKeyID: r.meta.APIKeyID, APIKeyNameSnapshot: r.meta.APIKeyNameSnapshot,
		GroupID: r.meta.GroupID, GroupNameSnapshot: r.meta.GroupNameSnapshot,
		AccountID: r.meta.AccountID, AccountNameSnapshot: r.meta.AccountNameSnapshot,
		Provider: r.meta.Provider, Endpoint: r.meta.Endpoint, Protocol: r.meta.Protocol,
		Transport: r.meta.Transport, Model: r.meta.Model, Status: status, StatusCode: statusCode,
		LatencyMS: latency, MessageCount: r.messageCount, ToolCallCount: r.toolCallCount,
		HasReasoningSummary: r.hasReasoningSummary, Preview: r.preview, Truncated: r.capture.Truncated,
		StartedAt: r.meta.StartedAt, CompletedAt: completedAt, ExpiresAt: completedAt.Add(retention),
		CreatedAt: completedAt, Encoded: encoded,
	}
	return r.finalized, nil
}

func (r *Recorder) addFinalize(status string, statusCode int, completedAt time.Time) error {
	payload := map[string]any{"status": status, "status_code": statusCode}
	err := r.capture.Add(EventFinalize, payload, r.sequence, completedAt.UnixMilli())
	if !errors.Is(err, ErrCaptureLimit) {
		return err
	}
	// The size limit bounds conversation content; retain one small terminal event
	// so a fully truncated turn still has a valid, decodable payload.
	event, normalizeErr := NormalizeEvent(EventFinalize, payload)
	if normalizeErr != nil {
		return normalizeErr
	}
	event.Sequence = r.sequence
	event.Timestamp = completedAt.UnixMilli()
	event.Truncated = true
	r.capture.Events = append(r.capture.Events, event)
	return nil
}

func (r *Recorder) add(eventType EventType, payload any, update func(any)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finalized != nil {
		return ErrRecorderFinalized
	}
	normalized, err := NormalizeEvent(eventType, payload)
	if err != nil {
		return err
	}
	r.sequence++
	update(normalized.Payload)
	if r.capture.Truncated {
		return ErrCaptureLimit
	}
	return r.capture.Add(eventType, normalized.Payload, r.sequence, time.Now().UTC().UnixMilli())
}

func validFinalStatus(status string) bool {
	switch status {
	case "completed", "failed", "partial", "blocked", "cancelled":
		return true
	default:
		return false
	}
}

func requestMessageCount(value any) int {
	object, ok := value.(map[string]any)
	if !ok {
		return 1
	}
	for _, key := range []string{"messages", "contents", "input"} {
		if items, ok := object[key].([]any); ok {
			count := 0
			for _, item := range items {
				if messageLike(item) {
					count++
				}
			}
			if count > 0 {
				return count
			}
		}
	}
	return 1
}

func messageLike(value any) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return true
	}
	typeName, _ := object["type"].(string)
	return typeName == "" || typeName == "message" || strings.HasSuffix(typeName, "_message")
}

func containsReasoningSummary(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			normalizedKey := strings.ToLower(key)
			if (normalizedKey == "reasoning_summary" || normalizedKey == "summary_text") && nonEmpty(item) {
				return true
			}
			if containsReasoningSummary(item) {
				return true
			}
		}
	case []any:
		for _, item := range typed {
			if containsReasoningSummary(item) {
				return true
			}
		}
	}
	return false
}

func nonEmpty(value any) bool {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) != ""
	}
	return value != nil
}

func preview(value any) string {
	var candidates []string
	collectPreview(value, "", &candidates)
	text := strings.Join(candidates, " ")
	text = strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(text) <= previewMaxRunes {
		return text
	}
	runes := []rune(text)
	return string(runes[:previewMaxRunes])
}

func collectPreview(value any, key string, result *[]string) {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for childKey := range typed {
			keys = append(keys, childKey)
		}
		sort.Strings(keys)
		for _, childKey := range keys {
			item := typed[childKey]
			collectPreview(item, strings.ToLower(childKey), result)
		}
	case []any:
		for _, item := range typed {
			collectPreview(item, key, result)
		}
	case string:
		if key == "text" || key == "content" || key == "message" || key == "instructions" {
			*result = append(*result, typed)
		}
	}
}
