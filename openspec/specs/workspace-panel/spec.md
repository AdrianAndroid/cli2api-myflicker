# workspace-panel Specification

## Purpose
给工作区增加只读的变更面板：按 git 状态列出 agent 改过的文件，并展示单文件统一 diff，便于不离开客户端检查改动。

## Requirements

### Requirement: Right Panel Layout

工作区 SHALL 提供可收起的 360px 右栏，并在展开时加宽整体内容区。

#### Scenario: 展开与收起

- **WHEN** 用户点击对话标题栏的「变更」
- **THEN** 右侧展开变更面板，按钮变为「收起」
- **AND** 再次点击或点面板关闭按钮可收起

#### Scenario: 独立滚动

- **WHEN** 面板展开且内容超出高度
- **THEN** 文件列表与 diff 区域各自滚动
- **AND** 对话与输入区不被挤压到不可用

### Requirement: Change List

面板 SHALL 列出当前项目未提交的改动，并显示状态。

#### Scenario: 列出改动

- **WHEN** 面板打开且项目是 git 仓库
- **THEN** 按 git 状态列出文件，显示 M/A/D/?? 等徽标
- **AND** 默认选中第一个文件

#### Scenario: 没有改动

- **WHEN** 工作区干净
- **THEN** 显示「没有未提交的变更」

#### Scenario: 非 git 目录

- **WHEN** 当前项目不是 git 仓库
- **THEN** 显示提示且不请求 diff

#### Scenario: 刷新

- **WHEN** 用户点击「刷新」
- **THEN** 重新拉取文件列表并保持可用状态

### Requirement: Diff View

面板 SHALL 展示所选文件的统一 diff，并区分新增、删除与 hunk。

#### Scenario: 查看 diff

- **WHEN** 用户选择一个改动的文件
- **THEN** 展示统一 diff
- **AND** 新增行绿色、删除行红色、hunk 头着色

#### Scenario: 未跟踪文件

- **WHEN** 所选文件是未跟踪状态
- **THEN** 提示「新增文件，未跟踪」，不展示文件内容

#### Scenario: 接口不可用

- **WHEN** 服务端不支持变更接口或返回错误
- **THEN** 面板显示错误原因
- **AND** 对话功能不受影响
