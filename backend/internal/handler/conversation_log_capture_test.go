package handler

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestConversationCaptureWriterPreservesResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	writer := &conversationCaptureWriter{ResponseWriter: ctx.Writer, maxBytes: 8}
	ctx.Writer = writer
	_, err := ctx.Writer.WriteString("hello world")
	require.NoError(t, err)
	require.Equal(t, "hello world", response.Body.String())
	require.Equal(t, "hello wo", writer.content.String())
	require.True(t, writer.truncated)
}

func TestRecordConversationOutputParsesSSE(t *testing.T) {
	recorder := conversationlog.NewRecorder(conversationlog.Meta{StartedAt: time.Now()}, 4096)
	recordConversationOutput(recorder, []byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\ndata: [DONE]\n"))
	record, err := recorder.Finalize("completed", 200, time.Hour)
	require.NoError(t, err)
	decoded, err := conversationlog.Decode(record.Encoded, 4096)
	require.NoError(t, err)
	require.Len(t, decoded, 2)
}

func TestConversationStreamStatusUsesProtocolTerminalEvents(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
	}{
		{name: "openai done", payload: "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n", want: "completed"},
		{name: "anthropic stop", payload: "data: {\"type\":\"content_block_delta\"}\n\ndata: {\"type\":\"message_stop\"}\n", want: "completed"},
		{name: "responses failed after output", payload: "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: {\"type\":\"response.failed\"}\n", want: "partial"},
		{name: "immediate error", payload: "data: {\"type\":\"error\",\"error\":{\"message\":\"no account\"}}\n", want: "failed"},
		{name: "cancelled", payload: "data: {\"type\":\"response.cancelled\"}\n", want: "cancelled"},
		{name: "missing terminal", payload: "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n", want: "partial"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, conversationStreamStatus([]byte(test.payload), context.Background()))
		})
	}
}

func TestConversationStreamStatusDetectsClientCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.Equal(t, "cancelled", conversationStreamStatus(nil, ctx))
	require.Equal(t, "partial", conversationStreamStatus(
		[]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n"), ctx))
}
