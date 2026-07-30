import { createId } from '../common/ids';
import { normalizePage, type PageRequest, type PageResult } from '../common/pagination';
import type Database from 'better-sqlite3';

export interface AuditWriteInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
  requestId?: string | null;
}

const SENSITIVE_KEYS = [
  'password',
  'apiKey',
  'api_key',
  'adminApiKey',
  'token',
  'cardCode',
  'code',
  'secret',
  'authorization',
];

export function redactPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.some((item) => key.toLowerCase().includes(item.toLowerCase()))) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactPayload(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export class AuditService {
  constructor(private readonly sqlite: Database.Database) {}

  write(input: AuditWriteInput): string {
    const id = createId('aud');
    this.sqlite
      .prepare(
        `INSERT INTO audit_logs
         (id, actor_id, actor_role, action, resource_type, resource_id, payload_json, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.actorId ?? null,
        input.actorRole ?? null,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        JSON.stringify(redactPayload(input.payload)),
        input.requestId ?? null,
        Date.now(),
      );
    return id;
  }

  list(limit = 100): Array<Record<string, unknown>> {
    return this.listPage({ page: 1, pageSize: limit }).items;
  }

  listPage(request: PageRequest = {}): PageResult<Record<string, unknown>> {
    const { page, pageSize, offset } = normalizePage(request);
    const total = Number((this.sqlite.prepare('SELECT COUNT(*) AS total FROM audit_logs').get() as { total: number }).total);
    const items = this.sqlite
      .prepare(
        `SELECT id, actor_id as actorId, actor_role as actorRole, action,
                resource_type as resourceType, resource_id as resourceId,
                payload_json as payloadJson, request_id as requestId, created_at as createdAt
         FROM audit_logs
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(pageSize, offset) as Array<Record<string, unknown>>;
    return { items, page, pageSize, total };
  }
}
