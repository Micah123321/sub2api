//go:build unit

package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

var _ OpsRepository = (*stubOpsRepo)(nil)

type stubOpsRepo struct {
	OpsRepository
	overview *OpsDashboardOverview
	err      error
}

type opsAlertUserRepoStub struct {
	UserRepository
	admin *User
	err   error
}

func (s *opsAlertUserRepoStub) GetFirstAdmin(context.Context) (*User, error) {
	return s.admin, s.err
}

func (s *stubOpsRepo) GetDashboardOverview(ctx context.Context, filter *OpsDashboardFilter) (*OpsDashboardOverview, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.overview != nil {
		return s.overview, nil
	}
	return &OpsDashboardOverview{}, nil
}

func TestComputeGroupAvailableRatio(t *testing.T) {
	t.Parallel()

	t.Run("正常情况: 10个账号, 8个可用 = 80%", func(t *testing.T) {
		t.Parallel()

		got := computeGroupAvailableRatio(&GroupAvailability{
			TotalAccounts:  10,
			AvailableCount: 8,
		})
		require.InDelta(t, 80.0, got, 0.0001)
	})

	t.Run("边界情况: TotalAccounts = 0 应返回 0", func(t *testing.T) {
		t.Parallel()

		got := computeGroupAvailableRatio(&GroupAvailability{
			TotalAccounts:  0,
			AvailableCount: 8,
		})
		require.Equal(t, 0.0, got)
	})

	t.Run("边界情况: AvailableCount = 0 应返回 0%", func(t *testing.T) {
		t.Parallel()

		got := computeGroupAvailableRatio(&GroupAvailability{
			TotalAccounts:  10,
			AvailableCount: 0,
		})
		require.Equal(t, 0.0, got)
	})
}

func TestCountAccountsByCondition(t *testing.T) {
	t.Parallel()

	t.Run("测试限流账号统计: acc.IsRateLimited", func(t *testing.T) {
		t.Parallel()

		accounts := map[int64]*AccountAvailability{
			1: {IsRateLimited: true},
			2: {IsRateLimited: false},
			3: {IsRateLimited: true},
		}

		got := countAccountsByCondition(accounts, func(acc *AccountAvailability) bool {
			return acc.IsRateLimited
		})
		require.Equal(t, int64(2), got)
	})

	t.Run("测试错误账号统计（排除临时不可调度）: acc.HasError && acc.TempUnschedulableUntil == nil", func(t *testing.T) {
		t.Parallel()

		until := time.Now().UTC().Add(5 * time.Minute)
		accounts := map[int64]*AccountAvailability{
			1: {HasError: true},
			2: {HasError: true, TempUnschedulableUntil: &until},
			3: {HasError: false},
		}

		got := countAccountsByCondition(accounts, func(acc *AccountAvailability) bool {
			return acc.HasError && acc.TempUnschedulableUntil == nil
		})
		require.Equal(t, int64(1), got)
	})

	t.Run("边界情况: 空 map 应返回 0", func(t *testing.T) {
		t.Parallel()

		got := countAccountsByCondition(map[int64]*AccountAvailability{}, func(acc *AccountAvailability) bool {
			return acc.IsRateLimited
		})
		require.Equal(t, int64(0), got)
	})
}

