package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/stretchr/testify/require"
)

type conversationLogRepoStub struct {
	mu            sync.Mutex
	insertErr     error
	insertErrors  []error
	inserted      []*conversationlog.Record
	insertCalls   int
	deleteResults []int64
	deleteErr     error
	deleteCalls   int
	deleteCutoffs []time.Time
	preview       *conversationlog.DeletePreview
	previewCalls  int
	deletedMaxID  int64
}

func (r *conversationLogRepoStub) InsertBatch(_ context.Context, records []*conversationlog.Record) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.insertCalls++
	if len(r.insertErrors) > 0 {
		err := r.insertErrors[0]
		r.insertErrors = r.insertErrors[1:]
		if err != nil {
			return 0, err
		}
	}
	if r.insertErr != nil {
		return 0, r.insertErr
	}
	r.inserted = append(r.inserted, records...)
	return int64(len(records)), nil
}

func (r *conversationLogRepoStub) List(context.Context, conversationlog.Filter, int, int) (*conversationlog.Page, error) {
	return nil, nil
}

func (r *conversationLogRepoStub) Get(context.Context, int64) (*conversationlog.Record, error) {
	return nil, nil
}

func (r *conversationLogRepoStub) PreviewDelete(context.Context, conversationlog.Filter) (*conversationlog.DeletePreview, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.previewCalls++
	return r.preview, nil
}

func (r *conversationLogRepoStub) DeleteByFilter(_ context.Context, _ conversationlog.Filter, snapshotMaxID int64, _ int) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deletedMaxID = snapshotMaxID
	return 2, nil
}

func (r *conversationLogRepoStub) DeleteExpired(_ context.Context, cutoff time.Time, _ int) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deleteCalls++
	r.deleteCutoffs = append(r.deleteCutoffs, cutoff)
	if r.deleteErr != nil {
		return 0, r.deleteErr
	}
	if len(r.deleteResults) == 0 {
		return 0, nil
	}
	result := r.deleteResults[0]
	r.deleteResults = r.deleteResults[1:]
	return result, nil
}

func (r *conversationLogRepoStub) snapshot() (insertCalls int, inserted int, deleteCalls int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.insertCalls, len(r.inserted), r.deleteCalls
}

func TestConversationLogSubmitQueueSaturationUsesSynchronousFallback(t *testing.T) {
	repo := &conversationLogRepoStub{}
	service := NewConversationLogService(repo)
	for i := 0; i < conversationLogQueueCapacity; i++ {
		service.Submit(&conversationlog.Record{})
	}

	record := &conversationlog.Record{CompletedAt: time.Date(2026, 7, 17, 10, 0, 0, 0, time.UTC)}
	service.Submit(record)

	insertCalls, inserted, _ := repo.snapshot()
	require.Equal(t, 1, insertCalls)
	require.Equal(t, 1, inserted)
	runtime := service.Runtime()
	require.Equal(t, conversationLogQueueCapacity, runtime.QueueDepth)
	require.Equal(t, uint64(1), runtime.Written)
	require.Zero(t, runtime.Dropped)
	require.Equal(t, record.CompletedAt.AddDate(0, 0, conversationLogRetentionDays), record.ExpiresAt)
}

func TestConversationLogSubmitFallbackFailureIsVisible(t *testing.T) {
	repo := &conversationLogRepoStub{insertErr: errors.New("database unavailable")}
	service := NewConversationLogService(repo)
	for i := 0; i <= conversationLogQueueCapacity; i++ {
		service.Submit(&conversationlog.Record{})
	}

	runtime := service.Runtime()
	require.Equal(t, uint64(1), runtime.WriteFailed)
	require.Equal(t, uint64(1), runtime.Dropped)
	require.Contains(t, runtime.LastError, "database unavailable")
}

func TestConversationLogRecordDecodeFailure(t *testing.T) {
	service := NewConversationLogService(&conversationLogRepoStub{})
	service.RecordDecodeFailure(errors.New("checksum mismatch"))
	runtime := service.Runtime()
	require.Equal(t, uint64(1), runtime.DecodeFailed)
	require.Contains(t, runtime.LastError, "checksum mismatch")
}
