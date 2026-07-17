package service

import (
	"context"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/stretchr/testify/require"
)

func TestConversationDeleteTokenIsBoundAndExpires(t *testing.T) {
	service := NewConversationLogService(&conversationLogRepoStub{})
	expires := time.Now().UTC().Add(time.Minute)
	token := service.signConversationDelete("hash-a", 42, expires)
	require.True(t, service.verifyConversationDelete("hash-a", 42, token, time.Now().UTC()))
	require.False(t, service.verifyConversationDelete("hash-b", 42, token, time.Now().UTC()))
	require.False(t, service.verifyConversationDelete("hash-a", 43, token, time.Now().UTC()))
	require.False(t, service.verifyConversationDelete("hash-a", 42, token, expires.Add(time.Second)))
}

func TestConversationDeleteTokenIsStableAcrossInstances(t *testing.T) {
	key := []byte("shared-jwt-secret-used-by-every-instance")
	first := NewConversationLogServiceWithDeleteTokenKey(&conversationLogRepoStub{}, key)
	second := NewConversationLogServiceWithDeleteTokenKey(&conversationLogRepoStub{}, key)
	expires := time.Now().UTC().Add(time.Minute)
	token := first.signConversationDelete("hash-a", 42, expires)

	require.True(t, second.verifyConversationDelete("hash-a", 42, token, time.Now().UTC()))
}

func TestConversationDeleteUsesPreviewSnapshotWhenNewRowsArrive(t *testing.T) {
	start := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	filter := conversationlog.Filter{StartAt: &start, EndAt: &end}
	snapshotMaxID := int64(42)
	filterHash := conversationlog.FilterHash(filter, snapshotMaxID)
	repo := &conversationLogRepoStub{preview: &conversationlog.DeletePreview{
		MatchedCount: 2, SnapshotMaxID: 99, FilterHash: conversationlog.FilterHash(filter, 99),
	}}
	service := NewConversationLogServiceWithDeleteTokenKey(repo, []byte("stable-delete-key"))
	expires := time.Now().UTC().Add(time.Minute)
	token := service.signConversationDelete(filterHash, snapshotMaxID, expires)

	deleted, err := service.DeleteByFilter(context.Background(), filter, snapshotMaxID, filterHash, token)
	require.NoError(t, err)
	require.Equal(t, int64(2), deleted)
	repo.mu.Lock()
	defer repo.mu.Unlock()
	require.Zero(t, repo.previewCalls, "delete must not recalculate a moving preview")
	require.Equal(t, snapshotMaxID, repo.deletedMaxID)
}
