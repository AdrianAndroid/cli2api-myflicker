# Spec Delta

## Purpose

让工作区右栏可以内嵌一个真实的 Chromium 浏览器：与变更面板共用右栏，按矩形覆盖原生视图，支持基本导航且与页面隔离。

## ADDED Requirements

### Requirement: Panel Tabs

右栏 SHALL 提供「变更」与「浏览器」两个标签，同一时间只显示一个。

#### Scenario: 切换标签

- **WHEN** 用户点击「浏览器」
- **THEN** 显示浏览器工具栏与视图区域
- **AND** 变更列表与 diff 区域隐藏

#### Scenario: 回到变更

- **WHEN** 用户点击「变更」
- **THEN** 隐藏浏览器视图并恢复改动列表
- **AND** 不重新加载已打开的网页

### Requirement: Embedded Browser

浏览器视图 MUST 覆盖渲染层上报的矩形，并随面板尺寸变化调整。

#### Scenario: 首次展开

- **WHEN** 浏览器标签首次显示
- **THEN** 创建一个沙箱化视图并覆盖 host 区域
- **AND** 加载内置占位页（输入地址开始浏览）

#### Scenario: 跟随布局

- **WHEN** 窗口或面板尺寸变化
- **THEN** 通过 ResizeObserver 与窗口 resize 重新上报矩形
- **AND** 视图保持与 host 对齐

### Requirement: Browser Navigation

浏览器 SHALL 支持地址输入、后退、前进与刷新。

#### Scenario: 打开地址

- **WHEN** 用户在地址栏输入 `example.com` 并回车
- **THEN** 自动补全为 `https://example.com` 并加载

#### Scenario: 非法协议

- **WHEN** 用户输入 `file://` 或 `javascript:` 等地址
- **THEN** 拒绝加载并提示仅支持 http(s)

#### Scenario: 导航状态

- **WHEN** 页面开始加载、完成或失败
- **THEN** 工具栏显示加载中或错误信息
- **AND** 后退/前进按钮按历史可用性禁用

### Requirement: Isolation And Lifecycle

浏览器视图 MUST 与渲染层隔离，并在不需要时隐藏或释放。

#### Scenario: 安全边界

- **WHEN** 页面尝试 `window.open`
- **THEN** 请求被拒绝
- **AND** 页面运行在 sandbox 中且没有 Node 集成

#### Scenario: 隐藏与销毁

- **WHEN** 用户切到变更标签或收起面板
- **THEN** 视图被移动到 0×0 矩形
- **WHEN** 窗口关闭
- **THEN** 视图被销毁，不残留进程
