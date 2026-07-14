//go:build unit

package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type updateServiceCacheStub struct {
	data map[string]string
}

func (s *updateServiceCacheStub) GetUpdateInfo(_ context.Context, key string) (string, error) {
	if s.data == nil {
		return "", errors.New("cache miss")
	}
	v, ok := s.data[key]
	if !ok || v == "" {
		return "", errors.New("cache miss")
	}
	return v, nil
}

func (s *updateServiceCacheStub) SetUpdateInfo(_ context.Context, key, data string, _ time.Duration) error {
	if s.data == nil {
		s.data = map[string]string{}
	}
	s.data[key] = data
	return nil
}

type updateServiceGitHubClientStub struct {
	release        *GitHubRelease
	recentReleases []*GitHubRelease
	recentErr      error
}

func (s *updateServiceGitHubClientStub) FetchLatestRelease(context.Context, string) (*GitHubRelease, error) {
	return s.release, nil
}

func (s *updateServiceGitHubClientStub) FetchRecentReleases(context.Context, string, int) ([]*GitHubRelease, error) {
	return s.recentReleases, s.recentErr
}

func (s *updateServiceGitHubClientStub) DownloadFile(context.Context, string, string, int64) error {
	panic("DownloadFile should not be called when no update is available")
}

func (s *updateServiceGitHubClientStub) FetchChecksumFile(context.Context, string) ([]byte, error) {
	panic("FetchChecksumFile should not be called when no update is available")
}

type updateServiceSettingRepoStub struct {
	values map[string]string
	setErr error
}

