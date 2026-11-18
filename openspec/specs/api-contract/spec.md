# API Contract Specification

## Purpose

定义 myflicker 网关对外的 HTTP 契约：私有任务接口（`/api/myflicker/*`）与 OpenAI 兼容接口（`/v1/*`）的鉴权、状态机、响应结构与错误码。任何改动接口形状的提交都必须同步本文件。

## Requirements

### Requirement: Request Authentication

所有 `/api/*` 与 `/v1/*` 接口 SHALL 校验调用方身份；私有接口使用 `X-API-Key` 头，OpenAI 接口 SHALL 同时接受 `Authorization: Bearer <key>` 与 `X-API-Key`。

#### Scenario: 缺少密钥

- **WHEN** 请求缺少 `X-API-Key`（且 `/v1` 请求缺少 Bearer）
- **THEN** 返回 401
- **AND** 私有接口返回 `{"ok":false,"error":{"code":"missing_api_key"}}`
- **AND** OpenAI 接口返回 `{"error":{"message":...,"type":"...","code":"missing_api_key"}}`

#### Scenario: 密钥错误

- **WHEN** 提供的 key 不在 `API_KEY` / `API_KEYS` / `ADMIN_API_KEY` 中
- **THEN** 返回 401 且不泄露任何账号信息

### Requirement: Async Task Submission

`POST /api/myflicker/submit` SHALL 立即返回（HTTP 202）并给出 `task_id`；网关 MUST NOT 在请求线程内执行 myflicker。

#### Scenario: 成功提交

- **WHEN** 请求体包含合法的 `args[]`
- **THEN** 返回 202
- **AND** 响应包含 `task_id`、`status:"pending"`、`submitted_at`、`result_url`、`poll_hint_ms`
- **AND** 任务被投递到该调用方自己的队列 `myflicker:<label>`

#### Scenario: 参数非法

- **WHEN** `args` 不是字符串数组、包含 NUL 字节、超过 `MAX_ARGS` 或单参数超过 `MAX_ARG_LEN`
- **THEN** 返回 400 且 `error.code` 为 `invalid_args` / `too_many_args`

#### Scenario: 队列已满

- **WHEN** 该调用方队列中等待的任务数已达到 `MAX_QUEUE_DEPTH`
- **THEN** 返回 429 且 `error.code` 为 `queue_full`
- **AND** 响应携带 `queue_depth` 与 `max_queue_depth`

### Requirement: Task Status Model

任务状态 SHALL 只能取 `pending` / `running` / `success` / `failure` / `canceled`，且终态时 `finished` MUST 为 `true`。

#### Scenario: 成功任务

- **WHEN** 查询一个已结束且 `returncode=0` 的任务
- **THEN** 返回 `status:"success"`、`returncode`、`duration_ms`、`cmd`、`stdout`、`stderr`

#### Scenario: 失败或超时任务

- **WHEN** 进程退出码非 0 或触发超时被终止
- **THEN** 返回 `status:"failure"` 与 `error`
- **AND** 超时场景 `timed_out` 为 `true`

#### Scenario: 进行中任务

- **WHEN** 任务仍处于 `pending` 或 `running`
- **THEN** 响应包含 `poll_hint_ms` 且 MUST NOT 包含完整的 `stdout` / `stderr`

### Requirement: Task Ownership Visibility

查询、取消他人任务时，网关 SHALL 表现得和任务不存在一致，避免泄露任务存在性。

#### Scenario: 越权查询

- **WHEN** 调用方用别人的 `task_id` 请求 `/api/myflicker/result/{task_id}`
- **THEN** 返回 404 且 `error.code` 为 `task_not_found`

#### Scenario: 取消非排队任务

- **WHEN** 取消一个已经 `running` 或已结束的任务
- **THEN** 返回 409 且 `error.code` 为 `not_cancelable`

### Requirement: Health Snapshot

`GET /api/myflicker/health` SHALL 报告 Redis、worker 在线数、调用方队列深度、绑定地址、局域网可达性、当前身份与工作区、以及生效的安全策略。

#### Scenario: 服务就绪

- **WHEN** Redis 可达
- **THEN** 返回 200，`redis.ok=true`，并包含 `worker.online_workers`、`queue`、`queue_depth`、`identity.workspace`

