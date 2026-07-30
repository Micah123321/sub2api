# sub2api Agent Ledger

独立的代理商账本插件服务。此目录不修改父目录 `sub2api` 的源码、配置、数据库或构建文件，所有本地数据保存在本目录的 `data/` 中。

## 当前边界

- 通过主服务 HTTP Admin API 读取用户、余额和使用记录。
- 主服务 Admin API Key 只在服务端使用，不发送到浏览器。
- 代理商绑定、代理商余额、余额流水和卡密属于插件本地数据。
- 管理员和代理商创建的卡密都会从目标代理商的插件本地钱包扣减面值总额；卡密核销只充值同一插件钱包，不写入主服务兑换码。
- 主服务网络代理配置不属于本插件的代理商关系，不由本插件修改。

## 尚未实现

以下能力当前**没有交付**，前后端均无实现，不要按已完成对待：

- **代理商的删除与改名/重置密码**：`PATCH /api/admin/agents/:id` 目前只接受 `status`。
- **列表分页**：卡密、审计日志、用户池在服务端分别硬编码 500 / 100 / 100 条上限，前端无分页控件，超出部分不会提示。

## 开发环境

需要 Node.js 22+ 和 pnpm 11+。安装依赖后复制 `.env.example` 为 `.env`，填写 `SESSION_SECRET`、`PLUGIN_MASTER_KEY` 和主服务连接信息。

```powershell
pnpm install
pnpm db:migrate
pnpm build:server
pnpm start
pnpm dev:web
```

说明：NestJS 装饰器需要 TypeScript 编译产物，服务端开发请使用 `pnpm build:server` 后 `pnpm start`（或 `pnpm dev:server` 的编译+watch）。不要直接用 esbuild/tsx 运行 `main.ts`。

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
