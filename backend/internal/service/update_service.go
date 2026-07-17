package service

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

var (
	ErrNoUpdateAvailable         = infraerrors.Conflict("ALREADY_UP_TO_DATE", "no update available; current version is latest")
	ErrRollbackVersionNotAllowed = infraerrors.BadRequest("ROLLBACK_VERSION_NOT_ALLOWED", "version is not in the allowed rollback list")
	ErrCustomUpdateNotDocker     = infraerrors.BadRequest("CUSTOM_UPDATE_REQUIRES_DOCKER", "custom channel update requires Docker runtime; use docker pull manually")
	ErrInvalidUpdateChannel      = infraerrors.BadRequest("INVALID_UPDATE_CHANNEL", "update channel must be official or custom")
)

const (
	updateCacheKeyPrefix = "update_check_cache"
	updateCacheTTL       = 1200 // 20 minutes
	defaultOfficialRepo  = "Wei-Shaw/sub2api"
	defaultCustomImage   = "ghcr.io/micah123321/sub2api"

	// Security: allowed download domains for updates
	allowedDownloadHost = "github.com"
	allowedAssetHost    = "objects.githubusercontent.com"
	allowedGHCRHost     = "ghcr.io"

	// Security: max download size (500MB)
	maxDownloadSize = 500 * 1024 * 1024

	// Rollback: expose at most the 3 most recent versions older than current
	maxRollbackVersions = 3
	// Fetch a few extra releases so filtering (current/newer/prerelease) still leaves enough candidates
	rollbackFetchPageSize = 15

	// Channel values
	UpdateChannelOfficial = "official"
	UpdateChannelCustom   = "custom"

	// Update methods
	UpdateMethodBinary = "binary"
	UpdateMethodDocker = "docker"
	UpdateMethodManual = "manual"

	pendingImageFileName = "pending_image_tag"
)

// UpdateCache defines cache operations for update service.
// key isolates channels, e.g. "update_check_cache:official".
type UpdateCache interface {
	GetUpdateInfo(ctx context.Context, key string) (string, error)
	SetUpdateInfo(ctx context.Context, key, data string, ttl time.Duration) error
}

// GitHubReleaseClient 获取 GitHub release 信息的接口
type GitHubReleaseClient interface {
	FetchLatestRelease(ctx context.Context, repo string) (*GitHubRelease, error)
	FetchRecentReleases(ctx context.Context, repo string, perPage int) ([]*GitHubRelease, error)
	DownloadFile(ctx context.Context, url, dest string, maxSize int64) error
	FetchChecksumFile(ctx context.Context, url string) ([]byte, error)
}

// GHCRImageTag represents a container image tag from GHCR / Packages API.
type GHCRImageTag struct {
	Tag       string `json:"tag"`
	Digest    string `json:"digest,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
	HTMLURL   string `json:"html_url,omitempty"`
}

// GHCRClient lists tags for a GHCR image.
type GHCRClient interface {
	ListImageTags(ctx context.Context, image string) ([]GHCRImageTag, error)
}

// UpdateService handles software updates
type UpdateService struct {
	cache          UpdateCache
	githubClient   GitHubReleaseClient
	ghcrClient     GHCRClient
	settingRepo    SettingRepository
	currentVersion string
	buildType      string // "source" for manual builds, "release" for CI builds
	currentCommit  string
	officialRepo   string
	customImage    string
	dataDir        string

	// test hooks
	isDockerEnvFn func() bool
	dataDirFn     func() string
}

// UpdateServiceOptions carries optional dependencies for UpdateService construction.
type UpdateServiceOptions struct {
	SettingRepo   SettingRepository
	GHCRClient    GHCRClient
	OfficialRepo  string
	CustomImage   string
	CurrentCommit string
	DataDir       string
	Config        *config.Config
}

// NewUpdateService creates a new UpdateService
func NewUpdateService(cache UpdateCache, githubClient GitHubReleaseClient, version, buildType string) *UpdateService {
	return NewUpdateServiceWithOptions(cache, githubClient, version, buildType, UpdateServiceOptions{})
}

// NewUpdateServiceWithOptions creates UpdateService with channel/config options.
func NewUpdateServiceWithOptions(cache UpdateCache, githubClient GitHubReleaseClient, version, buildType string, opts UpdateServiceOptions) *UpdateService {
	officialRepo := strings.TrimSpace(opts.OfficialRepo)
	customImage := strings.TrimSpace(opts.CustomImage)
	dataDir := strings.TrimSpace(opts.DataDir)
	if opts.Config != nil {
		if officialRepo == "" {
			officialRepo = strings.TrimSpace(opts.Config.Update.OfficialRepo)
		}
		if customImage == "" {
			customImage = strings.TrimSpace(opts.Config.Update.CustomImage)
		}
	}
	if envImage := strings.TrimSpace(os.Getenv("SUB2API_CUSTOM_IMAGE")); envImage != "" {
		customImage = envImage
	}
	if officialRepo == "" {
		officialRepo = defaultOfficialRepo
	}
	if customImage == "" {
		customImage = defaultCustomImage
	}
	if dataDir == "" {
		// Prefer DATA_DIR; fall back to Docker volume path /app/data when present,
		// then current directory (matches setup.GetDataDir semantics without importing setup).
		if envDir := strings.TrimSpace(os.Getenv("DATA_DIR")); envDir != "" {
			dataDir = envDir
		} else if info, err := os.Stat("/app/data"); err == nil && info.IsDir() {
			dataDir = "/app/data"
		} else {
			dataDir = "."
		}
	}

	return &UpdateService{
		cache:          cache,
		githubClient:   githubClient,
		ghcrClient:     opts.GHCRClient,
		settingRepo:    opts.SettingRepo,
		currentVersion: version,
		buildType:      buildType,
		currentCommit:  strings.TrimSpace(opts.CurrentCommit),
		officialRepo:   officialRepo,
		customImage:    customImage,
		dataDir:        dataDir,
	}
}

// UpdateInfo contains update information
type UpdateInfo struct {
	CurrentVersion string       `json:"current_version"`
	LatestVersion  string       `json:"latest_version"`
	HasUpdate      bool         `json:"has_update"`
	ReleaseInfo    *ReleaseInfo `json:"release_info,omitempty"`
	Cached         bool         `json:"cached"`
	Warning        string       `json:"warning,omitempty"`
	BuildType      string       `json:"build_type"` // "source" or "release"
	Channel        string       `json:"channel,omitempty"`
	UpdateMethod   string       `json:"update_method,omitempty"` // binary | docker | manual
	Image          string       `json:"image,omitempty"`
	LatestTag      string       `json:"latest_tag,omitempty"`
	Digest         string       `json:"digest,omitempty"`
	ManualCommand  string       `json:"manual_command,omitempty"`
}

// ReleaseInfo contains GitHub release details
type ReleaseInfo struct {
	Name        string  `json:"name"`
	Body        string  `json:"body"`
	PublishedAt string  `json:"published_at"`
	HTMLURL     string  `json:"html_url"`
	Assets      []Asset `json:"assets,omitempty"`
}

// Asset represents a release asset
type Asset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"download_url"`
	Size        int64  `json:"size"`
}

