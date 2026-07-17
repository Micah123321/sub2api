package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/google/uuid"
)

const (
	conversationLogQueueCapacity = 1024
	conversationLogRetentionDays = 30
	conversationLogFallbackWait  = 250 * time.Millisecond
)

// ConversationLogRuntime reports persistence health without exposing content.
type ConversationLogRuntime struct {
	QueueDepth    int    `json:"queue_depth"`
	QueueCapacity int    `json:"queue_capacity"`
	Written       uint64 `json:"written"`
	WriteFailed   uint64 `json:"write_failed"`
	Dropped       uint64 `json:"dropped"`
	DecodeFailed  uint64 `json:"decode_failed"`
	LastError     string `json:"last_error"`
}

// ConversationLogService asynchronously persists completed conversation turns.
type ConversationLogService struct {
	repo  conversationlog.Repository
	queue chan *conversationlog.Record

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	startOnce    sync.Once
	shutdownOnce sync.Once
	lifecycleMu  sync.RWMutex
	accepting    bool

	written        atomic.Uint64
	writeFailed    atomic.Uint64
	dropped        atomic.Uint64
	decodeFailed   atomic.Uint64
	errorMu        sync.RWMutex
	lastError      string
	deleteTokenKey []byte
}

// NewConversationLogService creates the fixed-capacity conversation log writer.
func NewConversationLogService(repo conversationlog.Repository) *ConversationLogService {
	return NewConversationLogServiceWithDeleteTokenKey(repo, newConversationDeleteTokenKey())
}

// NewConversationLogServiceWithDeleteTokenKey creates a writer with a stable
// cross-instance key for delete confirmation tokens.
func NewConversationLogServiceWithDeleteTokenKey(repo conversationlog.Repository, deleteTokenKey []byte) *ConversationLogService {
	ctx, cancel := context.WithCancel(context.Background())
	key := append([]byte(nil), deleteTokenKey...)
	if len(key) == 0 {
		key = newConversationDeleteTokenKey()
	}
	return &ConversationLogService{
		repo:           repo,
		queue:          make(chan *conversationlog.Record, conversationLogQueueCapacity),
		ctx:            ctx,
		cancel:         cancel,
		accepting:      true,
		deleteTokenKey: key,
	}
}

// Start starts the writer and daily retention loops. It is idempotent.
func (s *ConversationLogService) Start() {
	if s == nil || s.repo == nil {
		return
	}
	s.startOnce.Do(func() {
		s.wg.Add(2)
		go s.runConversationLogWriter()
		go s.runConversationLogRetention()
	})
}

// Shutdown stops accepting records and waits for the queue to be flushed.
func (s *ConversationLogService) Shutdown(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.shutdownOnce.Do(func() {
		s.lifecycleMu.Lock()
		s.accepting = false
		s.cancel()
		s.lifecycleMu.Unlock()
	})
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Submit queues a completed record. Logging failures never alter the model response.
func (s *ConversationLogService) Submit(record *conversationlog.Record) {
	if s == nil || s.repo == nil || record == nil {
		return
	}
	s.prepareConversationLogRecord(record)

	s.lifecycleMu.RLock()
	if !s.accepting {
		s.lifecycleMu.RUnlock()
		s.recordConversationLogFailure(1, true, errors.New("conversation log service is stopped"))
		return
	}
	select {
	case s.queue <- record:
		s.lifecycleMu.RUnlock()
		return
	default:
		s.lifecycleMu.RUnlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), conversationLogFallbackWait)
	inserted, err := s.repo.InsertBatch(ctx, []*conversationlog.Record{record})
	cancel()
	if err != nil || inserted != 1 {
		if err == nil {
			err = errors.New("conversation log fallback inserted unexpected row count")
		}
		s.recordConversationLogFailure(1, true, err)
		return
	}
	s.written.Add(1)
}

// Runtime returns a lock-free counter snapshot plus the latest persistence error.
func (s *ConversationLogService) Runtime() ConversationLogRuntime {
	if s == nil {
		return ConversationLogRuntime{}
	}
	s.errorMu.RLock()
	lastError := s.lastError
	s.errorMu.RUnlock()
	return ConversationLogRuntime{
		QueueDepth:    len(s.queue),
		QueueCapacity: cap(s.queue),
		Written:       s.written.Load(),
		WriteFailed:   s.writeFailed.Load(),
		Dropped:       s.dropped.Load(),
		DecodeFailed:  s.decodeFailed.Load(),
		LastError:     lastError,
	}
}

// RecordDecodeFailure exposes corrupt-payload failures to the runtime endpoint.
func (s *ConversationLogService) RecordDecodeFailure(err error) {
	if s == nil {
		return
	}
	s.decodeFailed.Add(1)
	if err != nil {
		s.setConversationLogLastError(err)
		slog.Warn("conversation_log_decode_failed", "error", err)
	}
}

func (s *ConversationLogService) prepareConversationLogRecord(record *conversationlog.Record) {
	now := time.Now().UTC()
	if record.RecordKey == "" {
		record.RecordKey = uuid.NewString()
	}
	if record.CompletedAt.IsZero() {
		record.CompletedAt = now
	} else {
		record.CompletedAt = record.CompletedAt.UTC()
	}
	if record.StartedAt.IsZero() {
		record.StartedAt = record.CompletedAt
	} else {
		record.StartedAt = record.StartedAt.UTC()
	}
	if record.ExpiresAt.IsZero() {
		record.ExpiresAt = record.CompletedAt.AddDate(0, 0, conversationLogRetentionDays)
	} else {
		record.ExpiresAt = record.ExpiresAt.UTC()
	}
}

func (s *ConversationLogService) recordConversationLogFailure(count uint64, dropped bool, err error) {
	s.writeFailed.Add(count)
	if dropped {
		s.dropped.Add(count)
	}
	s.setConversationLogLastError(err)
	slog.Warn("conversation_log_write_failed", "records", count, "dropped", dropped, "error", err)
}

func (s *ConversationLogService) setConversationLogLastError(err error) {
	if err == nil {
		return
	}
	s.errorMu.Lock()
	s.lastError = err.Error()
	s.errorMu.Unlock()
}
