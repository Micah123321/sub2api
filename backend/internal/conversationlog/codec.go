package conversationlog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/klauspost/compress/zstd"
)

var (
	ErrChecksumMismatch  = errors.New("conversation log checksum mismatch")
	ErrDecompressedLimit = errors.New("conversation log decompressed size limit exceeded")
)

// EncodedLog contains compressed NDJSON and the metadata needed to validate it.
type EncodedLog struct {
	CodecVersion   int    `json:"codec_version"`
	SchemaVersion  int    `json:"schema_version"`
	Checksum       string `json:"checksum"`
	RawSize        int64  `json:"raw_size"`
	CompressedSize int64  `json:"compressed_size"`
	Payload        []byte `json:"payload"`
}

// Encode serializes normalized events as zstd-compressed NDJSON.
func Encode(events []Event) (EncodedLog, error) {
	var raw bytes.Buffer
	encoder := json.NewEncoder(&raw)
	encoder.SetEscapeHTML(false)
	for _, event := range events {
		normalized, err := NormalizeEvent(event.Type, event.Payload)
		if err != nil {
			return EncodedLog{}, err
		}
		normalized.Sequence = event.Sequence
		normalized.Timestamp = event.Timestamp
		normalized.Truncated = event.Truncated
		if err := encoder.Encode(normalized); err != nil {
			return EncodedLog{}, fmt.Errorf("encode conversation event: %w", err)
		}
	}

	zstdEncoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedBetterCompression))
	if err != nil {
		return EncodedLog{}, fmt.Errorf("create zstd encoder: %w", err)
	}
	payload := zstdEncoder.EncodeAll(raw.Bytes(), nil)
	if err := zstdEncoder.Close(); err != nil {
		return EncodedLog{}, fmt.Errorf("close zstd encoder: %w", err)
	}
	digest := sha256.Sum256(payload)
	return EncodedLog{
		CodecVersion: CodecVersion, SchemaVersion: SchemaVersion,
		Checksum: hex.EncodeToString(digest[:]), RawSize: int64(raw.Len()),
		CompressedSize: int64(len(payload)), Payload: payload,
	}, nil
}

// Decode verifies and decodes a compressed log while enforcing a hard output limit.
func Decode(record EncodedLog, maxDecompressedBytes int64) ([]Event, error) {
	if record.CodecVersion != CodecVersion || record.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("unsupported conversation log version codec=%d schema=%d", record.CodecVersion, record.SchemaVersion)
	}
	if record.CompressedSize != int64(len(record.Payload)) {
		return nil, ErrChecksumMismatch
	}
	digest := sha256.Sum256(record.Payload)
	if record.Checksum != hex.EncodeToString(digest[:]) {
		return nil, ErrChecksumMismatch
	}
	if maxDecompressedBytes <= 0 || record.RawSize > maxDecompressedBytes {
		return nil, ErrDecompressedLimit
	}

	decoder, err := zstd.NewReader(bytes.NewReader(record.Payload))
	if err != nil {
		return nil, fmt.Errorf("create zstd decoder: %w", err)
	}
	defer decoder.Close()
	limited := &hardLimitReader{reader: decoder, remaining: maxDecompressedBytes}
	raw, err := io.ReadAll(limited)
	if err != nil {
		if errors.Is(err, ErrDecompressedLimit) {
			return nil, ErrDecompressedLimit
		}
		return nil, fmt.Errorf("read conversation log: %w", err)
	}
	if int64(len(raw)) != record.RawSize {
		return nil, fmt.Errorf("conversation log raw size mismatch: got %d want %d", len(raw), record.RawSize)
	}
	jsonDecoder := json.NewDecoder(bytes.NewReader(raw))
	var events []Event
	for {
		var event Event
		if err := jsonDecoder.Decode(&event); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return nil, fmt.Errorf("decode conversation event: %w", err)
		}
		events = append(events, event)
	}
	return events, nil
}

type hardLimitReader struct {
	reader    io.Reader
	remaining int64
}

func (r *hardLimitReader) Read(buffer []byte) (int, error) {
	if r.remaining <= 0 {
		var probe [1]byte
		n, err := r.reader.Read(probe[:])
		if n > 0 {
			return 0, ErrDecompressedLimit
		}
		return 0, err
	}
	if int64(len(buffer)) > r.remaining {
		buffer = buffer[:r.remaining]
	}
	n, err := r.reader.Read(buffer)
	r.remaining -= int64(n)
	return n, err
}
