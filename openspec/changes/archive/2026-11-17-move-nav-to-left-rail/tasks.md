## 1. 外壳

- [x] 1.1 `App.tsx` 改为「左栏 + 内容列」，保留标题与卡片滚动区
- [x] 1.2 移除底部 Tab 栏与悬浮服务条，启停入口留在「服务」页
- [x] 1.3 左栏顶部状态点、底部角色标识
- [x] 1.4 样式：`.dock/.tabbar` 替换为 `.rail/.rail-item`，兼容标题栏拖拽区

## 2. 兼容

- [x] 2.1 provider + local 显示六个入口，client 或 remote 只显示「工作区 / 连接」
- [x] 2.2 `?tab=` 深链仍可用，非法入口回落到当前角色首屏
- [x] 2.3 首启角色选择页不显示左栏

## 3. 验证

- [x] 3.1 无头截图：provider 首屏、client 已连接、离线只读
- [x] 3.2 `npm run typecheck` 与 `vite build` 通过
- [x] 3.3 `openspec validate --all --strict` 通过
