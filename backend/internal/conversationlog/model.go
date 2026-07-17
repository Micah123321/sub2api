package conversationlog

import (
	"encoding/json"
	"errors"
)

const (
	SchemaVersion = 1
	CodecVersion  = 1
)

type EventType string

const (
	EventRequest  EventType = "request"
	EventDelta    EventType = "delta"
	EventTool     EventType = "tool"
	EventFinalize EventType = "finalize"
)

var ErrCaptureLimit = errors.New("conversation log capture limit reached")

// Event is the protocol-neutral representation stored in a conversation log.
type Event struct {
	Type      EventType `json:"type"`
	Sequence  int64     `json:"sequence,omitempty"`
	Timestamp int64     `json:"timestamp,omitempty"`
	Payload   any       `json:"payload,omitempty"`
	Truncated bool      `json:"truncated,omitempty"`
}

// Capture bounds the uncompressed events retained for one request/response turn.
type Capture struct {
	MaxBytes  int     `json:"-"`
	Size      int     `json:"size"`
	Truncated bool    `json:"truncated"`
	Events    []Event `json:"events"`
}

// Add normalizes and appends an event unless the per-turn byte limit is reached.
func (c *Capture) Add(eventType EventType, payload any, sequence, timestamp int64) error {
	event, err := NormalizeEvent(eventType, payload)
	if err != nil {
		return err
	}
	event.Sequence = sequence
	event.Timestamp = timestamp
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if c.MaxBytes > 0 && c.Size+len(encoded)+1 > c.MaxBytes {
		c.Truncated = true
		return ErrCaptureLimit
	}
	c.Events = append(c.Events, event)
	c.Size += len(encoded) + 1 // NDJSON newline.
	return nil
}
