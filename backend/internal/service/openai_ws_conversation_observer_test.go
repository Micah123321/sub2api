package service

import (
	"testing"

	coderws "github.com/coder/websocket"
	"github.com/stretchr/testify/require"
)

func TestNotifyOpenAIWSAfterResponseKeepsTurnsIsolatedAndSkipsBinary(t *testing.T) {
	type observedFrame struct {
		turn    int
		payload string
	}
	var observed []observedFrame
	hooks := &OpenAIWSIngressHooks{
		AfterResponse: func(turn int, payload []byte) {
			observed = append(observed, observedFrame{turn: turn, payload: string(payload)})
		},
	}

	notifyOpenAIWSAfterResponse(hooks, 1, coderws.MessageText, []byte(`{"type":"response.output_text.delta","delta":"first"}`))
	notifyOpenAIWSAfterResponse(hooks, 1, coderws.MessageBinary, []byte("binary content"))
	notifyOpenAIWSAfterResponse(hooks, 2, coderws.MessageText, []byte(`{"type":"response.output_text.delta","delta":"second"}`))

	require.Equal(t, []observedFrame{
		{turn: 1, payload: `{"type":"response.output_text.delta","delta":"first"}`},
		{turn: 2, payload: `{"type":"response.output_text.delta","delta":"second"}`},
	}, observed)
}

func TestNotifyOpenAIWSAfterResponseAllowsDisabledCapture(t *testing.T) {
	require.NotPanics(t, func() {
		notifyOpenAIWSAfterResponse(nil, 1, coderws.MessageText, []byte("event"))
		notifyOpenAIWSAfterResponse(&OpenAIWSIngressHooks{}, 1, coderws.MessageText, []byte("event"))
	})
}
