## ADDED Requirements

### Requirement: Chat Session Resume

`/v1/chat/completions` SHALL 接受可选 `session_id`，并将其透传为 CLI 的 `--resume`。

#### Scenario: 透传续接

- **WHEN** 请求体带合法的 `session_id`
- **THEN** 启动命令包含 `--resume <session_id>`
- **AND** 只使用最后一条用户消息作为 prompt

#### Scenario: 不续接

- **WHEN** 请求体没有 `session_id`
- **THEN** 命令不包含 `--resume`
- **AND** 使用完整消息构造 prompt

#### Scenario: 非法 id

- **WHEN** `session_id` 非字符串、超长或包含非法字符
- **THEN** 返回 400 `invalid_session_id`
- **AND** 不创建任务

#### Scenario: 调用方自带 resume

- **WHEN** `myflicker_args` 已经包含 `--resume`
- **THEN** 网关不重复追加
