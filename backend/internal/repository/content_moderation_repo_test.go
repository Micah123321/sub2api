package repository

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestBuildContentModerationLogWhere_BlockedIncludesAllBlockActions(t *testing.T) {
	where, args := buildContentModerationLogWhere(service.ContentModerationLogFilter{Result: "blocked"})

	require.Empty(t, args)
	sql := strings.Join(where, " AND ")
	require.Contains(t, sql, "l.action IN ('block', 'keyword_block', 'hash_block')")
	require.NotContains(t, sql, "l.action = 'block'")
}

func TestContentModerationRepositoryCountFlaggedByUserSince_ExcludesHashBlock(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	repo := NewContentModerationRepository(db)
	since := time.Now().Add(-time.Hour)
	mock.ExpectQuery(regexp.QuoteMeta("AND action <> 'hash_block'")).
		WithArgs(int64(1001), since, false).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	count, err := repo.CountFlaggedByUserSince(context.Background(), 1001, since, false)

	require.NoError(t, err)
	require.Equal(t, 2, count)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestContentModerationRepositoryCountFlaggedByUserSince_ExcludesCyberPolicyWhenRequested(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	repo := NewContentModerationRepository(db)
	since := time.Now().Add(-time.Hour)
	mock.ExpectQuery(regexp.QuoteMeta("AND ($3::bool IS FALSE OR action <> 'cyber_policy')")).
		WithArgs(int64(1001), since, true).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))

	count, err := repo.CountFlaggedByUserSince(context.Background(), 1001, since, true)

	require.NoError(t, err)
	require.Equal(t, 3, count)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestContentModerationRepositoryCreateLogPersistsCustomAuditFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	repo := NewContentModerationRepository(db)
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO content_moderation_logs")).
		WithArgs(
			"req-custom", nil, "", nil, "", nil, "",
			"", "", "", "", "chat_completions", "block", true, "custom", 0.88,
			0.88, "针对他人系统攻击", `{"custom":0.88}`, `{}`, "", nil, "", 0, false, false, nil, "",
		).
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at"}).AddRow(7, time.Now()))

	log := &service.ContentModerationLog{
		RequestID:         "req-custom",
		AuditEngine:       service.ContentModerationAuditEngineChatCompletions,
		Action:            service.ContentModerationActionBlock,
		Flagged:           true,
		HighestCategory:   "custom",
		HighestScore:      0.88,
		Confidence:        0.88,
		Reason:            "针对他人系统攻击",
		CategoryScores:    map[string]float64{"custom": 0.88},
		ThresholdSnapshot: map[string]float64{},
	}

	require.NoError(t, repo.CreateLog(context.Background(), log))
	require.Equal(t, int64(7), log.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}
