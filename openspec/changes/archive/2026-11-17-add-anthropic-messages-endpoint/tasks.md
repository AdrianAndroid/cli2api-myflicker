# Tasks

## 1. 共享管道抽取（内部重构，不改行为）

- [x] 1.1 从 `openai_api.py` 抽出与协议无关的流读取逻辑（chunk 读取、text 增量提取、超时/keep-alive）为可复用的异步生成器 helper；验证：`/v1/chat/completions` 非流式与 stream:true 各跑一次，响应结构与 `x_myflicker` 字段与重构前一致（curl 对照）。
- [x] 1.2 运行 `uvicorn main:app`（隔离端口 8010）后用 OpenAI 面回归用例确认无回归；验证：`curl -s http://127.0.0.1:8010/v1/models -H "X-API-Key: <key>"` 返回单条目 list。

## 2. Anthropic 协议层

- [x] 2.1 新建 `anthropic_api.py`，实现 `_identity` 复用（含 `x-api-key` 头）与 Anthropic 错误包装 `{"type":"error","error":{type,message}}`；验证：无 key 请求 `POST /v1/messages` 返回 401/authentication_error JSON。
- [x] 2.2 实现 Anthropic messages → prompt 转换（含 `system`、`tool_use`/`tool_result` 线性化、`session_id` 只取最后一轮）；验证：单元级调用转换函数，给定多轮消息（含 tool_result 块）输出包含全部文本与序列化 JSON。
- [x] 2.3 实现 `POST /v1/messages` 非流式返回（`type:"message"`、`content` 单 text 块、`stop_reason`、`usage` 估算、`x_myflicker` debug 字段、model 回显）；验证：curl 非流式请求，响应结构通过 `jq '.type=="message" and .content[0].type=="text" and .x_myflicker.task_id'`。
- [x] 2.4 实现 `stream:true` 的 Anthropic SSE（`message_start` → `content_block_start` → `content_block_delta` … → `message_stop`，含 keep-alive 注释与超时处理）；验证：curl -N 流式请求，事件序列可用 `grep "^event:"` 按序匹配六类事件。
- [x] 2.5 实现 `POST /v1/messages/count_tokens`（本地估算，不入队）；验证：curl 请求返回 `{"input_tokens": N}` 且 Redis 队列深度不变。

## 3. 挂载与配置

- [x] 3.1 在 `main.py` include 新 router，`myflicker_args`/`cwd`/`env`/`session_id` 透传语义与 OpenAI 面一致；验证：启动后 `curl -s http://127.0.0.1:8010/openapi.json | grep messages` 能看到两个新端点且旧端点无变化。
- [x] 3.2 `README_START.md` 增加 Claude Code 接入小节（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 设置示例与限制说明：无 tool-use 回环、token 为估算值）；验证：文档段落含可复制粘贴的 export 命令。

## 4. Claude 协议测试客户端

- [x] 4.1 `test_client.py` 新增 `messages` 子命令：POST `/v1/messages`，支持 `--prompt`、`--session-id`、`--stream`、`--show-protocol`；在输出区适当位置（与 `run` 子命令的请求参数区对齐）打印实际发送的 Anthropic 协议请求 JSON，非流式时打印响应 JSON、流式时打印 SSE 事件序列（`event:` 行 + data 简摘）；验证：隔离端口 8010 下 `python test_client.py messages --prompt "ping"` 退出码 0，且输出含 `"type": "message"` 或 `message_start`。

## 5. 端到端验收

- [x] 5.1 全链路冒烟：隔离端口与数据目录（`MYFLICKER_DESKTOP_DATA_DIR=/tmp/mf-ant-test`）下，Claude Code 指向网关完成一次对话（非流式+流式各一次）；验证：Claude Code 收到完整回复，`/api/myflicker/tasks` 可见对应任务且 source 可辨识。
- [x] 5.2 并发与隔离抽查：两个不同 key 同时请求 `/v1/messages`，任务落在各自队列且同 key 的第二个请求排队串行；验证：`/api/myflicker/health` 与任务列表显示两条队列各一任务，无交叉。
- [x] 5.3 清理测试产生的 /tmp 目录与进程，`pgrep -fl "uvicorn main:app|celery -A celery_tasks"` 中自有进程为 0；验证：命令输出为空。
- [x] 5.4 `openspec validate --all --strict` 通过；验证：命令退出码 0。
