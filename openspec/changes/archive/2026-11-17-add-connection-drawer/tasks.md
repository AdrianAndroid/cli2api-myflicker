## 1. 实现

- [x] 1.1 右上角齿轮入口（所有角色可见，no-drag）
- [x] 1.2 `ConnectDrawer`：遮罩、右侧 440px、X / 遮罩 / Esc 关闭
- [x] 1.3 复用 `ConnectPage`，新增 `embedded` 变体
- [x] 1.4 抽屉内档案行换行，地址不与按钮抢宽度
- [x] 1.5 保存/切换成功后自动关闭
- [x] 1.6 保留左栏「连接」整页

## 2. 验证

- [x] 2.1 无头截图：抽屉在服务机页面展开
- [x] 2.2 `npm run typecheck` 与 `vite build` 通过
- [x] 2.3 `openspec validate --all --strict` 通过
