# Spec Delta

## Purpose

允许运维按需把 agent 的工具调用与结果结构化落盘，用于回放"这次工作到底做了什么"，同时保持对客户端响应协议不变、默认不引入额外开销。

## ADDED Requirements

### Requirement: Optional Agent Event Trace

当 `ANTHROPIC_TRACE_EVENTS=1` 时，`/v1/messages` 任务 SHALL 以 `stream-json` 运行，并把 `tool_use` / `tool_result` / `text` / `result` 事件写入 `logs/tasks/<task_id>.events.jsonl`；默认关闭。无论开关状态，响应形状 MUST 保持不变（`content` 仅 text 块）。

#### Scenario: 默认关闭

- **WHEN** 未设置 `ANTHROPIC_TRACE_EVENTS`
- **THEN** 任务按纯文本模式运行
- **AND** 不生成 `.events.jsonl`

#### Scenario: 开启跟踪

- **WHEN** `ANTHROPIC_TRACE_EVENTS=1`
- **THEN** 任务使用 `--input-format stream-json --output-format stream-json --stream-text`
- **AND** 每个结构化事件追加到 `.events.jsonl`
- **AND** 客户端仍收到相同的 Anthropic `message` / SSE 文本增量

#### Scenario: 事件量上限

- **WHEN** 单任务事件数量或字节数超过 `AGENT_TRACE_MAX_EVENTS` / `AGENT_TRACE_MAX_BYTES`
- **THEN** 停止继续落盘并写入一条截断标记事件
- **AND** 任务本身继续执行，响应不受影响