// GitHubRelease represents GitHub API response
type GitHubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	Body        string        `json:"body"`
	PublishedAt string        `json:"published_at"`
	HTMLURL     string        `json:"html_url"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	Assets      []GitHubAsset `json:"assets"`
}

// RollbackVersion describes a release version the system can roll back to
type RollbackVersion struct {
	Version     string `json:"version"` // without "v" prefix, e.g. "0.1.146" or custom tag
	PublishedAt string `json:"published_at"`
	HTMLURL     string `json:"html_url"`
	Tag         string `json:"tag,omitempty"`
	Digest      string `json:"digest,omitempty"`
	Image       string `json:"image,omitempty"`
}

type GitHubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// GetChannel returns the configured update channel (default official).
func (s *UpdateService) GetChannel(ctx context.Context) (string, error) {
	if s.settingRepo == nil {
		return UpdateChannelOfficial, nil
	}
	value, err := s.settingRepo.GetValue(ctx, SettingKeyUpdateChannel)
	if err != nil {
		if errorsIsSettingNotFound(err) {
			return UpdateChannelOfficial, nil
		}
		return "", err
	}
	return normalizeUpdateChannel(value), nil
}

// SetChannel persists the update channel.
func (s *UpdateService) SetChannel(ctx context.Context, channel string) error {
	normalized, err := parseUpdateChannel(channel)
	if err != nil {
		return err
	}
	if s.settingRepo == nil {
		return infraerrors.InternalServer("SETTING_REPO_UNAVAILABLE", "setting repository is not configured")
	}
	return s.settingRepo.Set(ctx, SettingKeyUpdateChannel, normalized)
}

// CheckUpdate checks for available updates
func (s *UpdateService) CheckUpdate(ctx context.Context, force bool) (*UpdateInfo, error) {
	channel, err := s.GetChannel(ctx)
	if err != nil {
		return nil, err
	}

	// Try cache first
	if !force {
		if cached, err := s.getFromCache(ctx, channel); err == nil && cached != nil {
			return cached, nil
		}
	}

	var info *UpdateInfo
	switch channel {
	case UpdateChannelCustom:
		info, err = s.fetchLatestCustom(ctx)
	default:
		info, err = s.fetchLatestRelease(ctx)
	}
	if err != nil {
		// Return cached on error
		if cached, cacheErr := s.getFromCache(ctx, channel); cacheErr == nil && cached != nil {
			cached.Warning = "Using cached data: " + err.Error()
			return cached, nil
		}
		return &UpdateInfo{
			CurrentVersion: s.currentVersion,
			LatestVersion:  s.currentVersion,
			HasUpdate:      false,
			Warning:        err.Error(),
			BuildType:      s.buildType,
			Channel:        channel,
			UpdateMethod:   s.detectUpdateMethod(channel),
			Image:          s.imageForChannel(channel),
		}, nil
	}

	// Cache result
	s.saveToCache(ctx, channel, info)
	return info, nil
}

// PerformUpdate downloads and applies the update
// Uses atomic file replacement pattern for safe in-place updates
func (s *UpdateService) PerformUpdate(ctx context.Context) error {
	channel, err := s.GetChannel(ctx)
	if err != nil {
		return err
	}
	info, err := s.CheckUpdate(ctx, true)
	if err != nil {
		return err
	}
	if !info.HasUpdate {
		return ErrNoUpdateAvailable
	}

	switch channel {
	case UpdateChannelCustom:
		return s.performCustomUpdate(ctx, info)
	default:
		if info.ReleaseInfo == nil {
			return fmt.Errorf("missing release assets for official update")
		}
		return s.applyReleaseAssets(ctx, info.ReleaseInfo.Assets)
	}
}

func (s *UpdateService) performCustomUpdate(ctx context.Context, info *UpdateInfo) error {
	tag := strings.TrimSpace(info.LatestTag)
	if tag == "" {
		tag = strings.TrimSpace(info.LatestVersion)
	}
	if tag == "" {
		return fmt.Errorf("missing custom image tag")
	}
	imageRef := s.customImage + ":" + tag

	if !s.isDockerEnv() {
		cmd := fmt.Sprintf("docker pull %s", imageRef)
		return ErrCustomUpdateNotDocker.WithMetadata(map[string]string{
			"update_method":  UpdateMethodManual,
			"manual_command": cmd,
			"image":          imageRef,
		})
	}

	// Minimal docker update: record pending image tag for orchestrator / restart script.
	if err := s.writePendingImageTag(imageRef); err != nil {
		cmd := fmt.Sprintf("docker pull %s", imageRef)
		return infraerrors.InternalServer("CUSTOM_UPDATE_PENDING_WRITE_FAILED", err.Error()).
			WithMetadata(map[string]string{
				"update_method":  UpdateMethodManual,
				"manual_command": cmd,
				"image":          imageRef,
			})
	}
	return nil
}

// applyReleaseAssets downloads the platform archive from the given release assets,
// verifies its checksum, and atomically swaps the running binary.
// Shared by PerformUpdate (latest) and RollbackToVersion (specific older version).
func (s *UpdateService) applyReleaseAssets(ctx context.Context, releaseAssets []Asset) error {
	// Find matching archive and checksum for current platform
	archiveName := s.getArchiveName()
	var downloadURL string
	var checksumURL string

	for _, asset := range releaseAssets {
		if strings.Contains(asset.Name, archiveName) && !strings.HasSuffix(asset.Name, ".txt") {
			downloadURL = asset.DownloadURL
		}
		if asset.Name == "checksums.txt" {
			checksumURL = asset.DownloadURL
		}
	}

	if downloadURL == "" {
		return fmt.Errorf("no compatible release found for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	// SECURITY: Validate download URL is from trusted domain
	if err := validateDownloadURL(downloadURL); err != nil {
		return fmt.Errorf("invalid download URL: %w", err)
	}
	if checksumURL != "" {
		if err := validateDownloadURL(checksumURL); err != nil {
			return fmt.Errorf("invalid checksum URL: %w", err)
		}
	}

	// Get current executable path
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	exePath, err = filepath.EvalSymlinks(exePath)
	if err != nil {
		return fmt.Errorf("failed to resolve symlinks: %w", err)
	}

	exeDir := filepath.Dir(exePath)

	// Create temp directory in the SAME directory as executable
	// This ensures os.Rename is atomic (same filesystem)
	tempDir, err := os.MkdirTemp(exeDir, ".sub2api-update-*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tempDir) }()

	// Download archive
	archivePath := filepath.Join(tempDir, filepath.Base(downloadURL))
	if err := s.downloadFile(ctx, downloadURL, archivePath); err != nil {
		return fmt.Errorf("download failed: %w", err)
	}

	// Verify checksum if available
	if checksumURL != "" {
		if err := s.verifyChecksum(ctx, archivePath, checksumURL); err != nil {
			return fmt.Errorf("checksum verification failed: %w", err)
		}
	}

	// Extract binary from archive
	newBinaryPath := filepath.Join(tempDir, "sub2api")
	if err := s.extractBinary(archivePath, newBinaryPath); err != nil {
		return fmt.Errorf("extraction failed: %w", err)
	}

	// Set executable permission before replacement
	if err := os.Chmod(newBinaryPath, 0755); err != nil {
		return fmt.Errorf("chmod failed: %w", err)
	}

	// Atomic replacement using rename pattern:
	// 1. Rename current -> backup (atomic on Unix)
	// 2. Rename new -> current (atomic on Unix, same filesystem)
	// If step 2 fails, restore backup
	backupPath := exePath + ".backup"

	// Remove old backup if exists
	_ = os.Remove(backupPath)

	// Step 1: Move current binary to backup
	if err := os.Rename(exePath, backupPath); err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}

	// Step 2: Move new binary to target location (atomic, same filesystem)
	if err := os.Rename(newBinaryPath, exePath); err != nil {
		// Restore backup on failure
		if restoreErr := os.Rename(backupPath, exePath); restoreErr != nil {
			return fmt.Errorf("replace failed and restore failed: %w (restore error: %v)", err, restoreErr)
		}
		return fmt.Errorf("replace failed (restored backup): %w", err)
	}

	// Success - backup file is kept for rollback capability
	// It will be cleaned up on next successful update
	return nil
}

// Rollback restores the previous version
func (s *UpdateService) Rollback() error {
	channel, err := s.GetChannel(context.Background())
	if err != nil {
		return err
	}
	if channel == UpdateChannelCustom {
		if !s.isDockerEnv() {
			return ErrCustomUpdateNotDocker.WithMetadata(map[string]string{
				"update_method": UpdateMethodManual,
			})
		}
		return infraerrors.BadRequest("CUSTOM_ROLLBACK_NEEDS_VERSION", "custom channel rollback requires an explicit version/tag")
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	exePath, err = filepath.EvalSymlinks(exePath)
	if err != nil {
		return fmt.Errorf("failed to resolve symlinks: %w", err)
	}

	backupFile := exePath + ".backup"
	if _, err := os.Stat(backupFile); os.IsNotExist(err) {
		return fmt.Errorf("no backup found")
	}

	// Replace current with backup
	if err := os.Rename(backupFile, exePath); err != nil {
		return fmt.Errorf("rollback failed: %w", err)
	}

	return nil
}

// ListRollbackVersions returns up to maxRollbackVersions release versions that are
// strictly older than the current version (the current version itself is excluded),
// newest first. Draft and prerelease entries are skipped.
func (s *UpdateService) ListRollbackVersions(ctx context.Context) ([]RollbackVersion, error) {
	channel, err := s.GetChannel(ctx)
	if err != nil {
		return nil, err
	}
	if channel == UpdateChannelCustom {
		return s.listCustomRollbackVersions(ctx)
	}

	releases, err := s.fetchRollbackCandidates(ctx)
	if err != nil {
		return nil, err
	}

	versions := make([]RollbackVersion, 0, len(releases))
	for _, r := range releases {
		versions = append(versions, RollbackVersion{
			Version:     strings.TrimPrefix(r.TagName, "v"),
			PublishedAt: r.PublishedAt,
			HTMLURL:     r.HTMLURL,
		})
	}
	return versions, nil
}

// RollbackToVersion downloads and installs a specific older version.
// The target must be one of the versions returned by ListRollbackVersions;
// anything else (including the current version) is rejected.
func (s *UpdateService) RollbackToVersion(ctx context.Context, version string) error {
	channel, err := s.GetChannel(ctx)
	if err != nil {
		return err
	}
	target := strings.TrimPrefix(strings.TrimSpace(version), "v")
	if target == "" {
		return ErrRollbackVersionNotAllowed
	}

	if channel == UpdateChannelCustom {
		return s.rollbackCustomToVersion(ctx, target)
	}

	releases, err := s.fetchRollbackCandidates(ctx)
	if err != nil {
		return err
	}

	var match *GitHubRelease
	for _, r := range releases {
		if strings.TrimPrefix(r.TagName, "v") == target {
			match = r
			break
		}
	}
	if match == nil {
		return ErrRollbackVersionNotAllowed
	}

	assets := make([]Asset, len(match.Assets))
	for i, a := range match.Assets {
		assets[i] = Asset{
			Name:        a.Name,
			DownloadURL: a.BrowserDownloadURL,
			Size:        a.Size,
		}
	}

	return s.applyReleaseAssets(ctx, assets)
}

func (s *UpdateService) rollbackCustomToVersion(ctx context.Context, target string) error {
	versions, err := s.listCustomRollbackVersions(ctx)
	if err != nil {
		return err
	}
	var match *RollbackVersion
	for i := range versions {
		v := versions[i]
		if v.Version == target || v.Tag == target {
			match = &v
			break
		}
	}
	if match == nil {
		return ErrRollbackVersionNotAllowed
	}
	tag := match.Tag
	if tag == "" {
		tag = match.Version
	}
	imageRef := s.customImage + ":" + tag
	if !s.isDockerEnv() {
		cmd := fmt.Sprintf("docker pull %s", imageRef)
		return ErrCustomUpdateNotDocker.WithMetadata(map[string]string{
			"update_method":  UpdateMethodManual,
			"manual_command": cmd,
			"image":          imageRef,
		})
	}
	if err := s.writePendingImageTag(imageRef); err != nil {
		cmd := fmt.Sprintf("docker pull %s", imageRef)
		return infraerrors.InternalServer("CUSTOM_UPDATE_PENDING_WRITE_FAILED", err.Error()).
			WithMetadata(map[string]string{
				"update_method":  UpdateMethodManual,
				"manual_command": cmd,
				"image":          imageRef,
			})
	}
	return nil
}

// fetchRollbackCandidates fetches recent releases and keeps the newest
// maxRollbackVersions entries strictly older than the current version.
func (s *UpdateService) fetchRollbackCandidates(ctx context.Context) ([]*GitHubRelease, error) {
	releases, err := s.githubClient.FetchRecentReleases(ctx, s.officialRepo, rollbackFetchPageSize)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool, len(releases))
	candidates := make([]*GitHubRelease, 0, maxRollbackVersions)
	for _, r := range releases {
		if r == nil || r.Draft || r.Prerelease {
			continue
		}
		v := strings.TrimPrefix(r.TagName, "v")
		if v == "" || seen[v] {
			continue
		}
		// Only versions strictly older than current (also excludes current itself)
		if compareVersions(v, s.currentVersion) >= 0 {
			continue
		}
		seen[v] = true
		candidates = append(candidates, r)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return compareVersions(
			strings.TrimPrefix(candidates[i].TagName, "v"),
			strings.TrimPrefix(candidates[j].TagName, "v"),
		) > 0
	})

	if len(candidates) > maxRollbackVersions {
		candidates = candidates[:maxRollbackVersions]
	}
	return candidates, nil
}

func (s *UpdateService) fetchLatestRelease(ctx context.Context) (*UpdateInfo, error) {
	release, err := s.githubClient.FetchLatestRelease(ctx, s.officialRepo)
	if err != nil {
		return nil, err
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")

	assets := make([]Asset, len(release.Assets))
	for i, a := range release.Assets {
		assets[i] = Asset{
			Name:        a.Name,
			DownloadURL: a.BrowserDownloadURL,
			Size:        a.Size,
		}
	}

	return &UpdateInfo{
		CurrentVersion: s.currentVersion,
		LatestVersion:  latestVersion,
		HasUpdate:      compareVersions(s.currentVersion, latestVersion) < 0,
		ReleaseInfo: &ReleaseInfo{
			Name:        release.Name,
			Body:        release.Body,
			PublishedAt: release.PublishedAt,
			HTMLURL:     release.HTMLURL,
			Assets:      assets,
		},
		Cached:       false,
		BuildType:    s.buildType,
		Channel:      UpdateChannelOfficial,
		UpdateMethod: s.detectUpdateMethod(UpdateChannelOfficial),
	}, nil
}

func (s *UpdateService) fetchLatestCustom(ctx context.Context) (*UpdateInfo, error) {
	if s.ghcrClient == nil {
		return nil, fmt.Errorf("GHCR client is not configured")
	}
	tags, err := s.ghcrClient.ListImageTags(ctx, s.customImage)
	if err != nil {
		return nil, err
	}

	filtered := filterCustomTags(tags)
	if len(filtered) == 0 {
		return nil, fmt.Errorf("no custom tags found for image %s", s.customImage)
	}

	// Latest immutable custom-<sha> by package create/update time (not floating retag).
	latest := pickLatestCustomTag(filtered)
	method := s.detectUpdateMethod(UpdateChannelCustom)
	manualCmd := ""
	if method == UpdateMethodManual {
		manualCmd = fmt.Sprintf("docker pull %s:%s", s.customImage, latest.Tag)
	}

	hasUpdate := s.customHasUpdate(latest, filtered)
	displayVersion := s.formatCustomDisplayVersion(latest.Tag)

	return &UpdateInfo{
		CurrentVersion: s.currentVersion,
		LatestVersion:  displayVersion,
		HasUpdate:      hasUpdate,
		ReleaseInfo: &ReleaseInfo{
			Name:        displayVersion,
			Body:        "Custom channel image update",
			PublishedAt: latest.UpdatedAt,
			HTMLURL:     latest.HTMLURL,
		},
		Cached:        false,
		BuildType:     s.buildType,
		Channel:       UpdateChannelCustom,
		UpdateMethod:  method,
		Image:         s.customImage,
		LatestTag:     latest.Tag,
		Digest:        latest.Digest,
		ManualCommand: manualCmd,
	}, nil
}

func (s *UpdateService) listCustomRollbackVersions(ctx context.Context) ([]RollbackVersion, error) {
	if s.ghcrClient == nil {
		return nil, fmt.Errorf("GHCR client is not configured")
	}
	tags, err := s.ghcrClient.ListImageTags(ctx, s.customImage)
	if err != nil {
		return nil, err
	}
	filtered := filterCustomTags(tags)
	// Prefer immutable custom-<sha> tags for rollback list; exclude floating "custom"
	immutable := make([]GHCRImageTag, 0, len(filtered))
	for _, t := range filtered {
		if t.Tag == "custom" {
			continue
		}
		if strings.HasPrefix(t.Tag, "custom-") {
			immutable = append(immutable, t)
		}
	}
	sortCustomTagsNewestFirst(immutable)

	// Exclude current if identifiable
	out := make([]RollbackVersion, 0, maxRollbackVersions)
	for _, t := range immutable {
		if s.isCurrentCustomTag(t) {
			continue
		}
		out = append(out, RollbackVersion{
			Version:     s.formatCustomDisplayVersion(t.Tag),
			PublishedAt: t.UpdatedAt,
			HTMLURL:     t.HTMLURL,
			Tag:         t.Tag,
			Digest:      t.Digest,
			Image:       s.customImage,
		})
		if len(out) >= maxRollbackVersions {
			break
		}
	}
	return out, nil
}

// customHasUpdate decides whether GHCR has a usable newer custom image.
// allTags should be filterCustomTags() output when available so local-only
// builds (current sha not published) are not reported as "update available".
func (s *UpdateService) customHasUpdate(latest GHCRImageTag, allTags []GHCRImageTag) bool {
	if latest.Tag == "" {
		return false
	}
	// Already on the reported latest.
	if s.isCurrentCustomTag(latest) {
		return false
	}

	// Floating tag alone cannot express a newer build; treat as "unknown newer"
	// only when the running binary is not already a custom image build.
	if latest.Tag == "custom" {
		if s.currentCustomSHA() != "" {
			return false
		}
		if strings.Contains(s.currentVersion, "-custom.") || strings.Contains(s.currentVersion, "custom-") {
			return false
		}
		return true
	}

	// Immutable custom-<sha>.
	if strings.HasPrefix(latest.Tag, "custom-") {
		latestSHA := strings.TrimPrefix(latest.Tag, "custom-")
		if latestSHA == "" {
			return false
		}
		currentSHA := s.currentCustomSHA()
		if currentSHA != "" && customSHAMatch(currentSHA, latestSHA) {
			return false
		}
		// Current is a custom build whose sha is not among published immutable tags:
		// treat as local/newer-than-registry (or private) and do not force update.
		if currentSHA != "" && len(allTags) > 0 && !customSHAInTags(currentSHA, allTags) {
			return false
		}
		// Current not a custom build, or current sha is known on registry but not latest.
		return true
	}
	return compareVersions(s.currentVersion, latest.Tag) < 0
}

// formatCustomDisplayVersion maps registry tags to UI-friendly versions aligned
// with build-time VERSION (e.g. custom-fca83040 -> 0.1.160-custom.fca83040).
func (s *UpdateService) formatCustomDisplayVersion(tag string) string {
	tag = strings.TrimSpace(strings.TrimPrefix(tag, "v"))
	if tag == "" {
		return s.currentVersion
	}
	// Already display-shaped.
	if strings.Contains(tag, "-custom.") {
		return tag
	}
	core := coreSemver(s.currentVersion)
	if core == "" {
		// Fall back to VERSION-like current when it has no core (rare).
		core = strings.TrimSpace(strings.TrimPrefix(s.currentVersion, "v"))
		if i := strings.IndexAny(core, "-+"); i >= 0 {
			core = core[:i]
		}
		if core == "" || !strings.Contains(core, ".") {
			core = "0.0.0"
		}
	}
	if tag == "custom" {
		return core + "-custom"
	}
	if strings.HasPrefix(tag, "custom-") {
		sha := strings.TrimPrefix(tag, "custom-")
		if sha == "" {
			return core + "-custom"
		}
		return core + "-custom." + sha
	}
	return tag
}

func (s *UpdateService) currentCustomSHA() string {
	v := strings.TrimSpace(strings.TrimPrefix(s.currentVersion, "v"))
	// Prefer sha embedded in custom display/build versions.
	if i := strings.Index(v, "-custom."); i >= 0 {
		rest := v[i+len("-custom."):]
		if j := strings.IndexAny(rest, "-+"); j >= 0 {
			rest = rest[:j]
		}
		if sha := shortCommit(rest); sha != "" {
			return sha
		}
	}
	if strings.HasPrefix(v, "custom-") {
		if sha := shortCommit(strings.TrimPrefix(v, "custom-")); sha != "" {
			return sha
		}
	}
	// Use injected commit only for custom-flavored builds. Official release builds
	// also carry a commit SHA, but that must not suppress custom-channel updates.
	if strings.Contains(v, "-custom") || strings.Contains(v, "custom-") {
		if sha := shortCommit(s.currentCommit); sha != "" {
			return sha
		}
	}
	return ""
}

func customSHAMatch(a, b string) bool {
	a = shortCommit(a)
	b = shortCommit(b)
	if a == "" || b == "" {
		return false
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a) || a == b
}

func customSHAInTags(sha string, tags []GHCRImageTag) bool {
	sha = shortCommit(sha)
	if sha == "" {
		return false
	}
	for _, t := range tags {
		tag := strings.TrimSpace(t.Tag)
		if !strings.HasPrefix(tag, "custom-") {
			continue
		}
		if customSHAMatch(sha, strings.TrimPrefix(tag, "custom-")) {
			return true
		}
	}
	return false
}

func (s *UpdateService) isCurrentCustomTag(t GHCRImageTag) bool {
	if t.Tag == "custom" {
		return false
	}
	if strings.HasPrefix(t.Tag, "custom-") {
		sha := strings.TrimPrefix(t.Tag, "custom-")
		if current := s.currentCustomSHA(); current != "" && customSHAMatch(current, sha) {
			return true
		}
		if strings.Contains(s.currentVersion, sha) {
			return true
		}
	}
	display := s.formatCustomDisplayVersion(t.Tag)
	if display != "" && (display == strings.TrimPrefix(s.currentVersion, "v") || display == s.currentVersion) {
		return true
	}
	return t.Tag == s.currentVersion || strings.TrimPrefix(t.Tag, "v") == strings.TrimPrefix(s.currentVersion, "v")
}

func (s *UpdateService) downloadFile(ctx context.Context, downloadURL, dest string) error {
	return s.githubClient.DownloadFile(ctx, downloadURL, dest, maxDownloadSize)
}

func (s *UpdateService) getArchiveName() string {
	osName := runtime.GOOS
	arch := runtime.GOARCH
	return fmt.Sprintf("%s_%s", osName, arch)
}

// validateDownloadURL checks if the URL is from an allowed domain
// SECURITY: This prevents SSRF and ensures downloads only come from trusted GitHub domains
func validateDownloadURL(rawURL string) error {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	// Must be HTTPS
	if parsedURL.Scheme != "https" {
		return fmt.Errorf("only HTTPS URLs are allowed")
	}

	// Check against allowed hosts
	host := parsedURL.Host
	// GitHub release URLs can be from github.com or objects.githubusercontent.com;
	// GHCR blobs may use ghcr.io when custom channel needs direct layer access.
	if host != allowedDownloadHost &&
		!strings.HasSuffix(host, "."+allowedDownloadHost) &&
		host != allowedAssetHost &&
		!strings.HasSuffix(host, "."+allowedAssetHost) &&
		host != allowedGHCRHost &&
		!strings.HasSuffix(host, "."+allowedGHCRHost) {
		return fmt.Errorf("download from untrusted host: %s", host)
	}

	return nil
}

func (s *UpdateService) verifyChecksum(ctx context.Context, filePath, checksumURL string) error {
	// Download checksums file
	checksumData, err := s.githubClient.FetchChecksumFile(ctx, checksumURL)
	if err != nil {
		return fmt.Errorf("failed to download checksums: %w", err)
	}

	// Calculate file hash
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	actualHash := hex.EncodeToString(h.Sum(nil))

	// Find expected hash in checksums file
	fileName := filepath.Base(filePath)
	scanner := bufio.NewScanner(strings.NewReader(string(checksumData)))
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Fields(line)
		if len(parts) == 2 && parts[1] == fileName {
			if parts[0] == actualHash {
				return nil
			}
			return fmt.Errorf("checksum mismatch: expected %s, got %s", parts[0], actualHash)
		}
	}

	return fmt.Errorf("checksum not found for %s", fileName)
}

func (s *UpdateService) extractBinary(archivePath, destPath string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	var reader io.Reader = f

	// Handle gzip compression
	if strings.HasSuffix(archivePath, ".gz") || strings.HasSuffix(archivePath, ".tar.gz") || strings.HasSuffix(archivePath, ".tgz") {
		gzr, err := gzip.NewReader(f)
		if err != nil {
			return err
		}
		defer func() { _ = gzr.Close() }()
		reader = gzr
	}

	// Handle tar archive
	if strings.Contains(archivePath, ".tar") {
		tr := tar.NewReader(reader)
		for {
			hdr, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}

			// SECURITY: Prevent Zip Slip / Path Traversal attack
			// Only allow files with safe base names, no directory traversal
			baseName := filepath.Base(hdr.Name)

			// Check for path traversal attempts
			if strings.Contains(hdr.Name, "..") {
				return fmt.Errorf("path traversal attempt detected: %s", hdr.Name)
			}

			// Validate the entry is a regular file
			if hdr.Typeflag != tar.TypeReg {
				continue // Skip directories and special files
			}

			// Only extract the specific binary we need
			if baseName == "sub2api" || baseName == "sub2api.exe" {
				// Additional security: limit file size (max 500MB)
				const maxBinarySize = 500 * 1024 * 1024
				if hdr.Size > maxBinarySize {
					return fmt.Errorf("binary too large: %d bytes (max %d)", hdr.Size, maxBinarySize)
				}

				out, err := os.Create(destPath)
				if err != nil {
					return err
				}

				// Use LimitReader to prevent decompression bombs
				limited := io.LimitReader(tr, maxBinarySize)
				if _, err := io.Copy(out, limited); err != nil {
					_ = out.Close()
					return err
				}
				if err := out.Close(); err != nil {
					return err
				}
				return nil
			}
		}
		return fmt.Errorf("binary not found in archive")
	}

	// Direct copy for non-tar files (with size limit)
	const maxBinarySize = 500 * 1024 * 1024
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}

	limited := io.LimitReader(reader, maxBinarySize)
	if _, err := io.Copy(out, limited); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func (s *UpdateService) cacheKey(channel string) string {
	return updateCacheKeyPrefix + ":" + normalizeUpdateChannel(channel)
}

func (s *UpdateService) getFromCache(ctx context.Context, channel string) (*UpdateInfo, error) {
	data, err := s.cache.GetUpdateInfo(ctx, s.cacheKey(channel))
	if err != nil {
		return nil, err
	}

	var cached struct {
		Latest        string       `json:"latest"`
		ReleaseInfo   *ReleaseInfo `json:"release_info"`
		Timestamp     int64        `json:"timestamp"`
		Channel       string       `json:"channel"`
		UpdateMethod  string       `json:"update_method"`
		Image         string       `json:"image"`
		LatestTag     string       `json:"latest_tag"`
		Digest        string       `json:"digest"`
		ManualCommand string       `json:"manual_command"`
	}
	if err := json.Unmarshal([]byte(data), &cached); err != nil {
		return nil, err
	}

	if time.Now().Unix()-cached.Timestamp > updateCacheTTL {
		return nil, fmt.Errorf("cache expired")
	}

	ch := cached.Channel
	if ch == "" {
		ch = channel
	}
	method := cached.UpdateMethod
	if method == "" {
		method = s.detectUpdateMethod(ch)
	}

	latestTag := strings.TrimSpace(cached.LatestTag)
	// Cached Latest may already be a display version (x.y.z-custom.sha); prefer LatestTag for registry ops.
	if latestTag == "" {
		if strings.Contains(cached.Latest, "-custom.") {
			parts := strings.SplitN(cached.Latest, "-custom.", 2)
			if len(parts) == 2 && parts[1] != "" {
				latestTag = "custom-" + shortCommit(parts[1])
			}
		} else if cached.Latest == "custom" || strings.HasPrefix(cached.Latest, "custom-") {
			latestTag = cached.Latest
		}
	}

	hasUpdate := false
	if ch == UpdateChannelCustom {
		// Cache path has no full tag list; recompute with latest only.
		// Local-ahead false positives require a forced refresh to clear.
		hasUpdate = s.customHasUpdate(GHCRImageTag{Tag: coalesceString(latestTag, cached.Latest), Digest: cached.Digest}, nil)
	} else {
		hasUpdate = compareVersions(s.currentVersion, cached.Latest) < 0
	}

	latestDisplay := cached.Latest
	if ch == UpdateChannelCustom {
		// Normalize display even for older cache entries that stored raw tags.
		latestDisplay = s.formatCustomDisplayVersion(coalesceString(latestTag, cached.Latest))
	}

	return &UpdateInfo{
		CurrentVersion: s.currentVersion,
		LatestVersion:  latestDisplay,
		HasUpdate:      hasUpdate,
		ReleaseInfo:    cached.ReleaseInfo,
		Cached:         true,
		BuildType:      s.buildType,
		Channel:        ch,
		UpdateMethod:   method,
		Image:          cached.Image,
		LatestTag:      coalesceString(latestTag, cached.LatestTag),
		Digest:         cached.Digest,
		ManualCommand:  cached.ManualCommand,
	}, nil
}

func (s *UpdateService) saveToCache(ctx context.Context, channel string, info *UpdateInfo) {
	cacheData := struct {
		Latest        string       `json:"latest"`
		ReleaseInfo   *ReleaseInfo `json:"release_info"`
		Timestamp     int64        `json:"timestamp"`
		Channel       string       `json:"channel"`
		UpdateMethod  string       `json:"update_method"`
		Image         string       `json:"image"`
		LatestTag     string       `json:"latest_tag"`
		Digest        string       `json:"digest"`
		ManualCommand string       `json:"manual_command"`
	}{
		Latest:        info.LatestVersion,
		ReleaseInfo:   info.ReleaseInfo,
		Timestamp:     time.Now().Unix(),
		Channel:       info.Channel,
		UpdateMethod:  info.UpdateMethod,
		Image:         info.Image,
		LatestTag:     info.LatestTag,
		Digest:        info.Digest,
		ManualCommand: info.ManualCommand,
	}

	data, _ := json.Marshal(cacheData)
	_ = s.cache.SetUpdateInfo(ctx, s.cacheKey(channel), string(data), time.Duration(updateCacheTTL)*time.Second)
}

func (s *UpdateService) detectUpdateMethod(channel string) string {
	if channel == UpdateChannelCustom {
		if s.isDockerEnv() {
			return UpdateMethodDocker
		}
		return UpdateMethodManual
	}
	if s.isDockerEnv() {
		// official docker still uses binary in-place update historically; keep binary
		// unless explicitly forced. Leave as binary for compatibility.
		return UpdateMethodBinary
	}
	return UpdateMethodBinary
}

func (s *UpdateService) imageForChannel(channel string) string {
	if channel == UpdateChannelCustom {
		return s.customImage
	}
	return ""
}

func (s *UpdateService) isDockerEnv() bool {
	if s.isDockerEnvFn != nil {
		return s.isDockerEnvFn()
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("SUB2API_UPDATE_METHOD")), "docker") {
		return true
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}

func (s *UpdateService) writePendingImageTag(imageRef string) error {
	dir := s.dataDir
	if s.dataDirFn != nil {
		dir = s.dataDirFn()
	}
	if strings.TrimSpace(dir) == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	path := filepath.Join(dir, pendingImageFileName)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(imageRef+"\n"), 0o644); err != nil {
		return fmt.Errorf("write pending image tag: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("commit pending image tag: %w", err)
	}
	return nil
}

// compareVersions compares two semantic versions (core x.y.z only).
// Suffixes such as -custom.sha or -rc1 are ignored for core comparison.
func compareVersions(current, latest string) int {
	currentParts := parseVersion(current)
	latestParts := parseVersion(latest)

	for i := 0; i < 3; i++ {
		if currentParts[i] < latestParts[i] {
			return -1
		}
		if currentParts[i] > latestParts[i] {
			return 1
		}
	}
	return 0
}

func parseVersion(v string) [3]int {
	v = coreSemver(v)
	parts := strings.Split(v, ".")
	result := [3]int{0, 0, 0}
	for i := 0; i < len(parts) && i < 3; i++ {
		if parsed, err := strconv.Atoi(parts[i]); err == nil {
			result[i] = parsed
		}
	}
	return result
}

func coreSemver(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	// drop pre-release / build metadata: 1.2.3-custom.abc -> 1.2.3
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	// custom-<sha> has no core semver
	if !strings.Contains(v, ".") {
		return ""
	}
	return v
}

func normalizeUpdateChannel(channel string) string {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case UpdateChannelCustom:
		return UpdateChannelCustom
	default:
		return UpdateChannelOfficial
	}
}

func parseUpdateChannel(channel string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case UpdateChannelOfficial, "":
		return UpdateChannelOfficial, nil
	case UpdateChannelCustom:
		return UpdateChannelCustom, nil
	default:
		return "", ErrInvalidUpdateChannel
	}
}

func errorsIsSettingNotFound(err error) bool {
	return err != nil && (err == ErrSettingNotFound || infraerrors.IsNotFound(err) || strings.Contains(err.Error(), "setting not found"))
}

func filterCustomTags(tags []GHCRImageTag) []GHCRImageTag {
	out := make([]GHCRImageTag, 0, len(tags))
	for _, t := range tags {
		tag := strings.TrimSpace(t.Tag)
		if tag == "custom" || strings.HasPrefix(tag, "custom-") {
			t.Tag = tag
			out = append(out, t)
		}
	}
	return out
}

// pickLatestCustomTag selects the newest custom-channel tag by creation/update time.
// Immutable tags (custom-<sha>) are preferred over the floating "custom" retag so that
// update detection and version display track real builds chronologically.
func pickLatestCustomTag(tags []GHCRImageTag) GHCRImageTag {
	if len(tags) == 0 {
		return GHCRImageTag{}
	}
	immutable := make([]GHCRImageTag, 0, len(tags))
	var floating GHCRImageTag
	for _, t := range tags {
		if t.Tag == "custom" {
			if floating.Tag == "" || compareGHCRTagTime(t, floating) > 0 {
				floating = t
			}
			continue
		}
		if strings.HasPrefix(t.Tag, "custom-") {
			immutable = append(immutable, t)
		}
	}
	if len(immutable) > 0 {
		sortCustomTagsNewestFirst(immutable)
		return immutable[0]
	}
	if floating.Tag != "" {
		return floating
	}
	sortCustomTagsNewestFirst(tags)
	return tags[0]
}

// sortCustomTagsNewestFirst orders tags by UpdatedAt/CreatedAt descending.
// Timestamps are parsed as RFC3339 when possible; missing times rank older.
func sortCustomTagsNewestFirst(tags []GHCRImageTag) {
	sort.SliceStable(tags, func(i, j int) bool {
		cmp := compareGHCRTagTime(tags[i], tags[j])
		if cmp != 0 {
			return cmp > 0
		}
		// Same/unknown time: keep deterministic order by tag name (not used as version order).
		return tags[i].Tag > tags[j].Tag
	})
}

// compareGHCRTagTime returns 1 if a is newer than b, -1 if older, 0 if equal/unknown.
func compareGHCRTagTime(a, b GHCRImageTag) int {
	ta, oka := parseGHCRTime(a.UpdatedAt)
	tb, okb := parseGHCRTime(b.UpdatedAt)
	switch {
	case oka && okb:
		if ta.After(tb) {
			return 1
		}
		if ta.Before(tb) {
			return -1
		}
		return 0
	case oka && !okb:
		return 1
	case !oka && okb:
		return -1
	default:
		return 0
	}
}

func parseGHCRTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	// Packages API uses RFC3339 / RFC3339Nano
	if t, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, true
	}
	// Fallback: raw ISO without timezone
	if t, err := time.Parse("2006-01-02T15:04:05", value); err == nil {
		return t.UTC(), true
	}
	return time.Time{}, false
}

func shortCommit(commit string) string {
	commit = strings.TrimSpace(commit)
	if len(commit) > 7 {
		return commit[:7]
	}
	return commit
}

func coalesceString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
