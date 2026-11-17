## ADDED Requirements

### Requirement: Per-Key Usage Recording

网关 SHALL 在每次任务进入终态时，为该任务的 `owner` 记录一条用量；失败与超时任务同样计入。

#### Scenario: 成功任务计入用量

- **WHEN** alice 的一个任务以 `success` 结束
- **THEN** alice 当日的请求数加 1
- **AND** 记录包含 `task_id`、`duration_ms`、`chars_out`、`estimated_tokens`

#### Scenario: 失败任务同样计入

- **WHEN** 任务以 `failure` 或 `timed_out` 结束
- **THEN** 请求数仍然加 1，并记录 `status`

### Requirement: Quota Windows

网关 SHALL 支持按 `KEY_LIMITS=label:N/day|week` 配置限额；未配置的 label 不受限。

#### Scenario: 日窗口

- **WHEN** `KEY_LIMITS=alice:50/day` 且 alice 当日已用 50 次
- **THEN** 下一次提交返回 429，`error.code="quota_exceeded"`
- **AND** 响应包含 `window="day"`、`used`、`limit`、`reset_at`

#### Scenario: 未配置限额

- **WHEN** bob 没有任何 `KEY_LIMITS` 条目
- **THEN** bob 的提交不受配额影响（仍受限流与队列上限约束）

#### Scenario: 窗口重置

- **WHEN** 进入新的一天（或新的一周）
- **THEN** 该窗口计数从 0 重新开始

### Requirement: Usage Visibility

`GET /api/myflicker/usage` SHALL 返回调用方自己的用量；带 admin key 时 MUST 支持查询任意 label。

#### Scenario: 普通身份查询

- **WHEN** alice 请求 `/api/myflicker/usage?window=day`
- **THEN** 只返回 alice 的计数与最近明细
- **AND** 响应中不含其他 label 的数据

#### Scenario: admin 查询

- **WHEN** admin key 请求 `/api/myflicker/usage?label=bob&window=week`
- **THEN** 返回 bob 的周用量与明细

### Requirement: Quota Is Independent Of Lanes

配额校验 MUST NOT 阻塞其他身份的执行通道；超限拒绝只作用于该 label。

#### Scenario: 一个用户超限

- **WHEN** alice 达到限额
- **THEN** alice 的新任务被拒绝
- **AND** bob 的提交与执行完全不受影响
