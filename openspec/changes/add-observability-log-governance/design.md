# Design

## Context

`log_event`（`celery_tasks.py`）每条事件都 open → append → close 统一日志与 per-task 日志；`write_output_file` 写全量 stdout/stderr；`desktop/electron/logs.cjs` 只做内存限长，磁盘文件无限追加。`/v1/messages` 目前仅产生 `task.*` 事件，没有请求级字段；Anthropic 面固定纯文本模式，拿不到 agent 结构化事件。中间件已提供 `request.state.request_id`。

## Goals / Non-Goals

**Goals:**
- 请求级可追踪：request_id ↔ task_id ↔ model/stream/session/cwd，prompt 脱敏。
- 可选工具事件落盘，响应协议不变。
- 日志体积可控：轮转、保留、批写、截断，默认行为与延迟不变。

**Non-Goals:**
- 不改 `/api/myflicker/*` 与 OpenAI 面的既有日志/响应格式。
- 不做日志采集/上报（ELK/Loki），只做本地文件治理。
- 不提供 UI 日志开关（先用 `.env`）。

## Decisions

1. **批量写入用进程内缓冲 + 0.5s 守护线程刷盘，ERROR 立即 flush，`atexit` 兜底**。理由：逐事件 open/close 在每任务数十条事件时会明显放大 IO；纯异步队列要引依赖，不值得。替代（`logging.handlers.RotatingFileHandler`）无法保留现有 JSONL 结构。
2. **轮转用 `.1..N` 顺延的重命名方案，检查频率限制为每 2 秒一次 `stat`**。理由：每行 stat 开销高；20MB 量级下 2 秒粒度足够。桌面 LogBus 用内存字节计数，避免每行 stat。
3. **保留策略两段式：先按 mtime 删除超过保留期的文件，再按总量从最旧开始删，且永不动当前正在写的文件**。理由：兼顾"按时间"和"磁盘上限"两种诉求。
4. **Trace 用 `stream-json` 双工模式，只在 `ANTHROPIC_TRACE_EVENTS=1` 时启用**。理由：纯文本模式无法拿到 tool 事件；开关关闭时代码路径与现在完全一致，零风险。事件用与 OpenAI 面相同的快照差分规则提取文本增量，非流式聚合后作为最终 text。
5. **事件量上限在写入侧拦截**：`AGENT_TRACE_MAX_EVENTS`（默认 5000）与 `AGENT_TRACE_MAX_BYTES`（默认 5MB），超出后写一条 `{"type":"trace.truncated"}` 并停止。理由：agent 可能长时间循环调用工具，响应不能被日志拖垮。
6. **`request.accepted/finished` 复用 `log_event`（同 task 文件）**，字段固定，prompt 只放 `prompt_len / prompt_sha256 / prompt_preview(≤512)`。理由：按 task_id 打开一个文件即可看完整生命周期。
7. **`request_id` 进入 task state**：扩展 `_submit(..., request_id=None)`，Anthropic 面传入中间件值；OpenAI 面暂不传，行为不变。

## Risks / Trade-offs

- [缓冲写入在进程崩溃时会丢最后 ≤0.5s 日志] → ERROR 立即刷、任务终态显式 flush，接受该窗口。
- [轮转重命名在多进程同时写同一文件时可能竞争] → 网关与 worker 都写统一日志；用 `O_APPEND` + 单次 `replace` 的现有行为已存在竞争，本次不引入新语义，文档标注仅本机单实例场景。
- [Trace 开启后 stdout 变成 JSON 行] → 仅在 trace 开启时切换，解析失败回退为原始文本，响应不中断。
- [清理误删当前任务日志] → 保留最近 1 小时或被当前任务写入的文件不删除。
