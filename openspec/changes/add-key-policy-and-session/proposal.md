## Why

`add-harness-controls` 已经把 myflicker 的结构化事件与聊天界面打通，但两件事仍未完成：

1. 所有 key 共用同一套工具权限与审批模式。共享给 LAN 用户时，无法做到"某人只读（plan）"、
   "某人不许改文件"，也无法阻止调用方自行把审批模式提升到 `yolo`。
2. 会话恢复只靠前端传 `messages` 历史，网关没有把 myflicker 的 `sessionId` 暴露成可复用的标识，
   因此无法用 `-r <session-id>` 精确恢复某一条会话分支。

## What Changes

1. **按 key 的执行策略**：`KEY_PROFILES=alice:plan,bob:dontAsk` 映射到 `--approval-mode`；
   支持 `--tools` 白名单与 `--mcp-config`；`ALLOW_YOLO=0` 时忽略调用方的提权参数。
2. **会话标识**：任务状态与 `/v1` 响应返回 `session_id`；提交带 `session_id` 时使用 `-r <id>`。

## Capabilities

### New Capabilities

- `execution-policy`：按 key 的审批模式、工具白名单与 MCP 注入。
- `session-continuity`：会话标识的暴露与显式恢复。

### Modified Capabilities

- 无。

## Impact

- 代码：`identity.py`（解析 `KEY_PROFILES`）、`main.py`/`openai_api.py`（参数拼装、session 透传）、`celery_tasks.py`（解析 sessionId）。
- 配置：`.env` 新增 `KEY_PROFILES`、`ALLOW_YOLO`。
- 安全：默认禁止共享 key 使用 `yolo`。

## Out of Scope

- 审批确认的交互式 UI（`plan` 模式的计划确认）。
- 多机器 worker 池。
