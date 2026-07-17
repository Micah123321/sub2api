package conversationlog

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeEventRedactsSecretsAndPreservesToolJSON(t *testing.T) {
	payload := map[string]any{
		"authorization": "Bearer this-must-never-appear",
		"message":       "canary sk-abcdefghijklmnopqrstuvwxyz012345",
		"tool": map[string]any{
			"name": "weather", "arguments": map[string]any{"city": "Shanghai", "days": float64(3)},
		},
	}
	event, err := NormalizeEvent(EventTool, payload)
	require.NoError(t, err)
	encoded := marshalForTest(t, event)
	require.NotContains(t, encoded, "this-must-never-appear")
	require.NotContains(t, encoded, "abcdefghijklmnopqrstuvwxyz012345")
	require.Contains(t, encoded, redactedValue)
	require.Contains(t, encoded, `"city":"Shanghai"`)
}

func TestRedactStringCoversCommonPlainTextCredentials(t *testing.T) {
	tests := map[string]string{
		"basic auth":        "Authorization: Basic dXNlcjpwYXNzd29yZA==",
		"secret assignment": `client_secret="client-secret-value" password=hunter2`,
		"private key":       "-----BEGIN PRIVATE KEY-----\nvery-sensitive-key-material\n-----END PRIVATE KEY-----",
		"github token":      "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
		"github fine grain": "github_pat_0123456789abcdefghijklmnopqrstuvwxyz",
		"google api key":    "AIza0123456789abcdefghijklmnopqrstuvwxy",
		"google oauth":      "ya29.0123456789abcdefghijklmnopqrstuvwxyz",
		"slack token":       strings.Join([]string{"xoxb", "123456789012", "abcdefghijklmnopqrstuvwxyz"}, "-"),
		"aws session id":    "ASIA0123456789ABCDEF",
		"aws signed url":    "https://example.test/a?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA/20260717/region/s3/aws4_request&X-Amz-Signature=abcdef123456",
		"gcp signed url":    "https://example.test/a?X-Goog-Credential=svc%40example.test%2F20260717%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Signature=abcdef123456",
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			redacted := redactString(input)
			require.Contains(t, redacted, redactedValue)
			require.NotEqual(t, input, redacted)
		})
	}
}

func TestRedactStringAvoidsCredentialLikeProse(t *testing.T) {
	input := "The password policy references a secret garden and the Signature algorithm. Basic authentication is disabled."
	require.Equal(t, input, redactString(input))
}

func TestNormalizeEventOmitsMediaAndPrivateReasoning(t *testing.T) {
	media := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("image", 40)))
	event, err := NormalizeEvent(EventRequest, map[string]any{
		"image":     map[string]any{"type": "image", "media_type": "image/png", "data": media},
		"reasoning": "private chain", "reasoning_summary": "public summary",
	})
	require.NoError(t, err)
	encoded := marshalForTest(t, event)
	require.NotContains(t, encoded, media)
	require.Contains(t, encoded, `"omitted":true`)
	require.NotContains(t, encoded, "private chain")
	require.Contains(t, encoded, "public summary")
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	capture := Capture{MaxBytes: 4096}
	require.NoError(t, capture.Add(EventRequest, map[string]any{"messages": []any{"hello"}}, 1, 100))
	require.NoError(t, capture.Add(EventDelta, map[string]any{"text": "world"}, 2, 101))
	record, err := Encode(capture.Events)
	require.NoError(t, err)
	require.Positive(t, record.RawSize)
	require.Equal(t, int64(len(record.Payload)), record.CompressedSize)

	decoded, err := Decode(record, 4096)
	require.NoError(t, err)
	require.Equal(t, capture.Events, decoded)
}

func TestDecodeRejectsCorruptChecksum(t *testing.T) {
	record, err := Encode([]Event{{Type: EventFinalize, Payload: map[string]any{"status": "done"}}})
	require.NoError(t, err)
	record.Payload[len(record.Payload)-1] ^= 0xff
	_, err = Decode(record, 4096)
	require.ErrorIs(t, err, ErrChecksumMismatch)
}

func TestEncodeAlwaysSanitizesDirectEvents(t *testing.T) {
	secret := "sk-abcdefghijklmnopqrstuvwxyz012345"
	record, err := Encode([]Event{{Type: EventRequest, Payload: map[string]any{"text": secret}}})
	require.NoError(t, err)
	decoded, err := Decode(record, 4096)
	require.NoError(t, err)
	require.NotContains(t, marshalForTest(t, decoded), secret)
}

func TestDecodeEnforcesHardLimit(t *testing.T) {
	record, err := Encode([]Event{{Type: EventDelta, Payload: map[string]any{"text": strings.Repeat("x", 1000)}}})
	require.NoError(t, err)
	record.RawSize = 1 // Ensure the streaming guard, not only metadata, catches the oversized output.
	_, err = Decode(record, 64)
	require.True(t, errors.Is(err, ErrDecompressedLimit), err)
}

func TestCaptureMarksTruncatedAtLimit(t *testing.T) {
	capture := Capture{MaxBytes: 32}
	err := capture.Add(EventRequest, map[string]any{"text": strings.Repeat("x", 100)}, 1, 1)
	require.ErrorIs(t, err, ErrCaptureLimit)
	require.True(t, capture.Truncated)
	require.Empty(t, capture.Events)
}

func marshalForTest(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	require.NoError(t, err)
	return string(encoded)
}
