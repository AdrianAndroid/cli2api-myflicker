# Spec Delta

## ADDED Requirements

### Requirement: Messages Request Lifecycle Logging

`POST /v1/messages` SHALL 在任务提交后写入 `request.accepted` 事件，并在结束（成功、失败或超时）后写入 `request.finished` 事件；两条事件 MUST 同时包含 `request_id` 与 `task_id`，且新增事件中的 prompt MUST 只记录长度、SHA256 与最多 512 字符的预览，不得在该事件中记录完整 prompt。任务状态 SHALL 包含同一个 `request_id`。

#### Scenario: 请求被接受

- **WHEN** 调用方通过鉴权并成功提交 `/v1/messages` 任务
- **THEN** 日志出现 `request.accepted`，含 `request_id`、`task_id`、`model`、`stream`、`session_id`、`cwd`、`prompt_len`、`prompt_sha256`、`prompt_preview`
- **AND** `/api/myflicker/result/{task_id}` 的 `request_id` 与响应头 `X-Request-Id` 一致

#### Scenario: 请求结束

- **WHEN** 任务进入终态或等待超时
- **THEN** 日志出现 `request.finished`，含 `status`、`duration_ms`、`http_status`
- **AND** 流式请求在事件流结束后写入，非流式在返回前写入

#### Scenario: Prompt 脱敏

- **WHEN** prompt 超过 512 字符
- **THEN** `prompt_preview` 截断到 512 字符以内
- **AND** 日志中不出现完整 prompt 或密钥
