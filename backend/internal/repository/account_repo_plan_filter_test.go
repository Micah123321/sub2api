package repository

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	dbent "github.com/Wei-Shaw/sub2api/ent"
	_ "github.com/Wei-Shaw/sub2api/ent/runtime"
	"github.com/stretchr/testify/require"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
)

func TestAccountPlanTypeFilterBuildsValidPostgresSQL(t *testing.T) {
	var capturedSQL string
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(captureEntQueryMatcher{actual: &capturedSQL}))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	client := dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	t.Cleanup(func() { _ = client.Close() })
	repo := newAccountRepositoryWithSQL(client, db, nil)

	mock.ExpectQuery("account plan filter count").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	count, err := repo.accountListFilteredQuery("", "", "", "", 0, "", "plus").Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 3, count)
	require.NoError(t, mock.ExpectationsWereMet())
	normalized := normalizeSQLWhitespace(capturedSQL)
	require.NotContains(t, normalized, "= ?")
	require.Equal(t, 2, strings.Count(normalized, "->>'plan_type')) = $"))
	require.Contains(t, normalized, "LOWER(BTRIM(\"accounts\".\"credentials\"->>'plan_type')) = $2")
	require.Contains(t, normalized, "LOWER(BTRIM(\"accounts_edge\".\"credentials\"->>'plan_type')) = $3")
}
