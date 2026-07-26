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
	require.Equal(t, 2, strings.Count(normalized, "'[[:space:]_-]+', '', 'g') IN ($"))
	require.Contains(t, normalized, "REGEXP_REPLACE(LOWER(BTRIM(\"accounts\".\"credentials\"->>'plan_type')), '[[:space:]_-]+', '', 'g') IN ($2)")
	require.Contains(t, normalized, "REGEXP_REPLACE(LOWER(BTRIM(\"accounts_edge\".\"credentials\"->>'plan_type')), '[[:space:]_-]+', '', 'g') IN ($3)")
}

// Accounts imported while the ID token still carried chatgptpro must stay
// reachable from the canonical "pro" filter.
func TestAccountPlanTypeFilterMatchesLegacyProAlias(t *testing.T) {
	var capturedSQL string
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(captureEntQueryMatcher{actual: &capturedSQL}))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	client := dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	t.Cleanup(func() { _ = client.Close() })
	repo := newAccountRepositoryWithSQL(client, db, nil)

	mock.ExpectQuery("account plan alias count").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	count, err := repo.accountListFilteredQuery("", "", "", "", 0, "", "pro").Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 2, count)
	require.NoError(t, mock.ExpectationsWereMet())
	normalized := normalizeSQLWhitespace(capturedSQL)
	require.Contains(t, normalized, "REGEXP_REPLACE(LOWER(BTRIM(\"accounts\".\"credentials\"->>'plan_type')), '[[:space:]_-]+', '', 'g') IN ($2, $3)")
	require.Contains(t, normalized, "REGEXP_REPLACE(LOWER(BTRIM(\"accounts_edge\".\"credentials\"->>'plan_type')), '[[:space:]_-]+', '', 'g') IN ($4, $5)")
}

func TestAccountPlanTypeFilterValues(t *testing.T) {
	require.Equal(t, []any{"pro", "chatgptpro"}, accountPlanTypeFilterValues("pro"))
	require.Equal(t, []any{"k12"}, accountPlanTypeFilterValues("k12"))
}

// The query compares against a separator-stripped lowercase column, so an alias
// carrying a space, underscore or hyphen could never match and would silently
// widen nothing.
func TestAccountPlanTypeAliasesAreNormalized(t *testing.T) {
	for canonical, aliases := range accountPlanTypeAliases {
		for _, value := range append([]string{canonical}, aliases...) {
			require.Equal(t, value, strings.ToLower(value), "alias %q must be lowercase", value)
			require.NotContains(t, value, " ", "alias %q must not contain separators", value)
			require.NotContains(t, value, "_", "alias %q must not contain separators", value)
			require.NotContains(t, value, "-", "alias %q must not contain separators", value)
		}
	}
}
