## Why

工作区已经记录每条回复的 `session_id`，但发送时没有用它：每次请求都把全部历史拼成一段 prompt，agent 每次都是新会话。

myflicker CLI 支持 `-r/--resume [session-id]`，网关只要透传，就能让同一线程真正续接上下文，避免历史重复注入。

## What Changes

- `/v1/chat/completions` 接受可选 `session_id`，校验后追加 `--resume <id>`；
- 续接时只把最后一条用户消息作为 prompt，不再重复历史；
- 工作区在续接状态下只发送新问题，并在标题栏显示「续接 sess-…」标签；
- 点击标签可断开续接，下一条回到“携带完整历史”的模式；
- 未续接时行为不变；事件里仍然带 `sessionId`，新会话自动记录。

## Capabilities

### New Capabilities

- `workspace-resume`：续接发送、续接标签、断开回退。

### Modified Capabilities

无（`api-contract` 以新增需求扩展）。

## Impact

- 代码：`openai_api.py`（session_id 校验、参数、prompt 裁剪）、`desktop/src/views/ChatPage.tsx`、`desktop/src/styles.css`；
- 兼容：不传 `session_id` 的调用完全不变；
- 风险：会话 id 失效时上游报错会显示在气泡里，用户可点标签断开后重发。

## Out of Scope

- 自动发现「最近会话」并续接（仍由事件提供 id）；
- 跨目录续接；
- 会话清理与保留策略。
