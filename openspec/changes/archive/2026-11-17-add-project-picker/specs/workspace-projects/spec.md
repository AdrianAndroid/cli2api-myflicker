# Spec Delta

## Purpose

让工作区里的每个会话可以绑定自己的工作目录（项目），并通过服务端沙箱校验保证只能访问自己的工作区。

## ADDED Requirements

### Requirement: Session Project Directory

会话 SHALL 可以绑定一个 `cwd`，并在发送对话时随请求提交。

#### Scenario: 会话绑定目录

- **WHEN** 用户在项目选择器里确认一个目录
- **THEN** 当前会话记录该 `cwd`
- **AND** 标题栏以目录名显示当前项目

#### Scenario: 新会话继承

- **WHEN** 用户在有项目的会话里点「新建」
- **THEN** 新会话继承相同的 `cwd`

#### Scenario: 发送携带 cwd

- **WHEN** 会话有 `cwd` 且用户发送消息
- **THEN** `/v1/chat/completions` 请求体包含该 `cwd`
- **AND** 未选择时省略，由服务端使用默认目录

#### Scenario: 越界被拒绝

- **WHEN** 服务端因 cwd 越界返回 403
- **THEN** 错误信息显示在该条回复里
- **AND** 不静默改回默认目录

### Requirement: Project Picker

工作区 SHALL 提供目录选择器，可在工作区内逐级浏览并选择。

#### Scenario: 打开与浏览

- **WHEN** 用户点击标题栏的项目胶囊
- **THEN** 弹出目录选择器并显示当前绝对路径
- **AND** 列出当前目录的子目录，隐藏点目录

#### Scenario: 上级与回到根

- **WHEN** 当前目录不是工作区根
- **THEN** 「上级」可用，点击后进入父目录
- **AND** 「回到工作区根」跳回根目录

#### Scenario: 不支持的旧服务

- **WHEN** 服务端没有目录浏览接口
- **THEN** 选择器显示该服务不支持目录浏览
- **AND** 用户仍可关闭弹窗继续使用工作区
