package repository

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type rewriteTransport struct {
	target *url.URL
}

func (t rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = t.target.Scheme
	clone.URL.Host = t.target.Host
	return http.DefaultTransport.RoundTrip(clone)
}

func newGHCRTestClient(handler http.Handler) (*GHCRClient, func()) {
	server := httptest.NewServer(handler)
	target, err := url.Parse(server.URL)
	if err != nil {
		server.Close()
		panic(err)
	}
	client := &GHCRClient{
		httpClient: &http.Client{Transport: rewriteTransport{target: target}},
	}
	return client, server.Close
}

func TestGHCRClientListViaPackagesAPI_PreservesPackageIdentity(t *testing.T) {
	client, cleanup := newGHCRTestClient(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/users/") {
			http.NotFound(w, r)
			return
		}
		require.Equal(t, "/orgs/owner/packages/container/sub2api/versions", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"id":         42,
				"name":       "sha256:abc",
				"created_at": "2026-07-18T00:00:00Z",
				"updated_at": "2026-07-18T01:00:00Z",
				"html_url":   "https://github.com/owner/sub2api/pkgs/container/sub2api/42",
				"metadata": map[string]any{
					"container": map[string]any{"tags": []string{"custom", "custom-e191eba5"}},
				},
			},
			{
				"id":         41,
				"name":       "sha256:def",
				"created_at": "2026-07-17T00:00:00Z",
				"updated_at": "2026-07-17T00:00:00Z",
				"metadata": map[string]any{
					"container": map[string]any{"tags": []string{"custom-fca83040"}},
				},
			},
		})
	}))
	defer cleanup()

	tags, err := client.listViaPackagesAPI(context.Background(), "owner", "sub2api")
	require.NoError(t, err)
	require.Len(t, tags, 3)

	byTag := make(map[string]struct {
		id       string
		digest   string
		created  string
		verified bool
	})
	for _, tag := range tags {
		byTag[tag.Tag] = struct {
			id       string
			digest   string
			created  string
			verified bool
		}{tag.PackageVersionID, tag.Digest, tag.CreatedAt, tag.MetadataVerified}
	}

	require.Equal(t, byTag["custom-e191eba5"].id, byTag["custom"].id)
	require.Equal(t, "42", byTag["custom"].id)
	require.Equal(t, "sha256:abc", byTag["custom"].digest)
	require.Equal(t, "2026-07-18T00:00:00Z", byTag["custom"].created)
	require.True(t, byTag["custom"].verified)
	require.Equal(t, "41", byTag["custom-fca83040"].id)
}

func TestGHCRClientListViaPackagesAPIMarksIncompleteMetadataUnverified(t *testing.T) {
	client, cleanup := newGHCRTestClient(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/users/") {
			http.NotFound(w, r)
			return
		}
		require.Equal(t, "/orgs/owner/packages/container/sub2api/versions", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":42,"name":"sha256:abc","metadata":{"container":{"tags":["custom","custom-e191eba5"]}}}]`))
	}))
	defer cleanup()

	tags, err := client.listViaPackagesAPI(context.Background(), "owner", "sub2api")
	require.NoError(t, err)
	require.Len(t, tags, 2)
	for _, tag := range tags {
		require.Equal(t, "42", tag.PackageVersionID)
		require.Equal(t, "sha256:abc", tag.Digest)
		require.Empty(t, tag.CreatedAt)
		require.Empty(t, tag.UpdatedAt)
		require.False(t, tag.MetadataVerified)
	}
}

func TestGHCRClientListViaOCITagsMarksMetadataUnverified(t *testing.T) {
	client, cleanup := newGHCRTestClient(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v2/owner/sub2api/tags/list", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"owner/sub2api","tags":["custom","custom-e191eba5"]}`))
	}))
	defer cleanup()

	tags, err := client.listViaOCITags(context.Background(), "owner", "sub2api")
	require.NoError(t, err)
	require.Len(t, tags, 2)
	for _, tag := range tags {
		require.False(t, tag.MetadataVerified)
		require.Empty(t, tag.PackageVersionID)
		require.Empty(t, tag.CreatedAt)
		require.Empty(t, tag.Digest)
	}
}
