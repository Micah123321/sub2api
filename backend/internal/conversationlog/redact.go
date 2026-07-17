package conversationlog

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"strings"
)

const redactedValue = "[REDACTED]"

var (
	sensitiveKeyPattern = regexp.MustCompile(`(?i)(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|secret|cookie|set-cookie|private[-_]?key)`)
	credentialPatterns  = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`),
		regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}\b`),
		regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),
		regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`),
		regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{20,}\b`),
		regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}\b`),
		regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`),
		regexp.MustCompile(`\bya29\.[0-9A-Za-z_-]{20,}\b`),
		regexp.MustCompile(`\bxox[baprs]-[0-9A-Za-z-]{10,}\b`),
	}
	basicAuthPattern            = regexp.MustCompile(`(?i)\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}`)
	credentialAssignmentPattern = regexp.MustCompile(`(?i)\b(password|passwd|pwd|secret|client[-_]?secret|api[-_]?key|access[-_]?token|refresh[-_]?token)(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)`)
	privateKeyBlockPattern      = regexp.MustCompile(`(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----`)
	signedURLCredentialPattern  = regexp.MustCompile(`(?i)([?&](?:X-Amz-(?:Credential|Signature|Security-Token)|X-Goog-(?:Credential|Signature)|GoogleAccessId|Signature)=)[^&\s]+`)
	dataURLPattern              = regexp.MustCompile(`(?i)^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$`)
	base64Pattern               = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)
)

func isSensitiveKey(key string) bool {
	return sensitiveKeyPattern.MatchString(key)
}

func redactString(value string) string {
	value = privateKeyBlockPattern.ReplaceAllString(value, redactedValue)
	value = signedURLCredentialPattern.ReplaceAllString(value, `${1}`+redactedValue)
	value = credentialAssignmentPattern.ReplaceAllString(value, `${1}${2}`+redactedValue)
	value = basicAuthPattern.ReplaceAllStringFunc(value, redactBasicAuth)
	for _, pattern := range credentialPatterns {
		value = pattern.ReplaceAllString(value, redactedValue)
	}
	return value
}

func redactBasicAuth(value string) string {
	parts := strings.Fields(value)
	if len(parts) != 2 {
		return value
	}
	decoded, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(parts[1])
	}
	if err != nil || !strings.Contains(string(decoded), ":") {
		return value
	}
	return redactedValue
}

func mediaStringDescriptor(value, key, mime string) (map[string]any, bool) {
	if match := dataURLPattern.FindStringSubmatch(value); match != nil {
		return omittedDescriptor(match[2], firstNonEmpty(match[1], mime)), true
	}
	lowerMime := strings.ToLower(mime)
	lowerKey := strings.ToLower(key)
	isMedia := strings.HasPrefix(lowerMime, "image/") || strings.HasPrefix(lowerMime, "audio/") ||
		strings.HasPrefix(lowerMime, "video/") || lowerMime == "application/octet-stream"
	isBody := lowerKey == "data" || lowerKey == "content" || lowerKey == "body" ||
		lowerKey == "file" || strings.Contains(lowerKey, "base64")
	if len(value) >= 128 && base64Pattern.MatchString(value) && (isMedia || isBody) {
		if _, err := base64.StdEncoding.DecodeString(value); err == nil {
			return omittedDescriptor(value, mime), true
		}
	}
	return nil, false
}

func omittedDescriptor(encoded, mime string) map[string]any {
	digest := sha256.Sum256([]byte(encoded))
	result := map[string]any{
		"omitted":       true,
		"encoded_bytes": len(encoded),
		"sha256":        hex.EncodeToString(digest[:]),
	}
	if mime != "" {
		result["media_type"] = mime
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