// TestComputeRuleMetric_AccountTempUnscheduledCount verifies the new
// account_temp_unscheduled_count metric counts accounts currently in the
// temp-unscheduled window and ignores those whose window has expired or
// were never temp-unscheduled.
func TestComputeRuleMetric_AccountTempUnscheduledCount(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	futureUntil := now.Add(5 * time.Minute)
	pastUntil := now.Add(-1 * time.Minute)

	availability := &OpsAccountAvailability{
		Accounts: map[int64]*AccountAvailability{
			// currently temp-unscheduled (window active)
			1: {TempUnschedulableUntil: &futureUntil},
			2: {TempUnschedulableUntil: &futureUntil},
			// temp-unsched window already expired → should NOT count
			3: {TempUnschedulableUntil: &pastUntil},
			// never temp-unscheduled
			4: {HasError: true},
			5: {IsRateLimited: true},
		},
	}

	opsService := &OpsService{
		getAccountAvailability: func(_ context.Context, _ string, _ *int64) (*OpsAccountAvailability, error) {
			return availability, nil
		},
	}
	svc := &OpsAlertEvaluatorService{
		opsService: opsService,
		opsRepo:    &stubOpsRepo{},
	}

	rule := &OpsAlertRule{MetricType: "account_temp_unscheduled_count"}
	val, ok := svc.computeRuleMetric(context.Background(), rule, nil,
		now.Add(-5*time.Minute), now, "", nil)

	require.True(t, ok)
	require.InDelta(t, 2.0, val, 0.0001, "only 2 accounts have an active temp-unsched window")
}

func TestComputeRuleMetricNewIndicators(t *testing.T) {
	t.Parallel()

	groupID := int64(101)
	platform := "openai"

	availability := &OpsAccountAvailability{
		Group: &GroupAvailability{
			GroupID:        groupID,
			TotalAccounts:  10,
			AvailableCount: 8,
		},
		Accounts: map[int64]*AccountAvailability{
			1: {IsRateLimited: true},
			2: {IsRateLimited: true},
			3: {HasError: true},
			4: {HasError: true, TempUnschedulableUntil: timePtr(time.Now().UTC().Add(2 * time.Minute))},
			5: {HasError: false, IsRateLimited: false},
		},
	}

	opsService := &OpsService{
		getAccountAvailability: func(_ context.Context, _ string, _ *int64) (*OpsAccountAvailability, error) {
			return availability, nil
		},
	}

	svc := &OpsAlertEvaluatorService{
		opsService: opsService,
		opsRepo:    &stubOpsRepo{overview: &OpsDashboardOverview{}},
	}

	start := time.Now().UTC().Add(-5 * time.Minute)
	end := time.Now().UTC()
	ctx := context.Background()

	tests := []struct {
		name       string
		metricType string
		groupID    *int64
		wantValue  float64
		wantOK     bool
	}{
		{
			name:       "group_available_accounts",
			metricType: "group_available_accounts",
			groupID:    &groupID,
			wantValue:  8,
			wantOK:     true,
		},
		{
			name:       "group_available_ratio",
			metricType: "group_available_ratio",
			groupID:    &groupID,
			wantValue:  80.0,
			wantOK:     true,
		},
		{
			name:       "account_rate_limited_count",
			metricType: "account_rate_limited_count",
			groupID:    nil,
			wantValue:  2,
			wantOK:     true,
		},
		{
			name:       "account_error_count",
			metricType: "account_error_count",
			groupID:    nil,
			wantValue:  1,
			wantOK:     true,
		},
		{
			name:       "group_available_accounts without group_id returns false",
			metricType: "group_available_accounts",
			groupID:    nil,
			wantValue:  0,
			wantOK:     false,
		},
		{
			name:       "group_available_ratio without group_id returns false",
			metricType: "group_available_ratio",
			groupID:    nil,
			wantValue:  0,
			wantOK:     false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rule := &OpsAlertRule{
				MetricType: tt.metricType,
			}
			gotValue, gotOK := svc.computeRuleMetric(ctx, rule, nil, start, end, platform, tt.groupID)
			require.Equal(t, tt.wantOK, gotOK)
			if !tt.wantOK {
				return
			}
			require.InDelta(t, tt.wantValue, gotValue, 0.0001)
		})
	}
}

