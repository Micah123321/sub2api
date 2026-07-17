package service

import (
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
