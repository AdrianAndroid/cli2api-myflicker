# workspace-resume Specification

## Purpose
让工作区线程真正续接同一个 agent 会话：已知 session_id 时只发送新问题，并允许用户随时断开续接回到完整历史模式。

## Requirements

### Requirement: Resume By Session Id

当会话已记录 `sessionId` 时，工作区 SHALL 携带该 id 发送请求，并只提交新一轮用户输入。

#### Scenario: 续接发送

- **WHEN** 当前会话有 `sessionId` 且用户发送消息
- **THEN** 请求体包含 `session_id`
- **AND** `messages` 只包含这一条新用户消息

#### Scenario: 首次发送

- **WHEN** 当前会话还没有 `sessionId`
- **THEN** 请求体不包含 `session_id`
- **AND** `messages` 包含完整历史

#### Scenario: 记录 id

- **WHEN** agent 事件里出现新的会话标识
- **THEN** 当前会话更新 `sessionId`

### Requirement: Resume Indicator

标题栏 SHALL 显示续接状态，并允许断开。

#### Scenario: 显示标签

- **WHEN** 当前会话有 `sessionId`
- **THEN** 标题栏出现「续接 <短 id>」标签

#### Scenario: 断开续接

- **WHEN** 用户点击该标签
- **THEN** 清除会话的 `sessionId`
- **AND** 下一条消息恢复携带完整历史

### Requirement: Resume Failures

续接失败 MUST 显示在对话里，不得静默改为新会话。

#### Scenario: 会话失效

- **WHEN** 服务端因会话 id 无效返回错误
- **THEN** 该回复气泡显示错误信息
- **AND** 用户可断开续接后重发
