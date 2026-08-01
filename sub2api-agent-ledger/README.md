# sub2api Agent Ledger

独立的代理商账本插件服务。此目录不修改父目录 `sub2api` 的源码、配置、数据库或构建文件，所有本地数据保存在本目录的 `data/` 中。

## 当前边界

- 通过主服务管理员邮箱和密码登录，使用服务端 JWT 读取 HTTP Admin API 的用户、余额和使用记录。
- 主服务管理员凭据只在服务端加密保存，不发送到浏览器；JWT 只缓存在进程内存中。
- 远程主服务默认必须使用 HTTPS，且所有登录/Admin API 请求拒绝重定向；loopback HTTP 可直接用于本机开发。
- 代理商绑定、代理商余额、余额流水和卡密属于插件本地数据。
- 管理员和代理商创建的卡密都会从目标代理商的插件本地钱包扣减面值总额；卡密核销只充值同一插件钱包，不写入主服务兑换码。
- 主服务网络代理配置不属于本插件的代理商关系，不由本插件修改。

## 运营管理

- 管理员可更新代理商名称与备注，并可重置代理登录密码；重置后该代理的现有会话立即失效。
- 卡密、审计日志、用户池、绑定记录及本地账本使用统一的 `page` / `pageSize` / `total` 分页协议，单页最大 100 条。

## 开发环境

需要 Node.js 22+ 和 pnpm 11+。安装依赖后复制 `.env.example` 为 `.env`，填写 `SESSION_SECRET`、`PLUGIN_MASTER_KEY` 和主服务管理员登录信息。若主服务管理员启用了 TOTP 或强制 Turnstile，邮箱/密码自动登录会被主服务拒绝，插件会明确显示认证错误。

```powershell
pnpm install
pnpm db:migrate
pnpm build:server
pnpm start
pnpm dev:web
```

说明：NestJS 装饰器需要 TypeScript 编译产物，服务端开发请使用 `pnpm build:server` 后 `pnpm start`（或 `pnpm dev:server` 的编译+watch）。不要直接用 esbuild/tsx 运行 `main.ts`。

远程旧服务暂时无法启用 HTTPS 时，可显式设置 `MAIN_SERVICE_ALLOW_INSECURE_HTTP=true`。这会让管理员密码以明文通过网络传输，只应作为迁移期间的兼容措施。主服务启用 Turnstile 或 TOTP 时，后台邮箱/密码登录无法完成交互验证，插件会返回对应错误。

服务默认地址：

- API: `http://localhost:4173`
- Vue 开发服务器: `http://localhost:4174`

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## Docker 部署

独立 compose 位于仓库 `deploy/agent-ledger/`：

```bash
cp deploy/agent-ledger/.env.example deploy/agent-ledger/.env
docker compose -f deploy/agent-ledger/docker-compose.yml --env-file deploy/agent-ledger/.env up -d --build
```

详见 `deploy/agent-ledger/README.md`。

不要把 `.env`、SQLite 文件或真实卡密提交到版本库。
