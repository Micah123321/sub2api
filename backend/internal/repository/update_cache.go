package repository

import (
	"context"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/redis/go-redis/v9"
)

const defaultUpdateCacheKey = "update:latest"

type updateCache struct {
	rdb *redis.Client
}

func NewUpdateCache(rdb *redis.Client) service.UpdateCache {
	return &updateCache{rdb: rdb}
}

func (c *updateCache) GetUpdateInfo(ctx context.Context, key string) (string, error) {
	return c.rdb.Get(ctx, resolveUpdateCacheKey(key)).Result()
}

func (c *updateCache) SetUpdateInfo(ctx context.Context, key, data string, ttl time.Duration) error {
	return c.rdb.Set(ctx, resolveUpdateCacheKey(key), data, ttl).Err()
}

func resolveUpdateCacheKey(key string) string {
	if strings.TrimSpace(key) == "" {
		return defaultUpdateCacheKey
	}
	return key
}
