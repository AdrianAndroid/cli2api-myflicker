# Tasks

## 1. 日志写入治理（后端）

- [x] 1.1 `celery_tasks.py` 增加 `LOG_MAX_BYTES`（20MB）/`LOG_BACKUPS`（5）/`LOG_RETENTION_DAYS`（7）/`LOG_DIR_MAX_BYTES`（500MB）配置与 `rotate_if_needed()`、`prune_logs()`；验证：在 `/tmp` 造 30MB 假日志与多个旧文件，调用函数后断言 `.1` 存在、旧文件被删、总量低于上限。
- [x] 1.2 `log_event` 改为进程内缓冲批量写（≥64 条或 0.5s 刷新，ERROR 立即刷，atexit 兜底），`write_output_file` 落盘前按 `MAX_OUTPUT_CHARS` 截断；验证：脚本连续写 200 条事件后正常退出，统一日志与 per-task 文件各 200 行且顺序一致。
- [x] 1.3 `main.py` 启动时执行一次清理并启动每小时后台清理线程；验证：隔离端口启动后日志出现清理记录，`/tmp` 中过期任务日志被删除。

## 2. 请求级链路日志

- [x] 2.1 `_submit` 接收可选 `request_id` 并写入 task state；Anthropic 面提交后写 `request.accepted`（request_id/task_id/model/stream/session_id/cwd/prompt_len/prompt_sha256/prompt_preview≤512）；验证：curl 一次 `/v1/messages`，日志字段齐全且不含完整 prompt，`/api/myflicker/result/{task_id}` 返回同一 request_id。
- [x] 2.2 非流式在返回前、流式在 SSE 结束后写 `request.finished`（status/duration_ms/http_status）；验证：非流式与 `stream:true` 各一次，日志出现 finished 且 http_status=200。

## 3. 工具事件跟踪

- [x] 3.1 实现 `ANTHROPIC_TRACE_EVENTS=1` 时以 `stream-json` 双工运行，`text` 事件按快照差分聚合为响应文本，其余事件写入 `logs/tasks/<task_id>.events.jsonl`；验证：用假 CLI 输出 text/tool_use/result 事件，非流式响应文本正确且 events 文件含三类事件。
- [x] 3.2 流式路径同样解析事件并保持六类 SSE 事件序列；验证：假 CLI 下 curl -N，事件序列完整、文本增量与快照一致。
- [x] 3.3 事件上限：`AGENT_TRACE_MAX_EVENTS`（5000）/`AGENT_TRACE_MAX_BYTES`（5MB），超限写 `trace.truncated` 并停止；验证：假 CLI 循环发 6000 事件，文件行数受限且任务仍成功。

## 4. 桌面日志与文档

- [x] 4.1 `desktop/electron/logs.cjs` 增加 20MB×5 轮转与 7 天启动清理，内存环形缓冲不变；验证：node 直接实例化 LogBus 指向 `/tmp`，以 1KB 上限压入数据后断言 `.1` 存在、超过 7 天的文件被删。
- [x] 4.2 `README_START.md` 增加"日志与保留"小节（配置项、默认值、如何按 request_id/task_id 排查、trace 开关）；验证：文档含可直接复制的 `.env` 配置片段。
- [x] 4.3 `openspec validate --all --strict` 通过；验证：命令退出码 0。

## 5. 端到端验收

- [x] 5.1 隔离环境跑一次 Claude Code 对话（trace 关），确认默认日志体积与响应正常、`request.accepted/finished` 成对出现；验证：日志条数与响应文本检查。
- [x] 5.2 隔离环境开启 trace 再跑一次，确认 `events.jsonl` 生成且响应不变；验证：文件存在 + 回复正常。
