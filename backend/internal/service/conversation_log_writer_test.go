package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/stretchr/testify/require"
)

func TestConversationLogWriterReportsBatchFailure(t *testing.T) {
	repo := &conversationLogRepoStub{insertErr: errors.New("write failed")}
	service := NewConversationLogService(repo)
	service.Start()
	service.Submit(&conversationlog.Record{})
	require.Eventually(t, func() bool {
		return service.Runtime().WriteFailed == 1
	}, 3*time.Second, 10*time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, service.Shutdown(ctx))
	runtime := service.Runtime()
	require.Equal(t, uint64(1), runtime.Dropped)
	require.Contains(t, runtime.LastError, "write failed")
}

func TestConversationLogWriterRetriesTransientBatchFailure(t *testing.T) {
	repo := &conversationLogRepoStub{insertErrors: []error{
		errors.New("database unavailable"),
		errors.New("database unavailable"),
		nil,
	}}
	service := NewConversationLogService(repo)
	service.Start()
	service.Submit(&conversationlog.Record{RequestID: "retried"})

	require.Eventually(t, func() bool {
		return service.Runtime().Written == 1
	}, 3*time.Second, 10*time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, service.Shutdown(ctx))
	insertCalls, inserted, _ := repo.snapshot()
	require.Equal(t, 3, insertCalls)
	require.Equal(t, 1, inserted)
	require.Zero(t, service.Runtime().WriteFailed)
	require.Zero(t, service.Runtime().Dropped)
}

func TestConversationLogShutdownDrainsQueue(t *testing.T) {
	repo := &conversationLogRepoStub{}
	service := NewConversationLogService(repo)
	service.Start()
	for i := 0; i < 100; i++ {
		service.Submit(&conversationlog.Record{RequestID: "request"})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	require.NoError(t, service.Shutdown(ctx))
	_, inserted, _ := repo.snapshot()
	require.Equal(t, 100, inserted)
	require.Equal(t, uint64(100), service.Runtime().Written)
}

func TestConversationLogRetentionDeletesAllExpiredBatches(t *testing.T) {
	repo := &conversationLogRepoStub{deleteResults: []int64{conversationLogRetentionBatch, 7}}
	service := NewConversationLogService(repo)
	now := time.Date(2026, 7, 17, 11, 30, 0, 0, time.UTC)

	service.runConversationLogRetentionOnce(now)

	repo.mu.Lock()
	defer repo.mu.Unlock()
	require.Equal(t, 2, repo.deleteCalls)
	require.Equal(t, []time.Time{now, now}, repo.deleteCutoffs)
}

func TestConversationLogRetentionStopsAfterFailure(t *testing.T) {
	repo := &conversationLogRepoStub{deleteErr: errors.New("cleanup failed")}
	service := NewConversationLogService(repo)
	service.runConversationLogRetentionOnce(time.Now())
	require.Equal(t, 1, repo.deleteCalls)
	require.Contains(t, service.Runtime().LastError, "cleanup failed")
}
