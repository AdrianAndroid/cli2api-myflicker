# Spec Delta

## Purpose

为每个 HTTP 请求提供稳定的标识，使错误响应、任务记录与日志可以被同一条线索串起来。

## ADDED Requirements

### Requirement: Request Identifier Assignment

网关 SHALL 为每个 `/api/*` 与 `/v1/*` 请求确定一个 `request_id`，并在响应头 `X-Request-Id` 中返回。

#### Scenario: 调用方未提供标识

- **WHEN** 请求没有 `X-Request-Id` 头
- **THEN** 网关生成一个不可猜测的标识
- **AND** 响应头 `X-Request-Id` 与该值一致

#### Scenario: 调用方自带标识

- **WHEN** 请求带有合法的 `X-Request-Id`（1-128 位可见 ASCII）
- **THEN** 网关沿用该值，响应头原样返回

#### Scenario: 非法标识

- **WHEN** 请求携带超长或含控制字符的 `X-Request-Id`
- **THEN** 网关忽略该值并自行生成
- **AND** 请求仍正常处理，不返回错误

### Requirement: Request Identifier In Task Records

提交任务时，`request_id` SHALL 写入任务状态与全链路日志，并出现在提交响应体中。

#### Scenario: 提交成功

- **WHEN** 调用方提交任务
- **THEN** 响应体包含 `request_id`
- **AND** 任务状态中可通过 `/api/myflicker/result/{task_id}` 取回同一个 `request_id`

#### Scenario: 提交被拒绝

- **WHEN** 提交因参数、配额或队列原因被 4xx 拒绝
- **THEN** 响应头仍带 `X-Request-Id`
- **AND** 该值出现在服务端日志中，便于按请求排查
