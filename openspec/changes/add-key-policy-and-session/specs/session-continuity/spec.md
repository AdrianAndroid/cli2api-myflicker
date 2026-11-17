# Spec Delta

## Purpose

把 myflicker 的会话标识暴露给调用方，使多轮对话可以精确恢复到指定分支，而不是只能续"最近一次"。

## ADDED Requirements

### Requirement: Session Identifier Exposure And Resume

网关 SHALL 在任务状态与接口响应中返回 `session_id`，并在调用方提供该标识时以 `-r <id>` 恢复会话。

#### Scenario: 首次运行返回标识

- **WHEN** alice 提交一个不带 `session_id` 的任务
- **THEN** 任务的终态记录包含解析到的 `session_id`
- **AND** `/v1` 响应里能看到同一个标识

#### Scenario: 显式恢复

- **WHEN** 调用方在提交时带上 `session_id`
- **THEN** 网关以 `-r <session_id>` 执行
- **AND** 该会话必须属于调用方自己的工作区，否则拒绝
