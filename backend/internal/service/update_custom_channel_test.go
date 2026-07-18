package service

import (
	"context"
	"testing"
	"time"
)

func TestPickLatestCustomTag_ByCreatedTime_PrefersImmutable(t *testing.T) {
	older := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC).Format(time.RFC3339)
	newer := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC).Format(time.RFC3339)
	// Floating "custom" retag is newer but must lose to immutable custom-<sha>
	floating := time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

	got := pickLatestCustomTag([]GHCRImageTag{
		{Tag: "custom", UpdatedAt: floating, Digest: "sha256:float"},
		{Tag: "custom-aaaaaaa", UpdatedAt: older, Digest: "sha256:old"},
		{Tag: "custom-bbbbbbb", UpdatedAt: newer, Digest: "sha256:new"},
		{Tag: "latest", UpdatedAt: newer}, // ignored
	})
	if got.Tag != "custom-bbbbbbb" {
		t.Fatalf("want custom-bbbbbbb by create time, got %q", got.Tag)
	}
	if got.Digest != "sha256:new" {
		t.Fatalf("unexpected digest %q", got.Digest)
	}
}

func TestPickLatestCustomTag_FallsBackToFloating(t *testing.T) {
	got := pickLatestCustomTag([]GHCRImageTag{
		{Tag: "custom", UpdatedAt: "2026-07-10T00:00:00Z"},
	})
	if got.Tag != "custom" {
		t.Fatalf("want floating custom, got %q", got.Tag)
	}
}

func TestPickLatestCustomTag_PrefersFloatingPackageVersionSibling(t *testing.T) {
	got := pickLatestCustomTag([]GHCRImageTag{
		{Tag: "custom", PackageVersionID: "package-42", CreatedAt: "2026-07-18T00:00:00Z"},
		{Tag: "custom-e191eba5", PackageVersionID: "package-42", CreatedAt: "2026-07-17T00:00:00Z"},
		{Tag: "custom-fca83040", PackageVersionID: "package-41", CreatedAt: "2026-07-19T00:00:00Z"},
	})

	if got.Tag != "custom-e191eba5" {
		t.Fatalf("want floating tag sibling custom-e191eba5, got %q", got.Tag)
	}
}

func TestCompareGHCRTagTime_PrefersCreatedAt(t *testing.T) {
	olderCreatedAt := GHCRImageTag{
		Tag:       "custom-old",
		CreatedAt: "2026-07-01T00:00:00Z",
		UpdatedAt: "2026-07-20T00:00:00Z",
	}
	newerCreatedAt := GHCRImageTag{
		Tag:       "custom-new",
		CreatedAt: "2026-07-02T00:00:00Z",
		UpdatedAt: "2026-07-03T00:00:00Z",
	}

	if compareGHCRTagTime(olderCreatedAt, newerCreatedAt) >= 0 {
		t.Fatal("created_at should be the primary custom tag ordering field")
	}
}

func TestSortCustomTagsNewestFirst_ParseRFC3339(t *testing.T) {
	tags := []GHCRImageTag{
		{Tag: "custom-old", UpdatedAt: "2026-01-01T00:00:00Z"},
		{Tag: "custom-mid", UpdatedAt: "2026-06-01T12:34:56.789Z"},
		{Tag: "custom-new", UpdatedAt: "2026-07-01T00:00:00+08:00"},
	}
	sortCustomTagsNewestFirst(tags)
	if tags[0].Tag != "custom-new" {
		t.Fatalf("newest first: got order %v", []string{tags[0].Tag, tags[1].Tag, tags[2].Tag})
	}
}

func TestCustomHasUpdate_ImmutableSha(t *testing.T) {
	s := &UpdateService{currentVersion: "0.1.155-custom.aaaaaaa", currentCommit: "aaaaaaa"}
	all := []GHCRImageTag{
		{Tag: "custom-aaaaaaa"},
		{Tag: "custom-bbbbbbb"},
	}
	if s.customHasUpdate(GHCRImageTag{Tag: "custom-aaaaaaa"}, all) {
		t.Fatal("same sha should not need update")
	}
	if !s.customHasUpdate(GHCRImageTag{Tag: "custom-bbbbbbb"}, all) {
		t.Fatal("different published sha should need update")
	}
}

