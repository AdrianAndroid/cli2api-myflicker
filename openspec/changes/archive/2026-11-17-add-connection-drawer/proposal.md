## Why

连接与档案现在只在左栏「连接」整页里。Codex 式工作区希望不离开对话就能切档案、改地址或重新探活。

## What Changes

- 页面右上角新增齿轮入口，任意角色可见；
- 点击从右侧滑出 440px 抽屉，内容复用连接页（用途切换、档案列表、连接串、探活、新增连接）；
- 抽屉内档案行改为换行布局，避免 440px 下地址被截断；
- X、点击遮罩、Esc 均可关闭；保存或切换成功后自动关闭；
- 左栏「连接」整页保留为兜底入口。

## Capabilities

### New Capabilities

- `connection-drawer`：抽屉入口、布局、内容复用与关闭规则。

### Modified Capabilities

无。

## Impact

- 代码：`desktop/src/{App.tsx,styles.css,views/ConnectDrawer.tsx,views/ConnectPage.tsx}`；
- 兼容：整页连接页行为不变；
- 无障碍：Escape 关闭，按钮带 aria-label。

## Out of Scope

- 抽屉内的任务/日志；
- 多抽屉叠加；
- 拖拽调整宽度。
