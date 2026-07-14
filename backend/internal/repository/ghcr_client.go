package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/httpclient"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

// GHCRClient 访问 GitHub Container Registry / Packages 的接口实现。
// 优先使用 GitHub Packages container versions API，失败时回退 OCI tags list。
type GHCRClient struct {
	httpClient *http.Client
	token      string
}

// NewGHCRClient 创建 GHCR 客户端。
// proxyURL 为空时直连；token 可选（公共包可不传）。
func NewGHCRClient(proxyURL, token string, allowDirectOnProxyError bool) service.GHCRClient {
	client, err := httpclient.GetClient(httpclient.Options{
		Timeout:  30 * time.Second,
		ProxyURL: proxyURL,
	})
	if err != nil {
		if strings.TrimSpace(proxyURL) != "" && !allowDirectOnProxyError {
			slog.Warn("proxy client init failed, all requests will fail", "service", "ghcr", "error", err)
			return &ghcrClientError{err: fmt.Errorf("proxy client init failed and direct fallback is disabled: %w", err)}
		}
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &GHCRClient{
		httpClient: client,
		token:      strings.TrimSpace(token),
	}
}

type ghcrClientError struct {
	err error
}

func (c *ghcrClientError) ListImageTags(context.Context, string) ([]service.GHCRImageTag, error) {
	return nil, c.err
}

func (c *GHCRClient) ListImageTags(ctx context.Context, image string) ([]service.GHCRImageTag, error) {
	owner, packageName, err := parseGHCRImage(image)
	if err != nil {
		return nil, err
	}

	tags, err := c.listViaPackagesAPI(ctx, owner, packageName)
	if err == nil && len(tags) > 0 {
		return tags, nil
	}
	if err != nil {
		slog.Debug("ghcr packages api failed, fallback to oci tags", "error", err)
	}

	ociTags, ociErr := c.listViaOCITags(ctx, owner, packageName)
	if ociErr != nil {
		if err != nil {
			return nil, fmt.Errorf("packages api: %v; oci tags: %w", err, ociErr)
		}
		return nil, ociErr
	}
	return ociTags, nil
}

type ghcrPackageVersion struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	UpdatedAt string `json:"updated_at"`
	CreatedAt string `json:"created_at"`
	HTMLURL   string `json:"html_url"`
	Metadata  struct {
		Container struct {
			Tags []string `json:"tags"`
		} `json:"container"`
	} `json:"metadata"`
}

func (c *GHCRClient) listViaPackagesAPI(ctx context.Context, owner, packageName string) ([]service.GHCRImageTag, error) {
	// package name may contain path segments; encode path carefully
	encodedPkg := url.PathEscape(packageName)
	// Try user packages first, then org packages.
	urls := []string{
		fmt.Sprintf("https://api.github.com/users/%s/packages/container/%s/versions?per_page=100", owner, encodedPkg),
		fmt.Sprintf("https://api.github.com/orgs/%s/packages/container/%s/versions?per_page=100", owner, encodedPkg),
	}

	var lastErr error
	for _, apiURL := range urls {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "Sub2API-Updater")
		if c.token != "" {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode == http.StatusNotFound {
			lastErr = fmt.Errorf("GitHub packages API returned 404")
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("GitHub packages API returned %d", resp.StatusCode)
			continue
		}

		var versions []ghcrPackageVersion
		if err := json.Unmarshal(body, &versions); err != nil {
			lastErr = err
			continue
		}

		out := make([]service.GHCRImageTag, 0, len(versions)*2)
		seen := make(map[string]struct{})
		for _, v := range versions {
			// Prefer created_at so custom channel versions order by package creation time.
			// Fall back to updated_at when create time is missing.
			createdAt := strings.TrimSpace(v.CreatedAt)
			if createdAt == "" {
				createdAt = strings.TrimSpace(v.UpdatedAt)
			}
			digest := strings.TrimSpace(v.Name)
			for _, tag := range v.Metadata.Container.Tags {
				tag = strings.TrimSpace(tag)
				if tag == "" {
					continue
				}
				if _, ok := seen[tag]; ok {
					// Keep first-seen (Packages API returns newest versions first).
					continue
				}
				seen[tag] = struct{}{}
				out = append(out, service.GHCRImageTag{
					Tag:       tag,
					Digest:    digest,
					UpdatedAt: createdAt,
					HTMLURL:   v.HTMLURL,
				})
			}
		}
		return out, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("GitHub packages API unavailable")
	}
	return nil, lastErr
}

