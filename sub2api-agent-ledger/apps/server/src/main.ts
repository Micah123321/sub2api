import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.PLUGIN_MASTER_KEY || !process.env.PLUGIN_MASTER_KEY.trim()) {
    throw new Error('PLUGIN_MASTER_KEY 缺失：服务拒绝启动');
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    throw new Error('SESSION_SECRET 缺失或过短：服务拒绝启动');
  }

  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );

  await app.register(fastifyCookie as never, {
    secret: process.env.SESSION_SECRET,
  });

  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4174,http://127.0.0.1:4174')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preHandler', async (request: any, reply: any) => {
    const method = String(request.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return;
    }
    const path = String(request.url || '').split('?')[0];
    if (path === '/api/auth/login') {
      return;
    }
    const requestedWith = String(request.headers['x-requested-with'] || '');
    if (
      requestedWith.toLowerCase() === 'xmlhttprequest' ||
      requestedWith === 'sub2api-agent-ledger'
    ) {
      return;
    }
    const origin = String(request.headers.origin || '');
    const referer = String(request.headers.referer || '');
    const host = String(request.headers.host || '');
    const allowed = host
      ? new Set([`http://${host}`, `https://${host}`])
      : new Set<string>();
    if (origin && allowed.has(origin)) {
      return;
    }
    if (referer && [...allowed].some((item) => referer === item || referer.startsWith(`${item}/`))) {
      return;
    }
    reply.code(403);
    return reply.send({
      code: 'CSRF_REJECTED',
      message: '变更请求需要同源 Origin/Referer 或 X-Requested-With',
      requestId: `req_csrf_${Date.now()}`,
    });
  });

  const webDist = resolve(process.cwd(), 'dist/web');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic as never, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });

    const httpAdapter = app.getHttpAdapter().getInstance();
    httpAdapter.get('/*', (request: { url: string }, reply: { sendFile: (name: string) => void; callNotFound: () => void }) => {
      if (request.url.startsWith('/api')) {
        reply.callNotFound();
        return;
      }
      reply.sendFile('index.html');
    });
  }

  const port = Number(process.env.PORT ?? 4173);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`sub2api-agent-ledger listening on http://0.0.0.0:${port}`);
}

void bootstrap();
