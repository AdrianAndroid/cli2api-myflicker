# Proposal

## Why

网关目前只提供 OpenAI 兼容面（`/v1/chat/completions`），而 Claude Code 等原生 Anthropic 客户端只说 Messages 协议（`POST /v1/messages` + Anthropic 形状 SSE）。用户要用 Claude Code 直连本网关时，只能再架一层 Anthropic→OpenAI 转换器。给网关补上 Anthropic 兼容端点后，Claude Code 通过 `ANTHROPIC_BASE_URL` 即可零依赖接入，与 OpenAI 兼容面共享同一条串行执行链。

## What Changes

- 新增 `POST /v1/messages`：接受 Anthropic Messages 形状的请求（`model`、`max_tokens`、`messages[]`、`system`、`tools`、`stream`），转换为单次 myflicker 任务提交，返回 Anthropic 形状的 `message` 响应。
- 新增 `POST /v1/messages/count_tokens`：按现有 token 估算逻辑返回 `{"input_tokens": N/*注意 Claude Code 会调用*/}`（估算值，非精确计数）。
- `stream:true` 时以 Anthropic SSE 事件流返回：`message_start` → `content_block_start` → `content_block_delta`（text_delta）→ `content_block_stop` → `message_delta`（stop_reason）→ `message_stop`，复用现有事件流转发管道。
- 复用既有鉴权（`Authorization: Bearer <key>` 与 `X-API-Key` / Anthropic 的 `x-api-key`）、身份解析、队列路由、超时与 prompt 长度校验逻辑。
- 工具块（`tool_use` / `tool_result`）线性化为文本并入 prompt：底层 myflicker 自身是执行工具的 agent，本网关不做客户端工具回环；请求中的 `tools` 被接受但仅作兼容（记录在响应 debug 字段），MUST NOT 触发网关返回 `tool_use` 内容块。
- 非流式失败仍返回 200 形状的 Anthropic error 包装或既有错误码体系（401/400/504）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `api-contract`: 新增 Anthropic 兼容面需求（`/v1/messages` 与 `/v1/messages/count_tokens` 的鉴权、请求/响应形状、SSE 事件序列、错误码），并注明其与 OpenAI 兼容面共享串行执行链与按 key 隔离约束。

## Impact

- 代码：`openai_api.py`（新增端点与 Anthropic 格式化函数）；可能小幅抽取 `_sse` 中与协议无关的事件转发逻辑。
- 行为：不改变现有 `/v1/chat/completions`、`/api/myflicker/*` 的任何行为；无 breaking change。
- 客户端：Claude Code 设置 `ANTHROPIC_BASE_URL=http://127.0.0.1:8000`、`ANTHROPIC_AUTH_TOKEN=<key>` 即可用。
- 依赖：无新增第三方依赖（SSE 事件为手工拼装，与现有实现一致）。
