## ADDED Requirements

### Requirement: Overview And Bottom Navigation

控制台 SHALL 采用"总览首屏 + 底部 Tab"的信息架构，并在任意页面常驻显示服务状态。

#### Scenario: 打开即见全局状态

- **WHEN** 用户打开控制台且服务已就绪
- **THEN** 首屏显示队列深度、在线 worker 数与运行时长三项大号指标
- **AND** 显示当前最繁忙（或"暂无任务"）的任务摘要

#### Scenario: 底部导航

- **WHEN** 用户切换页面
- **THEN** 可通过底部 Tab 在总览、任务、聊天、日志、设置之间切换
- **AND** 当前页的 Tab 有明确的高亮状态

#### Scenario: 常驻服务条

- **WHEN** 用户在任意页面
- **THEN** 底部悬浮条显示服务状态、队列深度与 worker 数
- **AND** 用户可从该条直接启动或停止服务

### Requirement: Settings Absorbs LAN Controls

局域网访问控制 SHALL 位于设置页，不再作为独立入口。

#### Scenario: 从设置切换访问范围

- **WHEN** 用户在设置页切换"仅本机 / 局域网"
- **THEN** 控制台写入 `API_HOST` 并提示需要重启服务生效
- **AND** 地址列表、Key 轮换与安全策略仍在同一页可见
