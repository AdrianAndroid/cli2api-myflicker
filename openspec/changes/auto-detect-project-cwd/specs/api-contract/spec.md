# Spec Delta

## ADDED Requirements

### Requirement: Project Working Directory Resolution

`POST /v1/messages` SHALL 按固定优先级确定任务 cwd：请求体 `cwd` → 请求头 `X-Myflicker-Cwd` → system prompt / messages 中 `Primary working directory:` 或 `Working directory:` 指向的绝对路径 → 该 API key 的 workspace。自动识别到的路径 MUST 是已存在的目录；不满足时忽略并继续回退。

#### Scenario: 从 system prompt 识别项目目录

- **WHEN** 请求体与请求头都没有 cwd，且 system prompt 包含 `Primary working directory: /Users/me/project`（目录存在）
- **THEN** 任务在该目录执行
- **AND** `request.accepted` 的 `cwd_source` 为 `prompt`

#### Scenario: 请求头覆盖

- **WHEN** 请求携带 `X-Myflicker-Cwd: /Users/me/other`（目录存在）
- **THEN** 请求头优先于 system prompt
- **AND** `cwd_source` 为 `header`

#### Scenario: 识别失败回退

- **WHEN** 未携带 cwd 且 prompt 中路径不存在、是相对路径或不是目录
- **THEN** 使用该 key 的 workspace
- **AND** `cwd_source` 为 `workspace`

#### Scenario: 非回环客户端的沙箱回退

- **WHEN** 自动识别的目录超出该 key 的 workspace 且沙箱对该客户端生效
- **THEN** 回退到 workspace，不返回错误
- **AND** 日志中 `cwd_source` 仍标记为 `prompt` 且任务 cwd 为 workspace
