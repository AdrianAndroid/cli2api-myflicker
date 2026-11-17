# Spec Delta

## Purpose

让每个 API key 拥有独立的 agent 执行策略（审批模式、工具白名单、MCP 注入），避免共享实例时权限失控。

## ADDED Requirements

### Requirement: Per-Key Execution Policy

网关 SHALL 允许为每个 key 配置审批模式与工具开关，并在启动 myflicker 时注入对应参数。

#### Scenario: 只读用户

- **WHEN** alice 的档案为 `plan` 且禁用写工具
- **THEN** 该 key 的任务以 `--approval-mode plan --tools '{"write":false}'` 执行
- **AND** 其他 key 的执行参数不受影响

#### Scenario: 禁止提权

- **WHEN** LAN 调用方在请求里试图指定 `yolo` 审批模式
- **THEN** 网关忽略该值并回落到该 key 的配置
- **AND** 响应中可看到实际生效的审批模式
