/** Validates the credential transport boundary and returns a normalized base URL. */
export function resolveRemoteBaseUrl(value: string, allowInsecureHttp: boolean): string {
  const url = new URL(value.replace(/\/+$/, ''));
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('主服务地址不能包含凭据、查询参数或片段');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('主服务地址仅支持 HTTP 或 HTTPS');
  }
  const localHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname);
  if (url.protocol === 'http:' && !localHttp && !allowInsecureHttp) {
    throw new Error('远程主服务必须使用 HTTPS；确需使用 HTTP 时显式启用不安全传输兼容开关');
  }
  return url.toString().replace(/\/$/, '');
}

/** Resolves and validates the final request URL after URL normalization. */
export function resolveAllowedRemoteUrl(
  baseUrl: string,
  pathWithQuery: string,
  method: string,
): string {
  if (
    !pathWithQuery.startsWith('/') ||
    /%(?:2e|2f|5c)/i.test(pathWithQuery) ||
    pathWithQuery.includes('\\')
  ) {
    throw new Error('远程请求路径包含禁止的编码或分隔符');
  }
  const base = new URL(baseUrl);
  const prefix = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
  const url = new URL(`${baseUrl}${pathWithQuery}`);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${prefix}/`)) {
    throw new Error('远程请求路径越出主服务地址范围');
  }
  const path = url.pathname.slice(prefix.length) || '/';
  const allowed =
    (method === 'POST' && path === '/api/v1/auth/login') ||
    (method === 'GET' &&
      (ALLOWED_ADMIN_PATHS.has(path) ||
        /^\/api\/v1\/admin\/users\/[^/]+$/.test(path) ||
        /^\/api\/v1\/admin\/users\/[^/]+\/(usage|balance-history)$/.test(path)));
  if (!allowed) {
    throw new Error(`未登记的远程路径: ${path}`);
  }
  return url.toString();
}

const ALLOWED_ADMIN_PATHS = new Set([
  '/api/v1/admin/users',
  '/api/v1/admin/usage',
  '/api/v1/admin/usage/stats',
]);

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127\./.test(hostname)
  );
}