func (s *updateServiceSettingRepoStub) Get(context.Context, string) (*Setting, error) {
	return nil, ErrSettingNotFound
}
func (s *updateServiceSettingRepoStub) GetValue(_ context.Context, key string) (string, error) {
	if s.values == nil {
		return "", ErrSettingNotFound
	}
	v, ok := s.values[key]
	if !ok {
		return "", ErrSettingNotFound
	}
	return v, nil
}
func (s *updateServiceSettingRepoStub) Set(_ context.Context, key, value string) error {
	if s.setErr != nil {
		return s.setErr
	}
	if s.values == nil {
		s.values = map[string]string{}
	}
	s.values[key] = value
	return nil
}
func (s *updateServiceSettingRepoStub) GetMultiple(context.Context, []string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (s *updateServiceSettingRepoStub) SetMultiple(context.Context, map[string]string) error {
	return nil
}
func (s *updateServiceSettingRepoStub) GetAll(context.Context) (map[string]string, error) {
	return map[string]string{}, nil
}
func (s *updateServiceSettingRepoStub) Delete(context.Context, string) error { return nil }

type updateServiceGHCRClientStub struct {
	tags []GHCRImageTag
	err  error
}

func (s *updateServiceGHCRClientStub) ListImageTags(context.Context, string) ([]GHCRImageTag, error) {
	return s.tags, s.err
}

func TestUpdateServicePerformUpdateNoUpdateReturnsSentinel(t *testing.T) {
	svc := NewUpdateService(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{
			release: &GitHubRelease{
				TagName: "v0.1.132",
				Name:    "v0.1.132",
			},
		},
		"0.1.132",
		"release",
	)

	err := svc.PerformUpdate(context.Background())

	require.Error(t, err)
	require.True(t, errors.Is(err, ErrNoUpdateAvailable))
	require.ErrorIs(t, err, ErrNoUpdateAvailable)
}

func newRollbackTestService(current string, releases []*GitHubRelease) *UpdateService {
	return NewUpdateService(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{recentReleases: releases},
		current,
		"release",
	)
}

func TestUpdateServiceListRollbackVersionsFiltersAndCaps(t *testing.T) {
	releases := []*GitHubRelease{
		{TagName: "v0.1.148", PublishedAt: "2026-07-09T00:00:00Z"},                       // newer than current: excluded
		{TagName: "v0.1.147", PublishedAt: "2026-07-08T00:00:00Z"},                       // current: excluded
		{TagName: "v0.1.146-rc1", PublishedAt: "2026-07-07T12:00:00Z", Prerelease: true}, // prerelease: excluded
		{TagName: "v0.1.146", PublishedAt: "2026-07-07T00:00:00Z"},
		{TagName: "v0.1.145", PublishedAt: "2026-07-06T00:00:00Z", Draft: true}, // draft: excluded
		{TagName: "v0.1.144", PublishedAt: "2026-07-05T00:00:00Z"},
		{TagName: "v0.1.144", PublishedAt: "2026-07-05T00:00:00Z"}, // duplicate: excluded
		{TagName: "v0.1.143", PublishedAt: "2026-07-04T00:00:00Z"},
		{TagName: "v0.1.142", PublishedAt: "2026-07-03T00:00:00Z"}, // beyond cap of 3: excluded
	}
	svc := newRollbackTestService("0.1.147", releases)

	versions, err := svc.ListRollbackVersions(context.Background())

	require.NoError(t, err)
	require.Len(t, versions, 3)
	require.Equal(t, "0.1.146", versions[0].Version)
	require.Equal(t, "0.1.144", versions[1].Version)
	require.Equal(t, "0.1.143", versions[2].Version)
}

func TestUpdateServiceListRollbackVersionsSortsUnorderedInput(t *testing.T) {
	releases := []*GitHubRelease{
		{TagName: "v0.1.144"},
		{TagName: "v0.1.146"},
		{TagName: "v0.1.145"},
	}
	svc := newRollbackTestService("0.1.147", releases)

	versions, err := svc.ListRollbackVersions(context.Background())

	require.NoError(t, err)
	require.Len(t, versions, 3)
	require.Equal(t, "0.1.146", versions[0].Version)
	require.Equal(t, "0.1.145", versions[1].Version)
	require.Equal(t, "0.1.144", versions[2].Version)
}

func TestUpdateServiceListRollbackVersionsEmptyWhenNoneOlder(t *testing.T) {
	releases := []*GitHubRelease{
		{TagName: "v0.1.147"},
		{TagName: "v0.1.148"},
	}
	svc := newRollbackTestService("0.1.147", releases)

	versions, err := svc.ListRollbackVersions(context.Background())

	require.NoError(t, err)
	require.Empty(t, versions)
}

func TestUpdateServiceListRollbackVersionsPropagatesFetchError(t *testing.T) {
	svc := NewUpdateService(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{recentErr: errors.New("github unavailable")},
		"0.1.147",
		"release",
	)

	_, err := svc.ListRollbackVersions(context.Background())

	require.Error(t, err)
	require.Contains(t, err.Error(), "github unavailable")
}

func TestUpdateServiceRollbackToVersionRejectsDisallowedTargets(t *testing.T) {
	releases := []*GitHubRelease{
		{TagName: "v0.1.148"},
		{TagName: "v0.1.147"},
		{TagName: "v0.1.146"},
		{TagName: "v0.1.145"},
		{TagName: "v0.1.144"},
		{TagName: "v0.1.143"},
		{TagName: "v0.1.142"},
	}
	svc := newRollbackTestService("0.1.147", releases)

	for _, target := range []string{
		"",         // empty
		"0.1.147",  // current version
		"v0.1.147", // current version with prefix
		"0.1.148",  // newer than current
		"0.1.142",  // older than the 3 most recent
		"9.9.9",    // nonexistent
	} {
		err := svc.RollbackToVersion(context.Background(), target)
		require.ErrorIs(t, err, ErrRollbackVersionNotAllowed, "target %q should be rejected", target)
	}
}

func TestUpdateServiceRollbackToVersionAcceptsVPrefix(t *testing.T) {
	// No platform asset in the release: the target passes the allowlist check
	// and fails later at asset lookup, proving the version itself was accepted.
	releases := []*GitHubRelease{
		{TagName: "v0.1.147"},
		{TagName: "v0.1.146"},
	}
	svc := newRollbackTestService("0.1.147", releases)

	err := svc.RollbackToVersion(context.Background(), "v0.1.146")

	require.Error(t, err)
	require.NotErrorIs(t, err, ErrRollbackVersionNotAllowed)
	require.Contains(t, err.Error(), "no compatible release found")
}

func TestUpdateServiceGetSetChannel(t *testing.T) {
	settings := &updateServiceSettingRepoStub{}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.147",
		"release",
		UpdateServiceOptions{SettingRepo: settings},
	)

	ch, err := svc.GetChannel(context.Background())
	require.NoError(t, err)
	require.Equal(t, UpdateChannelOfficial, ch)

	require.ErrorIs(t, svc.SetChannel(context.Background(), "invalid"), ErrInvalidUpdateChannel)

	require.NoError(t, svc.SetChannel(context.Background(), "custom"))
	ch, err = svc.GetChannel(context.Background())
	require.NoError(t, err)
	require.Equal(t, UpdateChannelCustom, ch)
	require.Equal(t, UpdateChannelCustom, settings.values[SettingKeyUpdateChannel])
}

func TestUpdateServiceCheckUpdateCustomChannel(t *testing.T) {
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	ghcr := &updateServiceGHCRClientStub{
		tags: []GHCRImageTag{
			{Tag: "latest"},
			{Tag: "custom-aaa1111", UpdatedAt: "2026-07-01T00:00:00Z"},
			{Tag: "custom", Digest: "sha256:abc", UpdatedAt: "2026-07-02T00:00:00Z"},
			{Tag: "custom-bbb2222", UpdatedAt: "2026-07-03T00:00:00Z"},
		},
	}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.147",
		"release",
		UpdateServiceOptions{
			SettingRepo:   settings,
			GHCRClient:    ghcr,
			CustomImage:   "ghcr.io/micah123321/sub2api",
			CurrentCommit: "deadbeef",
		},
	)
	svc.isDockerEnvFn = func() bool { return false }

	info, err := svc.CheckUpdate(context.Background(), true)
	require.NoError(t, err)
	require.Equal(t, UpdateChannelCustom, info.Channel)
	require.Equal(t, "custom", info.LatestTag)
	require.Equal(t, UpdateMethodManual, info.UpdateMethod)
	require.True(t, info.HasUpdate)
	require.Contains(t, info.ManualCommand, "docker pull ghcr.io/micah123321/sub2api:custom")
}

