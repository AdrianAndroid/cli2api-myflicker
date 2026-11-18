# Proposal

## Why

用户要让 Claude Code 走本机网关，必须手工找到并编辑 `~/.claude/settings.json` 的 `env`（它优先级高于 shell 变量），还容易继续用旧端口或占位 key。控制台已经掌握真实地址与 key，应提供一键写入与恢复。

## What Changes

- 桌面控制台新增 `claude:status` / `claude:configure` / `claude:restore` 三个 IPC：读取、写入（先备份）与恢复 `~/.claude/settings.json`。
- 「连接」页新增「Claude Code 接入」卡片：显示目标文件、当前 base URL 与 key 掩码，提供「配置 Claude Code」与「恢复上次备份」按钮；成功后提示生效方式（重启 Claude Code）。
- 写入规则：`ANTHROPIC_BASE_URL` 取本机服务地址（`0.0.0.0` 映射为 `127.0.0.1`，端口取 `API_PORT`），`ANTHROPIC_AUTH_TOKEN` 取 `API_KEY` 或 `API_KEYS` 的第一条；移除冲突的 `ANTHROPIC_API_KEY`；保留文件中的其他字段。
- 安全：写入前把原文件复制为 `settings.json.myflicker-backup-<时间戳>`（权限 600），新文件同样 600；界面只显示 key 掩码。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `desktop-console`: 新增「Claude Code 接入配置」需求（写入/备份/恢复/错误处理）。

## Impact

- 代码：`desktop/electron/claude-config.cjs`（新增）、`main.cjs`、`preload.cjs`、`src/types.ts`、`src/views/ConnectPage.tsx`。
- 安全影响：token 会写入用户本机的 Claude Code 配置（原本也是明文）；界面不展示明文，只展示掩码。
- 无后端改动；不影响现有连接档案与 ARK 配置（覆盖前有备份）。
