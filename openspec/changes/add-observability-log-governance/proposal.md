# Proposal

## Why

排查"Claude 发出的这次请求到底执行了什么"时，现有日志只有 uvicorn 访问行和任务事件，缺少把请求（model/stream/session/cwd）与 task_id 关联的结构化记录；工具/推理过程不可见；同时所有日志永久追加（当前数据目录 89 个任务已 6.7MB），长期会拖慢写入并撑爆磁盘。

## What Changes

- 新增请求级日志：`/v1/messages` 接受请求后写 `request.accepted`（request_id、task_id、model、stream、session_id、cwd、prompt 长度/SHA256/前 512 字符），完成时写 `request.finished`（状态、HTTP 码、耗时）；`task state` 增加 `request_id`。
- 新增可选工具事件跟踪：`ANTHROPIC_TRACE_EVENTS=1`（默认关）时用 `stream-json` 运行，把 `tool_use` / `tool_result` / `text` / `result` 事件写入 `logs/tasks/<task_id>.events.jsonl`，响应形状不变；单任务事件有数量/字节上限。
- 新增日志治理：统一日志与桌面进程日志按大小轮转（默认 20MB × 5 份），按天/总量保留清理（默认 7 天、500MB），`log_event` 改为批量写入，stdout/stderr 落盘前按 `MAX_OUTPUT_CHARS` 截断。
- 全部新增配置项均有默认值，不改变默认可见行为（跟踪默认关）。

## Capabilities

### New Capabilities

- `log-management`: 日志轮转、保留清理、批量写入与输出截断的契约。
- `agent-event-trace`: 可选开启的 agent 结构化事件落盘契约（工具调用/结果），与响应协议解耦。

### Modified Capabilities

- `request-tracing`: 新增 `/v1/messages` 请求生命周期日志（含脱敏 prompt 摘要）与任务状态中的 `request_id` 关联。

## Impact

- 代码：`celery_tasks.py`（日志写入/轮转/清理/事件落盘）、`anthropic_api.py`（请求事件与 trace 模式）、`main.py`（启动时清理、`_submit` 传 request_id）、`desktop/electron/logs.cjs`（桌面日志轮转）、`README_START.md`。
- 行为：默认响应与延迟不变；开启 trace 时任务 stdout 改走 `stream-json`，网关内部解析后仍返回同一形状。
- 运维：新增 `.env` 可选配置，均有安全默认值。
