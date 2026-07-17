package handler

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestConversationLogMetaCapturesIdentityAndProtocol(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	request := httptest.NewRequest("POST", "/openai/v1/responses", nil)
	request = request.WithContext(context.WithValue(request.Context(), ctxkey.RequestID, "request-123"))
	ctx.Request = request
	groupID := int64(7)
	apiKey := &service.APIKey{
		ID: 11, Name: "production", GroupID: &groupID,
		User:  &service.User{Username: "alice", Email: "alice@example.com"},
		Group: &service.Group{Name: "grok-main", Platform: service.PlatformGrok},
	}

	meta := conversationLogMeta(ctx, apiKey, middleware2.AuthSubject{UserID: 5}, service.PlatformOpenAI,
		service.ContentModerationProtocolOpenAIResponses, true, "grok-4")
	require.Equal(t, "request-123", meta.RequestID)
	require.Equal(t, int64(5), *meta.UserID)
	require.Equal(t, int64(11), *meta.APIKeyID)
	require.Equal(t, groupID, *meta.GroupID)
	require.Equal(t, "alice", meta.UsernameSnapshot)
	require.Equal(t, "alice@example.com", meta.UserEmailSnapshot)
	require.Equal(t, "production", meta.APIKeyNameSnapshot)
	require.Equal(t, "grok-main", meta.GroupNameSnapshot)
	require.Equal(t, service.PlatformGrok, meta.Provider)
	require.Equal(t, EndpointResponses, meta.Endpoint)
	require.Equal(t, service.ContentModerationProtocolOpenAIResponses, meta.Protocol)
	require.Equal(t, "sse", meta.Transport)
	require.Equal(t, "grok-4", meta.Model)
}

func TestConversationCaptureEntrypointsUseOneDeferredCapture(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	directory := filepath.Dir(currentFile)
	expected := map[string]int{
		"gateway_handler.go":                  1,
		"gateway_handler_chat_completions.go": 1,
		"gateway_handler_responses.go":        1,
		"openai_gateway_handler.go":           2,
		"openai_chat_completions.go":          1,
	}
	for name, count := range expected {
		content, err := os.ReadFile(filepath.Join(directory, name))
		require.NoError(t, err)
		require.Equal(t, count, strings.Count(string(content), "defer capture.finish()"), name)
		if name == "openai_gateway_handler.go" {
			messagesStart := strings.Index(string(content), "func (h *OpenAIGatewayHandler) Messages")
			websocketStart := strings.Index(string(content), "func (h *OpenAIGatewayHandler) ResponsesWebSocket")
			require.Positive(t, messagesStart)
			require.Greater(t, websocketStart, messagesStart)
			require.Contains(t, string(content)[messagesStart:websocketStart], "ContentModerationProtocolAnthropicMessages, reqStream, reqModel")
			require.Contains(t, string(content)[messagesStart:websocketStart], "defer capture.finish()")
		}
	}
}
