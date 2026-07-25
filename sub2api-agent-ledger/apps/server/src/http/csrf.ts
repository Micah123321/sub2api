import type { FastifyReply, FastifyRequest } from 'fastify';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cookie 会话的轻量 CSRF 防护：
 * - 变更请求必须带来自同源的 Origin/Referer，或显式 X-Requested-With
 * - 不替代完整 double-submit token，但可挡住基础跨站表单提交
 */
export function assertCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) {
    return true;
  }

  const path = request.url.split('?')[0] || '';
  if (path === '/api/auth/login') {
    return true;
  }

  const requestedWith = String(request.headers['x-requested-with'] || '');
  if (requestedWith.toLowerCase() === 'xmlhttprequest' || requestedWith === 'sub2api-agent-ledger') {
    return true;
  }

  const origin = String(request.headers.origin || '');
  const referer = String(request.headers.referer || '');
  const host = String(request.headers.host || '');
  if (!host) {
    reply.status(403).send({
      code: 'CSRF_REJECTED',
      message: '缺少 Host，拒绝变更请求',
      requestId: `req_csrf_${Date.now()}`,
    });
    return false;
  }

  const allowed = new Set<string>([
    `http://${host}`,
    `https://${host}`,
  ]);

  if (origin && allowed.has(origin)) {
    return true;
  }
  if (referer && [...allowed].some((item) => referer.startsWith(`${item}/`) || referer === item)) {
    return true;
  }

  // same-host non-browser clients (curl/API smoke) without Origin: require custom header
  if (!origin && !referer) {
    reply.status(403).send({
      code: 'CSRF_REJECTED',
      message: '变更请求需要 Origin/Referer 或 X-Requested-With',
      requestId: `req_csrf_${Date.now()}`,
    });
    return false;
  }

  reply.status(403).send({
    code: 'CSRF_REJECTED',
    message: '跨站变更请求已被拒绝',
    requestId: `req_csrf_${Date.now()}`,
  });
  return false;
}