func TestUpdateServicePerformUpdateCustomNonDockerErrors(t *testing.T) {
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	ghcr := &updateServiceGHCRClientStub{
		tags: []GHCRImageTag{{Tag: "custom-bbb2222", UpdatedAt: "2026-07-03T00:00:00Z"}},
	}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.147",
		"release",
		UpdateServiceOptions{
			SettingRepo: settings,
			GHCRClient:  ghcr,
			CustomImage: "ghcr.io/micah123321/sub2api",
		},
	)
	svc.isDockerEnvFn = func() bool { return false }

	err := svc.PerformUpdate(context.Background())
	require.ErrorIs(t, err, ErrCustomUpdateNotDocker)
}

func TestUpdateServicePerformUpdateCustomDockerWritesPending(t *testing.T) {
	dir := t.TempDir()
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	ghcr := &updateServiceGHCRClientStub{
		tags: []GHCRImageTag{{Tag: "custom-bbb2222", UpdatedAt: "2026-07-03T00:00:00Z"}},
	}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.147",
		"release",
		UpdateServiceOptions{
			SettingRepo: settings,
			GHCRClient:  ghcr,
			CustomImage: "ghcr.io/micah123321/sub2api",
			DataDir:     dir,
		},
	)
	svc.isDockerEnvFn = func() bool { return true }

	err := svc.PerformUpdate(context.Background())
	require.NoError(t, err)

	data, readErr := os.ReadFile(filepath.Join(dir, pendingImageFileName))
	require.NoError(t, readErr)
	require.Equal(t, "ghcr.io/micah123321/sub2api:custom-bbb2222\n", string(data))
}

func TestUpdateServiceListCustomRollbackVersions(t *testing.T) {
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	ghcr := &updateServiceGHCRClientStub{
		tags: []GHCRImageTag{
			{Tag: "custom", UpdatedAt: "2026-07-05T00:00:00Z"},
			{Tag: "custom-aaa", UpdatedAt: "2026-07-04T00:00:00Z"},
			{Tag: "custom-bbb", UpdatedAt: "2026-07-03T00:00:00Z"},
			{Tag: "custom-ccc", UpdatedAt: "2026-07-02T00:00:00Z"},
			{Tag: "custom-ddd", UpdatedAt: "2026-07-01T00:00:00Z"},
		},
	}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.147-custom.zzz",
		"release",
		UpdateServiceOptions{
			SettingRepo:   settings,
			GHCRClient:    ghcr,
			CustomImage:   "ghcr.io/micah123321/sub2api",
			CurrentCommit: "zzz9999",
		},
	)

	versions, err := svc.ListRollbackVersions(context.Background())
	require.NoError(t, err)
	require.Len(t, versions, 3)
	require.Equal(t, "custom-aaa", versions[0].Version)
	require.Equal(t, "custom-bbb", versions[1].Version)
	require.Equal(t, "custom-ccc", versions[2].Version)
}

func TestUpdateServiceRollbackToVersionCustomNonDocker(t *testing.T) {
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	ghcr := &updateServiceGHCRClientStub{
		tags: []GHCRImageTag{
			{Tag: "custom-aaa", UpdatedAt: "2026-07-04T00:00:00Z"},
			{Tag: "custom-bbb", UpdatedAt: "2026-07-03T00:00:00Z"},
		},
	}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.147",
		"release",
		UpdateServiceOptions{
			SettingRepo: settings,
			GHCRClient:  ghcr,
			CustomImage: "ghcr.io/micah123321/sub2api",
		},
	)
	svc.isDockerEnvFn = func() bool { return false }

	err := svc.RollbackToVersion(context.Background(), "custom-aaa")
	require.ErrorIs(t, err, ErrCustomUpdateNotDocker)
}

func TestCompareVersionsHandlesCustomSuffix(t *testing.T) {
	require.Equal(t, -1, compareVersions("0.1.147-custom.abc", "0.1.148-custom.def"))
	require.Equal(t, 0, compareVersions("0.1.147-custom.abc", "0.1.147"))
	require.Equal(t, 1, compareVersions("0.1.148", "0.1.147-custom.abc"))
}

func TestValidateDownloadURLAllowsGHCR(t *testing.T) {
	require.NoError(t, validateDownloadURL("https://ghcr.io/v2/owner/name/blobs/sha256:abc"))
	require.Error(t, validateDownloadURL("https://evil.example/blob"))
}
