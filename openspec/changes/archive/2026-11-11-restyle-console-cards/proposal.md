## Why

现在控制台是"深色 IDE 风格 + 左侧竖排导航"：信息密度高但首屏看不到全局，
服务状态散落在顶栏三个小圆点里，用户要先点进「任务」才知道队列有没有堆积。
参考 ClashBoard 这类工具的信息架构更适合本项目：**一屏总览 + 卡片分组 + 底部 Tab**。

## What Changes

### 1. 信息架构

- 顶部：大标题 + 一行状态副标题（身份 · 状态）
- 首屏「总览」：服务状态卡（队列 / worker / 运行时长）、最繁忙任务、端口与身份卡片
- 底部 Tab：总览 / 任务 / 聊天 / 日志 / 设置；「局域网」并入设置页
- 底部悬浮条常驻显示服务状态，点击可直接启停

### 2. 视觉

- 浅色主题：浅灰背景 + 白色圆角卡片 + 蓝色主色
- 关键指标用大号数字（40px 级别），标签用次要灰
- 表格改为卡片内列表行，分隔线替代边框

## Capabilities

### New Capabilities

- 无（属于既有 `desktop-console` 的界面契约变化）

### Modified Capabilities

- `desktop-console`：新增"总览页与底部导航"的需求，原进程编排/密钥/无头测试等需求不变。

## Impact

- 代码：`desktop/src/App.tsx`、`desktop/src/styles.css`、新增 `OverviewPage.tsx`、`SettingsPage.tsx`（内嵌局域网卡片）。
- 兼容性：所有 `window.api` 契约不变，功能不减（局域网能力保留在设置页）。

## Out of Scope

- 移动端/响应式适配（仍是桌面窗口，只是采用移动端信息架构）
- 新增后端接口
