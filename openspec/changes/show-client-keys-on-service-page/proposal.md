# Proposal

## Why

配置 Claude Code（`ANTHROPIC_AUTH_TOKEN`）需要复制服务实际生效的客户端 key，但控制台目前对所有密钥一律掩码，用户只能去翻用户目录里的 `.env`；服务页本就应该承担"这份服务怎么接"的说明职责。

## What Changes

- 新增只读 IPC `env:client-keys`：主进程读取 `.env`，按与后端 `identity.py` 相同的规则解析出所有生效的客户端 key（`API_KEY` 与 `API_KEYS` 的每条），返回 `{label, key}` 明文列表。
- 「服务」页新增"客户端 Key"卡片，**始终**明文展示上述 key 列表，每条带一键复制；`ADMIN_API_KEY` 仍不出现在该卡片、其他页面继续掩码。
- 调整规格：`desktop-console` 的 Secret Handling 从"所有 key 始终掩码"改为"客户端 key 在服务页明文可见，管理 key 仍掩码"。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `desktop-console`: Secret Handling 需求的密钥可见性规则变更（服务页明文展示客户端 key），并补充对应场景。

## Impact

- 代码：`desktop/electron/client-keys.cjs`（新增解析模块）、`main.cjs`、`preload.cjs`、`src/types.ts`、`src/views/OverviewPage.tsx`。
- 安全影响：客户端 key 会出现在服务页（本机界面）；管理 key、远端档案 key 的掩码策略不变。无后端/网关改动。
- 无 breaking change：现有页面掩码行为保留。
