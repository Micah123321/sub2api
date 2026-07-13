-- 内容审计：支持官方 Moderation 与普通 Chat Completions 双引擎

ALTER TABLE content_moderation_logs
    ADD COLUMN IF NOT EXISTS audit_engine VARCHAR(32) NOT NULL DEFAULT 'moderation';

ALTER TABLE content_moderation_logs
    ADD COLUMN IF NOT EXISTS confidence DECIMAL(8, 6) NOT NULL DEFAULT 0;

ALTER TABLE content_moderation_logs
    ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';
