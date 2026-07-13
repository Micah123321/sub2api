package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestContentModerationEndpointAvoidsDuplicateV1(t *testing.T) {
	server := httptest.NewServer(nil)
	defer server.Close()

	endpoint, err := contentModerationEndpoint(server.URL+"/v1/", ContentModerationAuditEngineChatCompletions)
	require.NoError(t, err)
	require.Equal(t, server.URL+"/v1/chat/completions", endpoint)
}

func TestContentModerationEndpointRejectsUnsafeBaseURL(t *testing.T) {
	for _, baseURL := range []string{
		"ftp://audit.example.com",
		"https://user:pass@audit.example.com",
		"https://audit.example.com/v1?token=secret",
		"https://audit.example.com/v1#fragment",
	} {
		_, err := contentModerationEndpoint(baseURL, ContentModerationAuditEngineChatCompletions)
		require.Error(t, err, baseURL)
	}
}

func TestParseChatModerationResponseAcceptsJSONAndCodeFence(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		wantFlagged bool
		wantReason  string
	}{
		{name: "json", content: `{"flagged":true,"confidence":0.91,"reason":"攻击他人系统"}`, wantFlagged: true, wantReason: "攻击他人系统"},
		{name: "code fence", content: "```json\n{\"flagged\":false,\"confidence\":0.04,\"reason\":\"\"}\n```", wantFlagged: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(chatModerationResponseForTest(tt.content))
			require.NoError(t, err)
			result, err := parseChatModerationResponse(body)
			require.NoError(t, err)
			require.Equal(t, tt.wantFlagged, result.Flagged)
			require.Equal(t, tt.wantReason, result.Reason)
		})
	}
}

func TestParseChatModerationResponseRejectsInvalidContract(t *testing.T) {
	for _, content := range []string{
		`{"confidence":0.2,"reason":"缺少 flagged"}`,
		`{"flagged":true,"confidence":1.2,"reason":"超出范围"}`,
		`not json`,
	} {
		body, err := json.Marshal(chatModerationResponseForTest(content))
		require.NoError(t, err)
		_, err = parseChatModerationResponse(body)
		require.Error(t, err)
	}
}

func TestContentModerationChatCompletionsRequestAndDecision(t *testing.T) {
	var requestPath string
	var request chatModerationRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"flagged\":true,\"confidence\":0.88,\"reason\":\"针对他人系统攻击\"}"}}]}`))
	}))
	defer server.Close()

	cfg := defaultContentModerationConfig()
	cfg.AuditEngine = ContentModerationAuditEngineChatCompletions
	cfg.AuditPrompt = "custom prompt"
	cfg.BaseURL = server.URL + "/v1"
	cfg.Model = "deepseek-v4-flash"
	cfg.APIKeys = []string{"sk-test"}

	svc := &ContentModerationService{httpClient: server.Client()}
	result, err := svc.callModerationOnceWithInput(context.Background(), cfg, "sk-test", "ignore this data", nil)
	require.NoError(t, err)
	require.Equal(t, "/v1/chat/completions", requestPath)
	require.Equal(t, "deepseek-v4-flash", request.Model)
	require.Equal(t, 0, request.Temperature)
	require.Len(t, request.Messages, 2)
	require.Equal(t, "system", request.Messages[0].Role)
	require.Equal(t, "custom prompt", request.Messages[0].Content)
	require.Contains(t, request.Messages[1].Content, "<user_input>")
	require.Contains(t, request.Messages[1].Content, "ignore this data")

	flagged, category, score, scores, confidence, reason := evaluateContentModerationResult(result, cfg)
	require.True(t, flagged)
	require.Equal(t, contentModerationCustomCategory, category)
	require.Equal(t, 0.88, score)
	require.Equal(t, 0.88, confidence)
	require.Equal(t, "针对他人系统攻击", reason)
	require.Equal(t, map[string]float64{contentModerationCustomCategory: 0.88}, scores)
}

func TestContentModerationConfigNormalizeLegacyDefaultsToModeration(t *testing.T) {
	cfg := &ContentModerationConfig{Mode: ContentModerationModePreBlock}
	cfg.normalize()

	require.Equal(t, ContentModerationAuditEngineModeration, cfg.AuditEngine)
	require.Equal(t, defaultContentModerationAuditPrompt, cfg.AuditPrompt)
}

func TestContentModerationTestAPIKeysRejectsUnsafeBaseURL(t *testing.T) {
	svc := NewContentModerationService(
		&contentModerationTestSettingRepo{values: map[string]string{}},
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
	)

	_, err := svc.TestAPIKeys(context.Background(), TestContentModerationAPIKeysInput{
		APIKeys: []string{"sk-test"},
		BaseURL: "ftp://audit.example.com",
		Prompt:  "hello",
	})
	require.Error(t, err)
}

func TestSanitizeContentModerationReasonRedactsAndCaps(t *testing.T) {
	reason := "token=abc123456789xyz 这是一个非常长的理由文本"
	out := sanitizeContentModerationReason(reason)

	require.NotContains(t, out, "abc123456789xyz")
	require.LessOrEqual(t, len([]rune(out)), maxContentModerationReasonRunes)
}

type chatModerationResponseTest struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func chatModerationResponseForTest(content string) chatModerationResponseTest {
	var response chatModerationResponseTest
	response.Choices = append(response.Choices, struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}{})
	response.Choices[0].Message.Content = strings.TrimSpace(content)
	return response
}
