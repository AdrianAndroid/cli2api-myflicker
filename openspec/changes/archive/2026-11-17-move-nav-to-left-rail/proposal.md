## Why

已确定的导航方向是「左侧图标栏 + 右侧内容」，但当前实现的 `desktop-console` 规格仍写的是「总览首屏 + 底部 Tab」，代码也还是底部 Tab 加悬浮服务条：

- 底部 Tab 占用垂直空间，聊天输入区被压缩；
- 悬浮服务条只在服务机有意义，使用机看到它是噪音；
- 角色/档案已经能决定哪些模块可见，但横向 Tab 无法体现这种层级。

## What Changes

- 外壳从「纵向：标题 / 卡片 / 底部 dock」改为「横向：76px 左侧图标栏 + 右侧内容列」；
- 移除底部 Tab 栏与悬浮服务条；
- 服务启停回到「服务」页卡片（原本就有启动/停止/重启按钮）；
- 左栏顶部显示一个运行状态点（服务机）或连接状态点（使用机），底部显示当前角色；
- 图标可见性继续由角色与档案类型决定（client 或 remote 档案只显示「工作区 / 连接」）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-console`：信息架构由底部 Tab 改为左侧图标栏，并取消常驻底部服务条。

## Impact

- 代码：`desktop/src/App.tsx`（外壳结构）、`desktop/src/styles.css`（`.dock/.tabbar` 替换为 `.rail`）；
- 行为：导航入口位置变化；服务启停、队列与 worker 展示仍可用；
- 规格：`overview and bottom navigation` 需求整体替换。

## Out of Scope

- 会话列表 / 右侧面板等 Codex 双栏布局；
- 看板改为按 key 排行（另立变更）；
- 窗口尺寸与打包配置。
