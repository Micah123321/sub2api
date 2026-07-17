package conversationlog

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRecorderCountsAndFinalizesTurn(t *testing.T) {
	started := time.Now().Add(-time.Second)
	recorder := NewRecorder(Meta{RequestID: "req-1", Provider: "openai", Transport: "sse", StartedAt: started}, 64<<10)
	require.NoError(t, recorder.AddRequest(map[string]any{"messages": []any{
		map[string]any{"role": "system", "content": "Be concise"},
		map[string]any{"role": "user", "content": "Weather in Shanghai?"},
	}}))
	require.NoError(t, recorder.AddDelta(map[string]any{"text": "Sunny", "reasoning_summary": "checked forecast"}))
	require.NoError(t, recorder.AddDelta(map[string]any{"text": " and warm"}))
	require.NoError(t, recorder.AddTool(map[string]any{"name": "weather", "arguments": map[string]any{"city": "Shanghai"}}))

	record, err := recorder.Finalize("completed", 200, 24*time.Hour)
	require.NoError(t, err)
	require.Equal(t, 3, record.MessageCount)
	require.Equal(t, 1, record.ToolCallCount)
	require.True(t, record.HasReasoningSummary)
	require.Contains(t, record.Preview, "Weather in Shanghai?")
	require.False(t, record.Truncated)
	require.Equal(t, record.CompletedAt.Add(24*time.Hour), record.ExpiresAt)
	events, err := Decode(record.Encoded, int64(64<<10))
	require.NoError(t, err)
	require.Len(t, events, 5)
}

func TestRecorderConcurrentDeltasAreSafe(t *testing.T) {
	recorder := NewRecorder(Meta{StartedAt: time.Now()}, 1<<20)
	const workers = 32
	var wait sync.WaitGroup
	errors := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			errors <- recorder.AddDelta(map[string]any{"text": fmt.Sprintf("chunk-%d", index)})
		}(i)
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	record, err := recorder.Finalize("partial", 206, time.Hour)
	require.NoError(t, err)
	require.Equal(t, 1, record.MessageCount)
	events, err := Decode(record.Encoded, 1<<20)
	require.NoError(t, err)
	require.Len(t, events, workers+1)
}

func TestRecorderAccountSnapshotTracksFinalSelection(t *testing.T) {
	recorder := NewRecorder(Meta{StartedAt: time.Now()}, 4096)
	require.NoError(t, recorder.SetAccount(11, "first"))
	require.NoError(t, recorder.SetAccount(22, "final"))
	record, err := recorder.Finalize("completed", 200, time.Hour)
	require.NoError(t, err)
	require.Equal(t, int64(22), *record.AccountID)
	require.Equal(t, "final", record.AccountNameSnapshot)
	require.ErrorIs(t, recorder.SetAccount(33, "late"), ErrRecorderFinalized)
}

func TestRecorderFinalizeIsIdempotent(t *testing.T) {
	recorder := NewRecorder(Meta{}, 4096)
	require.NoError(t, recorder.AddRequest(map[string]any{"text": "hello"}))
	first, err := recorder.Finalize("cancelled", 499, time.Hour)
	require.NoError(t, err)
	second, err := recorder.Finalize("completed", 200, 2*time.Hour)
	require.NoError(t, err)
	require.Same(t, first, second)
	require.Equal(t, "cancelled", second.Status)
	require.ErrorIs(t, recorder.AddDelta(map[string]any{"text": "late"}), ErrRecorderFinalized)
}

func TestRecorderMarksCaptureLimitAndStillFinalizes(t *testing.T) {
	recorder := NewRecorder(Meta{}, 48)
	err := recorder.AddRequest(map[string]any{"text": "this request exceeds the intentionally tiny capture limit"})
	require.ErrorIs(t, err, ErrCaptureLimit)
	record, err := recorder.Finalize("partial", 200, time.Hour)
	require.NoError(t, err)
	require.True(t, record.Truncated)
	require.Contains(t, record.Preview, "intentionally tiny")
	require.Equal(t, 1, record.MessageCount)
	require.NotEmpty(t, record.Encoded.Payload)
}

func TestRecorderRejectsInvalidRetentionWithoutFinalizing(t *testing.T) {
	recorder := NewRecorder(Meta{}, 4096)
	_, err := recorder.Finalize("completed", 200, 0)
	require.ErrorIs(t, err, ErrInvalidRetention)
	_, err = recorder.Finalize("failed", 500, time.Hour)
	require.NoError(t, err)
	require.True(t, errors.Is(recorder.AddTool(nil), ErrRecorderFinalized))
}