func TestCustomHasUpdate_FloatingWhenAlreadyCustom(t *testing.T) {
	s := &UpdateService{currentVersion: "0.1.155-custom.aaaaaaa", currentCommit: "aaaaaaa"}
	if s.customHasUpdate(GHCRImageTag{Tag: "custom"}, nil) {
		t.Fatal("floating custom alone should not force update when already on custom build")
	}
}

func TestCustomHasUpdate_LocalAheadNotInRegistry(t *testing.T) {
	s := &UpdateService{currentVersion: "0.1.160-custom.863a9800", currentCommit: "863a9800"}
	all := []GHCRImageTag{
		{Tag: "custom-fca83040"},
		{Tag: "custom-aaaaaaa"},
	}
	// Local/unpublished commit should not force "update available" to an older registry tip.
	if s.customHasUpdate(GHCRImageTag{Tag: "custom-fca83040"}, all) {
		t.Fatal("local sha not in registry should not report update")
	}
}

func TestUpdateServiceCheckUpdateCustomChannelUsesFloatingSibling(t *testing.T) {
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	ghcr := &updateServiceGHCRClientStub{
		tags: []GHCRImageTag{
			{Tag: "custom", PackageVersionID: "42", CreatedAt: "2026-07-18T00:00:00Z"},
			{Tag: "custom-e191eba5", PackageVersionID: "42", CreatedAt: "2026-07-18T00:00:00Z"},
			{Tag: "custom-fca83040", PackageVersionID: "41", CreatedAt: "2026-07-19T00:00:00Z"},
		},
	}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.160-custom.e191eba5",
		"release",
		UpdateServiceOptions{
			SettingRepo:   settings,
			GHCRClient:    ghcr,
			CustomImage:   "ghcr.io/micah123321/sub2api",
			CurrentCommit: "e191eba5",
		},
	)

	info, err := svc.CheckUpdate(context.Background(), true)
	if err != nil {
		t.Fatalf("CheckUpdate returned error: %v", err)
	}
	if info.LatestTag != "custom-e191eba5" {
		t.Fatalf("want floating sibling e191eba5, got %q", info.LatestTag)
	}
	if info.LatestVersion != "0.1.160-custom.e191eba5" {
		t.Fatalf("unexpected latest version %q", info.LatestVersion)
	}
	if info.HasUpdate {
		t.Fatal("running floating custom sibling should not report an update")
	}
}

func TestUpdateServiceCheckUpdateCustomChannelUnverifiedMetadataIsConservative(t *testing.T) {
	settings := &updateServiceSettingRepoStub{values: map[string]string{SettingKeyUpdateChannel: UpdateChannelCustom}}
	svc := NewUpdateServiceWithOptions(
		&updateServiceCacheStub{},
		&updateServiceGitHubClientStub{},
		"0.1.160-custom.e191eba5",
		"release",
		UpdateServiceOptions{
			SettingRepo: settings,
			GHCRClient: &updateServiceGHCRClientStub{tags: []GHCRImageTag{
				{Tag: "custom"},
				{Tag: "custom-fca83040"},
			}},
			CustomImage: "ghcr.io/micah123321/sub2api",
		},
	)

	info, err := svc.CheckUpdate(context.Background(), true)
	if err != nil {
		t.Fatalf("CheckUpdate returned error: %v", err)
	}
	if info.HasUpdate {
		t.Fatal("unverified custom metadata should not report an update")
	}
	if info.LatestVersion != "0.1.160-custom.e191eba5" {
		t.Fatalf("want current version when candidate is unverified, got %q", info.LatestVersion)
	}
	if info.LatestTag != "" {
		t.Fatalf("unverified candidate must not expose an executable tag, got %q", info.LatestTag)
	}
	if info.Warning == "" {
		t.Fatal("unverified candidate should explain why update detection is conservative")
	}
}
