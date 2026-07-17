package handler

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGeminiV1BetaModelsStartsConversationCaptureAfterRequestParsing(t *testing.T) {
	source, err := os.ReadFile("gemini_v1beta_handler.go")
	require.NoError(t, err)
	function := string(source)
	start := strings.Index(function, "func (h *GatewayHandler) GeminiV1BetaModels")
	require.Greater(t, start, -1)
	end := strings.Index(function[start:], "\nfunc parseGeminiModelAction")
	require.Greater(t, end, -1)
	function = function[start : start+end]

	streamAt := strings.Index(function, `stream := action == "streamGenerateContent"`)
	bodyAt := strings.Index(function, "body, err := pkghttputil.ReadRequestBodyWithPrealloc")
	captureAt := strings.Index(function, "capture := beginConversationCapture")
	auditAt := strings.Index(function, "h.checkSecurityAudit")
	require.Greater(t, captureAt, streamAt)
	require.Greater(t, captureAt, bodyAt)
	require.Less(t, captureAt, auditAt)
	require.Contains(t, function, "service.ContentModerationProtocolGemini")
	require.Contains(t, function, "defer capture.finish()")
}
