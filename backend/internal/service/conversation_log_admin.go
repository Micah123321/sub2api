package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
)

const (
	conversationLogDetailMaxBytes = 10 << 20
	conversationDeleteTokenTTL    = 5 * time.Minute
)

var ErrConversationDeleteConfirmation = errors.New("invalid or expired conversation log delete confirmation")

// ConversationLogDetail contains metadata and the decoded transcript.
type ConversationLogDetail struct {
	*conversationlog.Record
	Events []conversationlog.Event `json:"events"`
}

// ConversationDeletePreview is a signed destructive-operation preview.
type ConversationDeletePreview struct {
	MatchedCount      int64     `json:"matched_count"`
	SnapshotMaxID     int64     `json:"snapshot_max_id"`
	FilterHash        string    `json:"filter_hash"`
	ConfirmationToken string    `json:"confirmation_token"`
	ExpiresAt         time.Time `json:"expires_at"`
}

// List returns metadata-only conversation logs.
func (s *ConversationLogService) List(ctx context.Context, filter conversationlog.Filter, page, pageSize int) (*conversationlog.Page, error) {
	return s.repo.List(ctx, filter, page, pageSize)
}

// Detail decodes one payload with a strict output limit.
func (s *ConversationLogService) Detail(ctx context.Context, id int64) (*ConversationLogDetail, error) {
	record, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	events, err := conversationlog.Decode(record.Encoded, conversationLogDetailMaxBytes)
	if err != nil {
		s.RecordDecodeFailure(err)
		return nil, fmt.Errorf("decode conversation log: %w", err)
	}
	return &ConversationLogDetail{Record: record, Events: events}, nil
}

// PreviewDelete creates a five-minute confirmation bound to a stable snapshot.
func (s *ConversationLogService) PreviewDelete(ctx context.Context, filter conversationlog.Filter) (*ConversationDeletePreview, error) {
	preview, err := s.repo.PreviewDelete(ctx, filter)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().UTC().Add(conversationDeleteTokenTTL)
	token := s.signConversationDelete(preview.FilterHash, preview.SnapshotMaxID, expiresAt)
	return &ConversationDeletePreview{
		MatchedCount: preview.MatchedCount, SnapshotMaxID: preview.SnapshotMaxID,
		FilterHash: preview.FilterHash, ConfirmationToken: token, ExpiresAt: expiresAt,
	}, nil
}

// DeleteByFilter verifies the preview token before deleting its high-water mark.
func (s *ConversationLogService) DeleteByFilter(
	ctx context.Context,
	filter conversationlog.Filter,
	snapshotMaxID int64,
	filterHash string,
	token string,
) (int64, error) {
	if !s.verifyConversationDelete(filterHash, snapshotMaxID, token, time.Now().UTC()) {
		return 0, ErrConversationDeleteConfirmation
	}
	if conversationlog.FilterHash(filter, snapshotMaxID) != filterHash {
		return 0, ErrConversationDeleteConfirmation
	}
	return s.repo.DeleteByFilter(ctx, filter, snapshotMaxID, 200)
}

func (s *ConversationLogService) signConversationDelete(filterHash string, maxID int64, expiresAt time.Time) string {
	payload := strings.Join([]string{filterHash, strconv.FormatInt(maxID, 10), strconv.FormatInt(expiresAt.Unix(), 10)}, ".")
	mac := hmac.New(sha256.New, s.deleteTokenKey)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *ConversationLogService) verifyConversationDelete(filterHash string, maxID int64, token string, now time.Time) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	fields := strings.Split(string(payload), ".")
	if len(fields) != 3 || fields[0] != filterHash || fields[1] != strconv.FormatInt(maxID, 10) {
		return false
	}
	expiresUnix, err := strconv.ParseInt(fields[2], 10, 64)
	if err != nil || now.After(time.Unix(expiresUnix, 0)) {
		return false
	}
	mac := hmac.New(sha256.New, s.deleteTokenKey)
	_, _ = mac.Write(payload)
	return hmac.Equal(signature, mac.Sum(nil))
}

func newConversationDeleteTokenKey() []byte {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic(fmt.Sprintf("generate conversation delete token key: %v", err))
	}
	return key
}
