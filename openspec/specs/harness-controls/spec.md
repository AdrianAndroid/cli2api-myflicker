# harness-controls Specification

## Purpose
让每个 API key 拥有独立的 agent 执行策略（审批模式、工具白名单、MCP 注入），并把 myflicker 的会话与执行步骤暴露给调用方与聊天界面。

## Requirements

### Requirement: Per-Key Execution Policy

网关 SHALL 允许为每个 key 配置审批模式与工具开关，并在启动 myflicker 时注入对应参数。

#### Scenario: 只读用户

- **WHEN** alice 的档案配置为 `plan` 且禁用写工具
- **THEN** 该 key 的任务以 `--approval-mode plan --tools '{"write":false}'` 执行
- **AND** 其他 key 的执行参数不受影响

#### Scenario: 禁止提权

- **WHEN** LAN 调用方在请求中试图指定 `yolo` 审批模式
- **THEN** 网关拒绝该参数并回落到该 key 的配置值

### Requirement: Session Continuity

网关 SHALL 从一次运行中获取 myflicker 的 session id，并在后续请求提供该 id 时以 `-r <id>` 恢复同一会话。

#### Scenario: 首次运行返回会话标识

- **WHEN** alice 提交一个不带 session 的任务
- **THEN** 任务状态中包含解析到的 `session_id`
- **AND** 响应里可以看到该标识

#### Scenario: 显式恢复

- **WHEN** 调用方在提交时带上 `session_id`
- **THEN** 网关以 `-r <session_id>` 执行该任务
- **AND** 该会话只可能属于调用方自己的工作区

### Requirement: Execution Step Visibility

聊天界面 SHALL 把一次运行渲染为可读的步骤序列，而不是单一文本块。

#### Scenario: 步骤渲染

- **WHEN** 一次运行产生多段输出与工具调用行
- **THEN** 界面按时间顺序展示为多个步骤块
- **AND** 失败步骤有明确标记

#### Scenario: 长任务不打断阅读

- **WHEN** 输出持续增长
- **THEN** 界面自动滚动到底部，且用户上滚后不强制跳回

### Requirement: Console As API Client

桌面控制台在执行任何任务相关操作时 SHALL 通过 HTTP API 完成，MUST NOT 直接调用后端函数或复用进程内状态。

#### Scenario: 聊天走公开接口

- **WHEN** 用户在聊天页发送一条消息
- **THEN** 控制台以 `POST /v1/chat/completions` 发起请求，并携带与其他客户端相同的 API key

#### Scenario: 任务管理走任务接口

- **WHEN** 用户查看任务列表、结果或取消任务
- **THEN** 控制台分别调用 `/api/myflicker/tasks`、`/api/myflicker/result/{id}`、`/api/myflicker/tasks/{id}/cancel`

#### Scenario: 密钥不进入渲染层

- **WHEN** 渲染层需要发起请求
- **THEN** 请求由主进程代理发出，渲染层拿不到明文 key

#### Scenario: 本机管理操作保持本地

- **WHEN** 用户启动、停止或重启服务，或修改 `.env`
- **THEN** 这些操作只发生在主进程与本机进程之间，不通过公开 HTTP 暴露

### Requirement: Chat Transcript Persistence

聊天记录 SHALL 在切换页面与重启应用后仍然可见。

#### Scenario: 切换 Tab 不丢内容

- **WHEN** 用户从聊天页切到其他 Tab 再切回
- **THEN** 之前的对话与工具步骤完整保留
- **AND** 正在流式输出的回答继续正常显示

#### Scenario: 重启后恢复

- **WHEN** 用户关闭并重新打开控制台
- **THEN** 最近一段对话被恢复
- **AND** 中断的流式消息标记为已停止，而不是永远显示"执行中"

#### Scenario: 清空

- **WHEN** 用户点击清空
- **THEN** 界面与本地存储中的记录一并清除