func TestComputeRuleMetricKeywordNormalAccounts(t *testing.T) {
	t.Parallel()

	groupID := int64(101)
	availability := &OpsAccountAvailability{
		Accounts: map[int64]*AccountAvailability{
			1: {
				AccountID:   1,
				AccountName: "Claude Primary",
				GroupName:   "Production",
				Platform:    "Anthropic",
				Status:      StatusActive,
			},
			2: {
				AccountID:   2,
				AccountName: "Backup",
				GroupName:   "Claude Production",
				Platform:    "Anthropic",
				Status:      StatusActive,
			},
			3: {
				AccountID:   3,
				AccountName: "Claude Error",
				GroupName:   "Production",
				Platform:    "Anthropic",
				Status:      StatusError,
			},
			4: {
				AccountID:   404,
				AccountName: "Backup",
				GroupName:   "Production",
				Platform:    "OpenAI",
				Status:      StatusActive,
			},
		},
	}

	opsService := &OpsService{
		getAccountAvailability: func(_ context.Context, platform string, gotGroupID *int64) (*OpsAccountAvailability, error) {
			require.Equal(t, "anthropic", strings.ToLower(platform))
			require.NotNil(t, gotGroupID)
			require.Equal(t, groupID, *gotGroupID)
			return availability, nil
		},
	}
	svc := &OpsAlertEvaluatorService{
		opsService: opsService,
		opsRepo:    &stubOpsRepo{},
	}

	rule := &OpsAlertRule{
		MetricType: "keyword_normal_accounts",
		Filters: map[string]any{
			"keyword":  "cLaUdE",
			"group_id": groupID,
		},
	}
	got, ok := svc.computeRuleMetric(
		context.Background(),
		rule,
		nil,
		time.Now().UTC().Add(-time.Minute),
		time.Now().UTC(),
		"anthropic",
		&groupID,
	)
	require.True(t, ok)
	require.Equal(t, 2.0, got)
}

func TestAccountMatchesOpsAlertKeyword(t *testing.T) {
	t.Parallel()

	account := &AccountAvailability{
		AccountID:   2048,
		AccountName: "Primary",
		GroupName:   "Claude Team",
		Platform:    "Anthropic",
	}
	require.True(t, accountMatchesOpsAlertKeyword(account, "team"))
	require.True(t, accountMatchesOpsAlertKeyword(account, "ANTHRO"))
	require.True(t, accountMatchesOpsAlertKeyword(account, "2048"))
	require.False(t, accountMatchesOpsAlertKeyword(account, "gemini"))
	require.False(t, accountMatchesOpsAlertKeyword(nil, "team"))
}

func TestBuildOpsAlertContextIncludesKeyword(t *testing.T) {
	t.Parallel()

	groupID := int64(7)
	dims := buildOpsAlertDimensions("anthropic", &groupID, "claude")
	require.Equal(t, map[string]any{
		"platform": "anthropic",
		"group_id": groupID,
		"keyword":  "claude",
	}, dims)

	description := buildOpsAlertDescription(
		&OpsAlertRule{
			MetricType: "keyword_normal_accounts",
			Operator:   "<",
			Threshold:  2,
		},
		1,
		5,
		"anthropic",
		&groupID,
		"claude",
	)
	require.Contains(t, description, "keyword=claude")
}

func TestResolveOpsAlertRecipients(t *testing.T) {
	t.Parallel()

	require.Equal(t,
		[]string{"custom@example.com"},
		resolveOpsAlertRecipients([]string{" Custom@example.com ", "custom@example.com"}, "admin@example.com"),
	)
	require.Equal(t,
		[]string{"admin@example.com"},
		resolveOpsAlertRecipients([]string{"  "}, " Admin@example.com "),
	)
	require.Empty(t, resolveOpsAlertRecipients(nil, " "))
}

func TestOpsAlertEvaluatorResolvesAdminRecipient(t *testing.T) {
	t.Parallel()

	svc := &OpsAlertEvaluatorService{
		opsService: &OpsService{
			userRepo: &opsAlertUserRepoStub{
				admin: &User{Email: " Admin@example.com "},
			},
		},
	}
	require.Equal(t,
		[]string{"admin@example.com"},
		svc.resolveOpsAlertRecipients(context.Background(), nil),
	)
	require.Equal(t,
		[]string{"custom@example.com"},
		svc.resolveOpsAlertRecipients(context.Background(), []string{"custom@example.com"}),
	)
}
