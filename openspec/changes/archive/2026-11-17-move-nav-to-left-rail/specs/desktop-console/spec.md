## REMOVED Requirements

### Requirement: Overview And Bottom Navigation

**Reason**: 导航改为左侧图标栏，底部 Tab 与悬浮服务条取消。

**Migration**: 用左栏图标切换页面；服务启停改到「服务」页卡片内完成。

## ADDED Requirements

### Requirement: Overview And Left Rail Navigation

控制台 SHALL 采用"总览首屏 + 左侧图标栏"的信息架构，把全局状态常驻在左栏顶部。

#### Scenario: 打开即见全局状态

- **WHEN** 用户打开控制台且服务已就绪
- **THEN** 首屏显示队列深度、在线 worker 数与运行时长三项大号指标
- **AND** 显示当前最繁忙（或"暂无任务"）的任务摘要

#### Scenario: 左侧导航

- **WHEN** 用户切换页面
- **THEN** 可通过左侧图标栏在服务、任务、工作区、日志、连接、设置之间切换
- **AND** 当前页的图标有明确的高亮状态

#### Scenario: 状态常驻左栏

- **WHEN** 用户处于任意页面
- **THEN** 左栏顶部显示服务运行状态点（使用机或远端档案显示连接状态点）
- **AND** 队列深度与 worker 数在服务页可见
- **AND** 界面不再出现底部 Tab 栏或悬浮服务条

#### Scenario: 服务启停入口

- **WHEN** 用户需要启动、重启或停止服务
- **THEN** 在「服务」页卡片内完成操作
- **AND** 不依赖任何常驻悬浮控件
