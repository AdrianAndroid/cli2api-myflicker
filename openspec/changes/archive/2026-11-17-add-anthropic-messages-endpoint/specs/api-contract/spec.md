# Spec Delta

## ADDED Requirements

### Requirement: Anthropic-Compatible Messages Surface

网关 SHALL 提供 `POST /v1/messages`，接受 Anthropic Messages 形状的请求（`model`、`max_tokens`、`messages[]`，可选 `system`、`tools`、`stream`、`session_id`、`cwd`），并把整段对话转换成一次 myflicker 任务提交给调用方自己的串行通道执行。该端点与 OpenAI 兼容面 MUST 共享同一执行约束：每个 API key 一条串行通道，同工作目录串行、跨目录并行。`stream:true` 时 MUST 按 Anthropic SSE 事件序列返回。

#### Scenario: 非流式消息

- **WHEN** 请求携带合法 key 与一到多条 `messages`，且 `stream` 不为 true
- **THEN** 返回 200，响应为 `type:"message"`、`role:"assistant"`，`content` 仅含一个 `type:"text"` 块并携带该次运行的 stdout
- **AND** 包含 `stop_reason`（成功为 `"end_turn"`）、`usage`（`input_tokens`、`output_tokens`，估算值）与 debug 字段 `x_myflicker`（`task_id`、`status`、`returncode`、`duration_ms`）

#### Scenario: 流式消息

- **WHEN** `stream:true`
- **THEN** 以 `text/event-stream` 返回，事件序列 MUST 为 `message_start` → `content_block_start` → 若干 `content_block_delta`（`type:"text_delta"`）→ `content_block_stop` → `message_delta`（含 `stop_reason` 与 `usage`）→ `message_stop`
- **AND** `message_start` 携带 `x_myflicker_task_id`，客户端可用于关联私有任务查询

#### Scenario: 鉴权失败

- **WHEN** 请求缺少或携带错误密钥（鉴权接受 `Authorization: Bearer <key>`、`X-API-Key` 与 Anthropic 的 `x-api-key` 头）
- **THEN** 返回 `{"type":"error","error":{"type":"authentication_error","message":...}}`，HTTP 状态码为 401

#### Scenario: 请求非法

- **WHEN** `messages` 缺失、非数组或无可提取文本，或 `max_tokens` 为负数
- **THEN** 返回 `{"type":"error","error":{"type":"invalid_request_error","message":...}}`，HTTP 状态码为 400；prompt 超长时 `error.type` 为 `prompt_too_long`，超时未完成为超时错误包装

#### Scenario: 工具块线性化

- **WHEN** `messages` 中包含 `tool_use` / `tool_result` 内容块，或请求包含 `tools`
- **THEN** 网关 SHALL 把工具块按出现顺序线性化为文本并入 prompt（`tool_result` 以其文本内容参与，JSON 结果序列化为文本）
- **AND** 请求中的 `tools` 被接受但不改变响应形状：响应 `content` MUST NOT 含 `type:"tool_use"` 块，`stop_reason` MUST NOT 为 `"tool_use"`，因为底层 myflicker agent 自行执行工具

#### Scenario: 会话续接

- **WHEN** 请求携带合法 `session_id`
- **THEN** 只把最后一条 `user` 消息作为新轮 prompt，任务以 `--resume <session_id>` 续接该 key 自己工作目录下已有的 myflicker 会话

### Requirement: Anthropic Token Counting Endpoint

网关 SHALL 提供 `POST /v1/messages/count_tokens`，返回 `{"input_tokens": N}` 估算值；该端点 MUST 使用与 `/v1/messages` 相同的鉴权与错误码体系。

#### Scenario: 计数请求

- **WHEN** 请求携带合法 key 与 `messages[]`（可含 `system`）
- **THEN** 返回 200 与 `{"input_tokens": <估算值>}`，不提交任何 myflicker 任务

#### Scenario: 计数请求非法

- **WHEN** 请求未鉴权或 `messages` 非法
- **THEN** 返回与 `/v1/messages` 相同的 401 / 400 错误包装
