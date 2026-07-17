package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

const conversationCaptureMaxBytes = 10 << 20

type conversationCapture struct {
	service  *service.ConversationLogService
	recorder *conversationlog.Recorder
	writer   *conversationCaptureWriter
	ctx      context.Context
	stream   bool
}

type conversationCaptureWriter struct {
	gin.ResponseWriter
	content   bytes.Buffer
	maxBytes  int
	truncated bool
}

func (w *conversationCaptureWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	w.capture(data[:n])
	return n, err
}

func (w *conversationCaptureWriter) WriteString(value string) (int, error) {
	n, err := w.ResponseWriter.WriteString(value)
	w.capture([]byte(value[:n]))
	return n, err
}

func (w *conversationCaptureWriter) capture(data []byte) {
	remaining := w.maxBytes - w.content.Len()
	if remaining <= 0 {
		w.truncated = true
		return
	}
	if len(data) > remaining {
		data = data[:remaining]
		w.truncated = true
	}
	_, _ = w.content.Write(data)
}

func beginConversationCapture(
	c *gin.Context,
	svc *service.ConversationLogService,
	meta conversationlog.Meta,
	requestBody []byte,
) *conversationCapture {
	if svc == nil || c == nil || len(requestBody) == 0 {
		return nil
	}
	recorder := conversationlog.NewRecorder(meta, conversationCaptureMaxBytes)
	var request any
	if err := json.Unmarshal(requestBody, &request); err != nil {
		request = map[string]any{"text": string(requestBody)}
	}
	if err := recorder.AddRequest(request); err != nil && !errors.Is(err, conversationlog.ErrCaptureLimit) {
		return nil
	}
	writer := &conversationCaptureWriter{ResponseWriter: c.Writer, maxBytes: conversationCaptureMaxBytes}
	c.Writer = writer
	return &conversationCapture{
		service: svc, recorder: recorder, writer: writer,
		ctx: c.Request.Context(), stream: meta.Transport == "sse",
	}
}

func (capture *conversationCapture) setAccount(account *service.Account) {
	if capture == nil || account == nil {
		return
	}
	_ = capture.recorder.SetAccount(account.ID, account.Name)
}

func (capture *conversationCapture) finish() {
	if capture == nil {
		return
	}
	recordConversationOutput(capture.recorder, capture.writer.content.Bytes())
	statusCode := capture.writer.Status()
	status := "completed"
	if statusCode >= 400 {
		status = "failed"
		if statusCode == 403 {
			status = "blocked"
		}
	} else if capture.stream {
		status = conversationStreamStatus(capture.writer.content.Bytes(), capture.ctx)
	}
	if capture.writer.truncated && status == "completed" {
		status = "partial"
	}
	record, err := capture.recorder.Finalize(status, statusCode, 30*24*time.Hour)
	if err != nil {
		return
	}
	record.Truncated = record.Truncated || capture.writer.truncated
	capture.service.Submit(record)
}

func conversationStreamStatus(payload []byte, ctx context.Context) string {
	terminalStatus, terminal, content := classifyConversationStream(payload)
	if terminal {
		if terminalStatus != "completed" && content {
			return "partial"
		}
		return terminalStatus
	}
	if ctx != nil && ctx.Err() != nil {
		if content {
			return "partial"
		}
		return "cancelled"
	}
	return "partial"
}

func classifyConversationStream(payload []byte) (status string, terminal, content bool) {
	for _, line := range bytes.Split(bytes.TrimSpace(payload), []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		data := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
		if bytes.Equal(data, []byte("[DONE]")) {
			return "completed", true, content
		}
		var event map[string]any
		if json.Unmarshal(data, &event) != nil {
			continue
		}
		if eventStatus, ok := conversationTerminalEventStatus(event); ok {
			return eventStatus, true, content
		}
		content = true
	}
	return "", false, content
}

func conversationTerminalEventStatus(event map[string]any) (string, bool) {
	typeName := strings.ToLower(strings.TrimSpace(mapStringValue(event, "type")))
	switch typeName {
	case "message_stop", "response.completed", "response.done":
		return "completed", true
	case "error", "response.failed":
		return "failed", true
	case "response.incomplete":
		return "partial", true
	case "response.cancelled", "response.canceled":
		return "cancelled", true
	}
	for _, candidate := range []map[string]any{event, mapValue(event, "response")} {
		switch strings.ToLower(strings.TrimSpace(mapStringValue(candidate, "status"))) {
		case "completed", "succeeded":
			return "completed", true
		case "failed", "error":
			return "failed", true
		case "incomplete", "partial":
			return "partial", true
		case "cancelled", "canceled":
			return "cancelled", true
		}
	}
	if event["error"] != nil {
		return "failed", true
	}
	if hasConversationFinishReason(event) {
		return "completed", true
	}
	return "", false
}

func mapStringValue(value map[string]any, key string) string {
	text, _ := value[key].(string)
	return text
}

func mapValue(value map[string]any, key string) map[string]any {
	result, _ := value[key].(map[string]any)
	return result
}

func hasConversationFinishReason(event map[string]any) bool {
	for _, key := range []string{"choices", "candidates"} {
		items, _ := event[key].([]any)
		for _, item := range items {
			object, _ := item.(map[string]any)
			if object["finish_reason"] != nil || object["finishReason"] != nil {
				return true
			}
		}
	}
	return false
}

func recordConversationOutput(recorder *conversationlog.Recorder, payload []byte) {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return
	}
	var value any
	if json.Unmarshal(trimmed, &value) == nil {
		addConversationOutput(recorder, value)
		return
	}
	for _, line := range bytes.Split(trimmed, []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		data := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
		if bytes.Equal(data, []byte("[DONE]")) || len(data) == 0 {
			continue
		}
		if json.Unmarshal(data, &value) == nil {
			addConversationOutput(recorder, value)
		}
	}
}

func addConversationOutput(recorder *conversationlog.Recorder, value any) {
	var err error
	if containsConversationToolData(value) {
		err = recorder.AddTool(value)
	} else {
		err = recorder.AddDelta(value)
	}
	if err != nil && !errors.Is(err, conversationlog.ErrCaptureLimit) {
		return
	}
}

func containsConversationToolData(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalized := strings.ToLower(key)
			if normalized == "tool_calls" || normalized == "tool_call" || normalized == "tool_use" ||
				normalized == "function_call" || normalized == "function_call_output" || normalized == "tool_result" {
				return true
			}
			if containsConversationToolData(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if containsConversationToolData(child) {
				return true
			}
		}
	}
	return false
}
