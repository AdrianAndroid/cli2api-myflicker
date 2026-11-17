# Spec Delta

## Purpose

用"连接档案"描述一个可用的 API 端点，使同一客户端能安全地在多个服务之间切换。

## ADDED Requirements

### Requirement: Multiple Profiles

客户端 SHALL 支持保存多个连接档案，并允许在运行时切换。

#### Scenario: 新增档案

- **WHEN** 用户填写名称、地址与 key 并保存
- **THEN** 档案被持久化，key 存入系统钥匙串
- **AND** 界面只显示掩码，不回显明文

#### Scenario: 切换到另一个服务

- **WHEN** 用户切换到另一档案
- **THEN** 工作区数据切换为该档案自己的项目与会话
- **AND** 原档案的数据不被修改

### Requirement: Connection Probe

保存或切换档案前 SHALL 通过 `/health` 与 `/v1/models` 校验可用性。

#### Scenario: 鉴权失败

- **WHEN** key 无效
- **THEN** 提示 401 且不保存为可用档案

#### Scenario: 服务不可达

- **WHEN** 地址超时或被拒绝
- **THEN** 提示网络错误并保留用户已填内容

### Requirement: Connection String

档案 SHALL 支持导出/导入连接串，便于把服务分享给他人。

#### Scenario: 粘贴连接串

- **WHEN** 用户粘贴 `myflicker://<payload>`
- **THEN** 名称、地址与 key 自动填入待保存表单
- **AND** 仍需用户点击「测试连接」与「保存」

#### Scenario: 无效连接串

- **WHEN** 连接串无法解析或缺少地址
- **THEN** 给出明确错误且不写入任何档案

### Requirement: Data Partitioning By Profile

项目、会话与消息 SHALL 按 `profileId` 分区存储。

#### Scenario: 同名项目

- **WHEN** 两个档案各自有一个名为 `demo` 的项目
- **THEN** 两个项目的会话互不可见
