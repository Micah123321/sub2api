package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
)

const (
	conversationLogBatchSize         = 64
	conversationLogFlushInterval     = 500 * time.Millisecond
	conversationLogWriteTimeout      = 5 * time.Second
	conversationLogWriteMaxAttempts  = 3
	conversationLogWriteRetryDelay   = 50 * time.Millisecond
	conversationLogRetentionInterval = 24 * time.Hour
	conversationLogRetentionTimeout  = 10 * time.Minute
	conversationLogRetentionBatch    = 5000
)

func (s *ConversationLogService) runConversationLogWriter() {
	defer s.wg.Done()
	ticker := time.NewTicker(conversationLogFlushInterval)
	defer ticker.Stop()

	batch := make([]*conversationlog.Record, 0, conversationLogBatchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		var inserted int64
		var err error
		for attempt := 1; attempt <= conversationLogWriteMaxAttempts; attempt++ {
			ctx, cancel := context.WithTimeout(context.Background(), conversationLogWriteTimeout)
			inserted, err = s.repo.InsertBatch(ctx, batch)
			cancel()
			if err == nil {
				break
			}
			if attempt < conversationLogWriteMaxAttempts {
				time.Sleep(time.Duration(attempt) * conversationLogWriteRetryDelay)
			}
		}
		if err != nil {
			s.recordConversationLogFailure(uint64(len(batch)), true, err)
		} else {
			persisted := inserted
			if persisted < 0 {
				persisted = 0
			}
			if persisted > int64(len(batch)) {
				persisted = int64(len(batch))
			}
			s.written.Add(uint64(persisted))
			if persisted != int64(len(batch)) {
				s.recordConversationLogFailure(uint64(int64(len(batch))-persisted), true,
					errors.New("repository inserted fewer conversation log rows than requested"))
			}
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-s.ctx.Done():
			for {
				select {
				case record := <-s.queue:
					if record != nil {
						batch = append(batch, record)
						if len(batch) == conversationLogBatchSize {
							flush()
						}
					}
				default:
					flush()
					return
				}
			}
		case record := <-s.queue:
			if record == nil {
				continue
			}
			batch = append(batch, record)
			if len(batch) == conversationLogBatchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (s *ConversationLogService) runConversationLogRetention() {
	defer s.wg.Done()
	s.runConversationLogRetentionOnce(time.Now().UTC())
	ticker := time.NewTicker(conversationLogRetentionInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case now := <-ticker.C:
			s.runConversationLogRetentionOnce(now.UTC())
		}
	}
}

func (s *ConversationLogService) runConversationLogRetentionOnce(now time.Time) {
	ctx, cancel := context.WithTimeout(s.ctx, conversationLogRetentionTimeout)
	defer cancel()
	for {
		deleted, err := s.repo.DeleteExpired(ctx, now.UTC(), conversationLogRetentionBatch)
		if err != nil {
			s.setConversationLogLastError(err)
			slog.Warn("conversation_log_retention_failed", "error", err)
			return
		}
		if deleted < conversationLogRetentionBatch {
			return
		}
	}
}
