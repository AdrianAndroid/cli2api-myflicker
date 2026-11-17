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
