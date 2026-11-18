# Design

## Context

现有 `openai_api.py` 已经实现：鉴权与身份解析（`_identity`，支持 `Authorization: Bearer` / `X-API-Key`）、prompt 构造（`build_prompt` / `_content_text`）、单次任务提交（`_submit` → 该 key 自己的 Celery 队列）、结果轮询（`_wait` / `load_task_state`）与两种 SSE 流（纯文本增量、`stream-json` 事件模式）。执行约束固定：每 key 一条串行通道，同目录串行、跨目录并行。规格见本 change 的 specs delta。

## Goals / Non-Goals

**Goals:**
- Claude Code 以 `ANTHROPIC_BASE_URL=http://127.0.0.1:8000` + `ANTHROPIC_AUTH_TOKEN=<key>` 直连可用（非流式、流式、count_tokens）。
- 复用既有管道：鉴权、身份/队列路由、超时、prompt 校验、事件流转发，全部不改语义。
- 认 `x-api-key` 头（Anthropic 客户端的默认鉴权头）。

**Non-Goals:**
- 不实现客户端 tool-use 回环：底层 myflicker 是自带工具执行的 agent，网关永远不返回 `tool_use` 内容块（见 specs）。
- 不做真实 token 计数（无 tokenizer 依赖），沿用 `len(text)//4` 估算。
- 不改 `/v1/chat/completions`、`/api/myflicker/*` 的任何行为，不动桌面端。

## Decisions

1. **`tools` 请求字段仅作兼容**。把 `tool_use`/`tool_result` 块线性化为文本并入 prompt（`tool_result` 取其文本内容，结构化结果 JSON 序列化）。理由：转换器模式下让 agent 自己执行工具是唯一的正确拓扑；备选方案（把工具转发给调用方执行）会引入多轮回环，与"一次请求 = 一次 myflicker 运行"的传输模型冲突。
2. **流式复用纯文本增量路径，不启用 `events_mode`**。Anthropic SSE 只需要 text_delta；事件模式是 OpenAI 面的私有扩展。理由：事件序列最简单、与 `content_block_delta` 一一对应；`task_id` 放进 `message_start` 的 `x_myflicker_task_id`，调试能力不损失。
3. **温度/`system` 等参数静态忽略 + `metadata.user_id` 记录**。`system` 文本并入 prompt 头部（`System: ...`）；理由与 OpenAI 面对 `temperature` 的处理一致，Claude Code 会发 `system`，直接丢弃会丢指令。
4. **模型字段回显**。`message.model` 返回请求里的 `model` 原值（Claude Code 会校验它发出的名字），`/v1/messages` 不做模型列表校验，任何名字都映射到唯一的 myflicker agent。
5. **`count_tokens` 不入队**，仅本地估算；实现为 `build_prompt`（Anthropic 变体）+ `_estimate_tokens`。
6. **新增文件 `anthropic_api.py`**（与 `openai_api.py` 平级、同样 `include_router` 到 `main.py`）。理由：避免 `openai_api.py` 超 600 行后继续膨胀；共享 helper 需要显式 import 而非复制。备选（塞进 `openai_api.py`）被否：两个协议面耦合后回归测试互相牵连。
7. **SSE helper 复用方式**：把 `_sse` 中与协议无关的"读 chunk → 提取文本增量 → 超时/keep-alive"逻辑抽成小函数，OpenAI 面改为调用它；Anthropic 面用它产出 `content_block_delta` 事件。`_sse` 的对外行为不变（属于内部重构，规格不感知）。

## Risks / Trade-offs

- [扩文本分块与 OpenAI 面共享同一 stdout 流，重构可能引入回归] → tasks 里包含对照验证：同一任务用两条协议面（(stream 与非 stream)各一次）跑通并比对 `x_myflicker` 字段。
- [Claude Code 版本演进会加请求字段（如新 `output_config`）] → 解析层只读已知字段、其余静默忽略，未知字段不报错，保证前向兼容。
- [`stop_reason` 语义粗糙（失败也归为 `end_turn` 之外没有更细的分类）] → 失败时文本内容携带 `[myflicker failed: ...]` 前缀（与 OpenAI 面一致），`stop_reason` 用 `"end_turn"`；后续如需 `refusal` 再改规格。
- [估算 token 数与真实消耗偏差] → 属既有限制，`usage` 字段标注估算即可，Claude Code 只用于展示。

## Migration Plan

纯增量上线，无数据迁移。回滚 = 摘掉新 router 一行。桌面端 .env 无需新增必填项；可选新增 `ANTHROPIC_MAX_PROMPT_CHARS`，缺省复用 OpenAI 面同名常量。

## Open Questions

（无）
