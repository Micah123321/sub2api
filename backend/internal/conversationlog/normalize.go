package conversationlog

import (
	"encoding/json"
	"fmt"
	"strings"
)

// NormalizeEvent validates the event kind and converts arbitrary payloads into safe JSON values.
func NormalizeEvent(eventType EventType, payload any) (Event, error) {
	switch eventType {
	case EventRequest, EventDelta, EventTool, EventFinalize:
	default:
		return Event{}, fmt.Errorf("unsupported conversation event type %q", eventType)
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return Event{}, fmt.Errorf("marshal conversation event: %w", err)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return Event{}, fmt.Errorf("normalize conversation event: %w", err)
	}
	return Event{Type: eventType, Payload: sanitizeValue(value, "")}, nil
}

func sanitizeValue(value any, parentKey string) any {
	switch typed := value.(type) {
	case map[string]any:
		return sanitizeMap(typed)
	case []any:
		result := make([]any, len(typed))
		for i, item := range typed {
			result[i] = sanitizeValue(item, parentKey)
		}
		return result
	case string:
		if descriptor, ok := mediaStringDescriptor(typed, parentKey, ""); ok {
			return descriptor
		}
		return redactString(typed)
	default:
		return value
	}
}

func sanitizeMap(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	mime := mapString(value, "mime_type", "media_type", "content_type")
	itemType := strings.ToLower(mapString(value, "type"))
	for key, item := range value {
		lowerKey := strings.ToLower(key)
		if isSensitiveKey(lowerKey) {
			result[key] = redactedValue
			continue
		}
		if isPrivateReasoning(itemType, lowerKey) {
			result[key] = map[string]any{"omitted": true, "reason": "private_reasoning"}
			continue
		}
		if text, ok := item.(string); ok {
			if descriptor, omitted := mediaStringDescriptor(text, lowerKey, mime); omitted {
				result[key] = descriptor
				continue
			}
		}
		result[key] = sanitizeValue(item, lowerKey)
	}
	return result
}

func mapString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok {
			return text
		}
	}
	return ""
}

func isPrivateReasoning(itemType, key string) bool {
	if key == "reasoning" || key == "thinking" || key == "chain_of_thought" {
		return true
	}
	if strings.Contains(itemType, "reasoning") || strings.Contains(itemType, "thinking") {
		return key == "content" || key == "text" || key == "data"
	}
	return false
}
