## Why

排障时最痛的是"用户报了一个任务出错，但找不到对应日志"。现在网关只返回 `task_id`，
而错误发生在提交阶段（400/403/429）时**连 task_id 都没有**，日志里无法定位到具体请求。

## What Changes

### 1. 请求级标识

- 每个进入 `/api/*` 与 `/v1/*` 的请求都分配一个 `request_id`
- 调用方可自带 `X-Request-Id`（用于跨系统串联），未提供时由网关生成
- 响应头固定返回 `X-Request-Id`

### 2. 透出到任务

- 提交成功时响应体包含 `request_id`
- 任务状态里记录 `request_id`，`/result` 可回显
- 全链路 JSONL 日志的 `task.submitted` 事件记录该 `request_id`

## Capabilities

### New Capabilities

- `request-tracing`：请求标识的生成、透传与在日志/任务中的关联。

### Modified Capabilities

- 无（`api-contract` 的端点集合与状态机不变，只多一个响应头）

## Impact

- 代码：`main.py`（中间件 + 提交响应 + 任务初始状态）
- 兼容性：调用方不感知 `request_id` 也能正常工作；自带 `X-Request-Id` 时透传

## Out of Scope

- 分布式链路追踪（OpenTelemetry 等）
- 把 `request_id` 注入到 myflicker 子进程环境变量（后续可做）
