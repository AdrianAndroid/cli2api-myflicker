## Why

myflicker 本身已经是完整的 agent harness：支持 MCP 服务器（`--mcp-config`）、工具开关（`--tools`）、
工具审批模式（`--approval-mode default|autoEdit|auto|yolo|plan|dontAsk`）、会话恢复（`-r <id>` / `-c` / `--read-only`）。

但网关和聊天界面只用了 `-q "<prompt>"`：所有 key 都是同一套工具权限、拿不到会话 id、看不到执行步骤，
"共享给别人用"时既不敢放开 MCP，也没法做审批。真正缺的是**把已有能力暴露成策略与可视化**，
而不是再引入 OpenHands 之类的第二套 agent（会出现两个 planner 互相打架，且那套还需要额外的模型 API）。

## What Changes

1. **按 key 的执行策略**：`KEY_PROFILES=alice:plan,bob:dontAsk` 映射到 `--approval-mode`；
   可选 `--tools` 白名单与 `--mcp-config`，LAN 用户不得自行提升到 `yolo`。
2. **会话连续性**：首次回答后从输出解析 session id 并返回 `x_myflicker.session_id` / 任务状态字段；
   后续请求带 `session_id` 时转成 `-r <id>`。
3. **步骤可视化**：把 Redis 输出流里的事件（启动、工具调用行、输出块）在聊天界面渲染成步骤，
   而不是一坨纯文本。

## Capabilities

### New Capabilities

- `harness-controls`：按 key 的工具/审批策略与 MCP 注入。

### Modified Capabilities

- `api-contract`：提交与结果增加可选的 `session_id` 字段。

## Impact

- 代码：`identity.py`（策略解析）、`main.py`/`openai_api.py`（参数拼装、session 透传）、`celery_tasks.py`（解析 session id）、`desktop/src/views/ChatPage.tsx`（步骤渲染与"继续会话"）。
- 配置：`.env` 新增 `KEY_PROFILES`、`ALLOW_YOLO=0`。
- 安全：默认禁止共享用户使用 `yolo` 审批模式。

## Out of Scope

- 引入外部 agent 框架（OpenHands/LibreChat）作为执行者。
- 多机器 worker 池。
