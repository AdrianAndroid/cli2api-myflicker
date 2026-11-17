# Spec Delta

## Purpose

把工作区从单一时间线升级为可并行管理多个会话的 Codex 式界面：左侧会话列表、中间活动流，会话按连接档案隔离。

## ADDED Requirements

### Requirement: Session Threads

工作区 SHALL 支持多个本地会话线程，并允许新建、切换、重命名与删除。

#### Scenario: 新建会话

- **WHEN** 用户点击「新建」
- **THEN** 创建一个空会话并设为当前会话
- **AND** 输入区指向新会话，历史消息不串入

#### Scenario: 自动标题

- **WHEN** 用户在某会话里发出第一条消息
- **THEN** 会话标题取该消息前 24 个字符
- **AND** 用户重命名后不再被自动标题覆盖

#### Scenario: 重命名与删除

- **WHEN** 用户双击会话标题
- **THEN** 标题变为可编辑，回车保存、Esc 取消
- **WHEN** 用户删除当前会话
- **THEN** 自动切换到下一条会话
- **AND** 删除最后一条时自动创建一个空会话

### Requirement: Session List Grouping

会话列表 SHALL 按最近更新时间分组，并显示当前会话与基本元信息。

#### Scenario: 时间分组

- **WHEN** 工作区渲染会话列表
- **THEN** 会话按「今天 / 昨天 / 更早」分组
- **AND** 每条显示相对时间与消息步数

#### Scenario: 当前会话高亮

- **WHEN** 用户点击某条会话
- **THEN** 该条以高亮样式显示为当前会话
- **AND** 中间活动流切换为该会话的消息

### Requirement: Profile Scoped Storage

会话数据 MUST 按 `profileId` 分区存储，切换连接档案时不得互相可见。

#### Scenario: 切换档案

- **WHEN** 用户从档案 A 切换到档案 B
- **THEN** 会话列表只显示档案 B 的会话
- **AND** 切回档案 A 时原会话完整恢复

#### Scenario: 旧记录迁移

- **WHEN** 首次加载某个档案且没有会话数据
- **THEN** 读取该档案旧的单条聊天记录并迁移为一条「历史对话」
- **AND** 迁移后旧键不再写入

### Requirement: Workspace Layout And Activity Stream

工作区 SHALL 采用「240px 会话列表 + 自适应活动流」两栏布局，活动流保留气泡、工具卡片与流式状态。

#### Scenario: 两栏填满可用高度

- **WHEN** 用户打开工作区
- **THEN** 会话列表与活动流各自滚动
- **AND** 整体占满标题栏以下的可用高度，不产生页面级滚动

#### Scenario: 执行与停止

- **WHEN** agent 正在执行
- **THEN** 气泡显示「执行中」状态，并提供停止按钮
- **WHEN** 事件里出现会话标识
- **THEN** 工作区把该标识记录到当前会话

#### Scenario: 离线只读

- **WHEN** 当前档案不可达
- **THEN** 会话列表与历史消息仍可浏览
- **AND** 输入与发送被禁用，并说明原因