### Requirement: OpenAI-Compatible Surface

`/v1/chat/completions` SHALL 接受 OpenAI 形状的 `messages[]`，把整段对话转成一个 prompt 交给串行执行链，并返回标准 `chat.completion` 结构；`stream:true` 时 MUST 以 SSE 增量返回。

#### Scenario: 非流式对话

- **WHEN** 请求包含一到多条 `messages` 且 `stream` 不为 true
- **THEN** 返回 `object:"chat.completion"`、`choices[0].message.content` 为该次运行的 stdout
- **AND** 附带 `x_myflicker` 字段（`task_id`、`status`、`returncode`、`duration_ms`）

#### Scenario: 流式对话

- **WHEN** `stream:true`
- **THEN** 以 `text/event-stream` 逐块输出 `chat.completion.chunk`
- **AND** 终止时输出一条带 `finish_reason` 的 chunk 与 `data: [DONE]`

#### Scenario: 模型列表

- **WHEN** 请求 `GET /v1/models`
- **THEN** 返回只含一个条目的 `list`，其 `id` 由 `OPENAI_MODEL_ID` 配置

### Requirement: Workspace Listing

网关 SHALL 提供 `GET /api/myflicker/workspaces`，按调用者身份列出其工作区内的目录。

#### Scenario: 列出工作区

- **WHEN** 调用方携带合法 Key 请求该接口
- **THEN** 返回 `workspace`、当前 `cwd`、`parent`（若有）与 `dirs` 列表
- **AND** 子目录数量上限 200，跳过点目录

#### Scenario: 逐级浏览

- **WHEN** 调用方带上 `?path=<绝对或相对路径>`
- **THEN** 返回该目录的信息与子目录
- **AND** 相对路径以调用者 workspace 为基准解析

#### Scenario: 越界路径

- **WHEN** 请求路径超出调用者 workspace 且沙箱生效
- **THEN** 返回 403 `cwd_outside_workspace`
- **AND** 响应里带 workspace 路径

#### Scenario: 未认证

- **WHEN** 请求缺少或使用错误的 Key
- **THEN** 返回 401，且不泄露任何目录信息

### Requirement: Workspace Changes

网关 SHALL 提供只读的变更查询接口，且只允许访问调用者 workspace 内的仓库。

#### Scenario: 列出改动

- **WHEN** 调用方携带合法 Key 请求 `/api/myflicker/changes?path=<目录>`
- **THEN** 返回 `git: true`、仓库根、当前 cwd 与最多 500 个改动文件
- **AND** 文件包含 `path`、`status`、`staged`、`untracked`

#### Scenario: 非 git 目录

- **WHEN** 目标目录不在 git 仓库内
- **THEN** 返回 `git: false` 与空文件列表
- **AND** 不返回 5xx

#### Scenario: 单文件 diff

- **WHEN** 调用方请求 `/api/myflicker/changes/diff?path=<目录>&file=<相对路径>`
- **THEN** 返回统一 diff（最多 200KB，超出截断）
- **AND** 未跟踪文件返回空 diff 且 `untracked: true`

#### Scenario: 越界仓库

- **WHEN** 仓库根超出调用者 workspace 且沙箱生效
- **THEN** 返回 403 `repo_outside_workspace`

#### Scenario: 非法文件路径

- **WHEN** `file` 是绝对路径或包含 `..`
- **THEN** 返回 400 `invalid_file`

### Requirement: Chat Session Resume

`/v1/chat/completions` SHALL 接受可选 `session_id`，并将其透传为 CLI 的 `--resume`。

#### Scenario: 透传续接

- **WHEN** 请求体带合法的 `session_id`
- **THEN** 启动命令包含 `--resume <session_id>`
- **AND** 只使用最后一条用户消息作为 prompt

#### Scenario: 不续接

- **WHEN** 请求体没有 `session_id`
- **THEN** 命令不包含 `--resume`
- **AND** 使用完整消息构造 prompt

#### Scenario: 非法 id

- **WHEN** `session_id` 非字符串、超长或包含非法字符
- **THEN** 返回 400 `invalid_session_id`
- **AND** 不创建任务

#### Scenario: 调用方自带 resume

- **WHEN** `myflicker_args` 已经包含 `--resume`
- **THEN** 网关不重复追加

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