func (c *GHCRClient) listViaOCITags(ctx context.Context, owner, packageName string) ([]service.GHCRImageTag, error) {
	apiURL := fmt.Sprintf("https://ghcr.io/v2/%s/%s/tags/list", owner, packageName)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Sub2API-Updater")
	if c.token != "" {
		// Prefer configured PAT/token as Bearer when available.
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	// Anonymous GHCR access usually requires a registry token exchange via WWW-Authenticate.
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		authHeader := resp.Header.Get("WWW-Authenticate")
		_ = resp.Body.Close()
		registryToken, tokenErr := c.fetchRegistryToken(ctx, authHeader)
		if tokenErr != nil {
			return nil, fmt.Errorf("GHCR tags API returned %d (token exchange failed: %w)", resp.StatusCode, tokenErr)
		}
		req2, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if err != nil {
			return nil, err
		}
		req2.Header.Set("User-Agent", "Sub2API-Updater")
		req2.Header.Set("Authorization", "Bearer "+registryToken)
		resp, err = c.httpClient.Do(req2)
		if err != nil {
			return nil, err
		}
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GHCR tags API returned %d", resp.StatusCode)
	}

	var payload struct {
		Name string   `json:"name"`
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	out := make([]service.GHCRImageTag, 0, len(payload.Tags))
	for _, tag := range payload.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		out = append(out, service.GHCRImageTag{Tag: tag})
	}
	return out, nil
}

// fetchRegistryToken performs the Docker Registry v2 auth challenge exchange for GHCR.
// Supports anonymous pull (no configured token) and authenticated pull (PAT/token).
func (c *GHCRClient) fetchRegistryToken(ctx context.Context, wwwAuthenticate string) (string, error) {
	// Example:
	// Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/name:pull"
	wwwAuthenticate = strings.TrimSpace(wwwAuthenticate)
	if wwwAuthenticate == "" {
		return "", fmt.Errorf("missing WWW-Authenticate challenge")
	}
	// Strip scheme prefix
	if i := strings.Index(wwwAuthenticate, " "); i >= 0 {
		wwwAuthenticate = strings.TrimSpace(wwwAuthenticate[i+1:])
	}
	params := map[string]string{}
	for _, part := range strings.Split(wwwAuthenticate, ",") {
		part = strings.TrimSpace(part)
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.TrimSpace(kv[0])
		val := strings.Trim(strings.TrimSpace(kv[1]), `"`)
		params[key] = val
	}
	realm := params["realm"]
	if realm == "" {
		return "", fmt.Errorf("WWW-Authenticate missing realm")
	}
	q := url.Values{}
	if svc := params["service"]; svc != "" {
		q.Set("service", svc)
	}
	if scope := params["scope"]; scope != "" {
		q.Set("scope", scope)
	}
	tokenURL := realm
	if enc := q.Encode(); enc != "" {
		if strings.Contains(realm, "?") {
			tokenURL = realm + "&" + enc
		} else {
			tokenURL = realm + "?" + enc
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tokenURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Sub2API-Updater")
	if c.token != "" {
		// GitHub PAT for GHCR token endpoint: Basic with username ignored / empty user.
		req.SetBasicAuth(c.token, c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry token endpoint returned %d", resp.StatusCode)
	}
	var payload struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", err
	}
	token := strings.TrimSpace(payload.Token)
	if token == "" {
		token = strings.TrimSpace(payload.AccessToken)
	}
	if token == "" {
		return "", fmt.Errorf("registry token response empty")
	}
	return token, nil
}

func parseGHCRImage(image string) (owner, packageName string, err error) {
	image = strings.TrimSpace(image)
	image = strings.TrimPrefix(image, "https://")
	image = strings.TrimPrefix(image, "http://")
	// strip digests / tags if present
	if i := strings.Index(image, "@"); i >= 0 {
		image = image[:i]
	}
	if i := strings.LastIndex(image, ":"); i >= 0 {
		// only treat as tag separator when after last slash
		if j := strings.LastIndex(image, "/"); j < i {
			image = image[:i]
		}
	}
	image = strings.TrimPrefix(image, "ghcr.io/")
	parts := strings.Split(image, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid GHCR image %q, expected ghcr.io/<owner>/<name>", image)
	}
	owner = strings.ToLower(parts[0])
	packageName = strings.ToLower(strings.Join(parts[1:], "/"))
	if owner == "" || packageName == "" {
		return "", "", fmt.Errorf("invalid GHCR image %q", image)
	}
	return owner, packageName, nil
}
