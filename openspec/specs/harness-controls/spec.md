# harness-controls Specification

## Purpose
让聊天界面通过公开的 /v1 接口查看 agent 的执行步骤与工具调用，并在切换页面或重启后保留对话记录。

## Requirements

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
