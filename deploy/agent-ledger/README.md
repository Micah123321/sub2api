# Agent Ledger 容器部署

独立部署 `sub2api-agent-ledger` 插件。SQLite 落在数据卷，主服务只通过 HTTP 只读访问。

## 文件

| 文件 | 用途 |
|------|------|
| `docker-compose.yml` | 独立 compose 服务 |
| `Dockerfile` | 多阶段构建（pnpm build → node 运行） |
| `.env.example` | 环境变量模板 |
| `docker-entrypoint.sh` | 启动前自动迁移（与插件内 tooling 同步） |

## 快速开始

在**仓库根目录**执行：

```bash
cp deploy/agent-ledger/.env.example deploy/agent-ledger/.env
# 编辑 deploy/agent-ledger/.env

docker compose \
  -f deploy/agent-ledger/docker-compose.yml \
  --env-file deploy/agent-ledger/.env \
  up -d --build
```

访问：

- 页面/API: `http://localhost:4173`
- 健康检查: `http://localhost:4173/api/health`

停止：

```bash
docker compose -f deploy/agent-ledger/docker-compose.yml --env-file deploy/agent-ledger/.env down
```

删除数据卷：

```bash
docker compose -f deploy/agent-ledger/docker-compose.yml --env-file deploy/agent-ledger/.env down -v
```

## 配置

| 变量 | 必填 | 说明 |
|------|------|------|
| `SESSION_SECRET` | 是 | Cookie 会话密钥，≥16 字符 |
| `PLUGIN_MASTER_KEY` | 是 | 加密主服务 Admin API Key，建议 32 字节 base64 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 是 | 首次管理员密码 |
| `MAIN_SERVICE_BASE_URL` | 否 | 默认 `http://host.docker.internal:8080` |
| `MAIN_SERVICE_ADMIN_API_KEY` | 否 | 主服务 Admin API Key；也可登录后在设置页配置 |
| `CORS_ORIGINS` | 否 | 前端源白名单，逗号分隔 |
| `AGENT_LEDGER_PORT` | 否 | 宿主机端口，默认 `4173` |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 与主服务

- 不写入主服务数据库，不改主服务 compose。
- 宿主机主服务：`MAIN_SERVICE_BASE_URL=http://host.docker.internal:8080`
- 同 Docker 网络：改为服务名，例如 `http://sub2api:8080`，并把本服务加入该网络。

## 镜像单独构建

```bash
# 在仓库根目录
docker build \
  -f deploy/agent-ledger/Dockerfile \
  -t sub2api-agent-ledger:local \
  .
```

## 数据

- 容器路径：`/app/data`
- 卷名默认：`sub2api_agent_ledger_data`
- 入口脚本启动前自动执行 SQLite 迁移
