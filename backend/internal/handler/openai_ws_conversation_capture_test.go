package handler

import (
	"errors"
	"net/http"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestOpenAIWSConversationStatusUsesTerminalEvent(t *testing.T) {
	tests := []struct {
		name       string
		event      string
		status     string
		statusCode int
	}{
		{name: "completed", event: "response.completed", status: "completed", statusCode: http.StatusOK},
		{name: "failed", event: "response.failed", status: "failed", statusCode: http.StatusBadGateway},
		{name: "incomplete", event: "response.incomplete", status: "partial", statusCode: http.StatusPartialContent},
		{name: "cancelled", event: "response.cancelled", status: "cancelled", statusCode: 499},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status, code := openAIWSConversationStatus(&service.OpenAIForwardResult{
				OpenAIWSMode: true, UpstreamTerminalEvent: test.event,
			}, errors.New("transport ended"))
			require.Equal(t, test.status, status)
			require.Equal(t, test.statusCode, code)
		})
	}
}

func TestOpenAIWSConversationIDPrefersTurnPreviousResponse(t *testing.T) {
	require.Equal(t, "resp_turn", openAIWSConversationID(
		[]byte(`{"type":"response.create","previous_response_id":"resp_turn"}`), "resp_last"))
	require.Equal(t, "resp_last", openAIWSConversationID(
		[]byte(`{"type":"response.create"}`), "resp_last"))
}
