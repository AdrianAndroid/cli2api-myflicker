# Design

## Context

Claude Code 的用户配置在 `~/.claude/settings.json`，其 `env` 对象会覆盖 shell 的 `export`；当前用户就是因此一直走 ARK 而不是本机网关。控制台主进程已有 `EnvStore`（可读 `.env`）与 IPC/preload 通道，渲染层按「服务 / 连接 / 设置」分页。

## Goals / Non-Goals

**Goals:**
- 一个按钮完成"把本机网关写进 Claude Code 配置"，失败不改文件。
- 可回滚（备份 + 恢复按钮），状态可见。
- 不泄露 key 明文到界面。

**Non-Goals:**
- 不管理 Claude Code 的模型/权限/allowlist 配置。
- 不改 `~/.zshrc` 或项目内 `.claude/settings.json`。
- 不自动重启 Claude Code 或控制台服务。

## Decisions

1. **独立模块 `claude-config.cjs` 承载读写/备份/恢复**，主进程只传 `envStore.readAll()`。理由：可脱离 Electron 用 node + 临时路径单元测试；测试通过 `MYFLICKER_CLAUDE_SETTINGS` 覆盖目标文件，绝不触碰真实 `~/.claude`。
2. **覆盖前整文件备份**（`settings.json.myflicker-backup-<ISO时间戳>`，600），而不是只记录 diff。理由：用户可能同时有 ARK、hooks、permissions 等大量内容，整文件恢复最可靠。
3. **写入策略是"合并 env"**：只设置 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`，删除 `ANTHROPIC_API_KEY`（两者同时存在会让客户端选错鉴权头），其它 env 与顶层字段原样保留。
4. **地址推导复用服务实际配置**：`API_HOST=0.0.0.0` 时给客户端用 `127.0.0.1`，端口取 `API_PORT`；不写死 8000。key 优先 `API_KEY`，否则取 `API_KEYS` 第一条。
5. **UI 放在「连接」页**（与"客户端怎么连"同域），卡片内展示路径、当前地址、掩码 token 与两个按钮；成功后提示"重启 Claude Code 生效"。

## Risks / Trade-offs

- [用户同时在用 ARK 配置，被覆盖后忘记恢复] → 写入前备份 + 卡片常驻「恢复上次备份」+ 成功提示备份文件名。
- [key 明文落盘到 settings.json] → 该文件本就是 Claude Code 的配置（原 ARK token 亦为明文）；新文件权限 600，界面只显示掩码。
- [多实例并发写同一文件] → 桌面端为主进程单写；配置动作非高频，接受最后写入者生效。
