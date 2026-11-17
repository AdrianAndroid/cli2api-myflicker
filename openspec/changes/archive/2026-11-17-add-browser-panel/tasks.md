## 1. 主进程

- [x] 1.1 `WebContentsView` 单例：sandbox、无 Node、拒绝 `window.open`
- [x] 1.2 `browser:show/bounds/hide/navigate/back/forward/reload` IPC
- [x] 1.3 地址校验：仅 http(s)，缺协议补 `https://`
- [x] 1.4 窗口关闭销毁视图，切标签/收起时移到 0×0

## 2. 渲染层

- [x] 2.1 右栏「变更 / 浏览器」标签
- [x] 2.2 工具栏：后退、前进、刷新、地址栏、打开
- [x] 2.3 ResizeObserver + 窗口 resize 上报矩形
- [x] 2.4 加载中 / 错误提示，历史按钮禁用状态
- [x] 2.5 收起面板与关闭标签时隐藏视图

## 3. 验证

- [x] 3.1 无头运行确认视图创建并有非零矩形、占位页加载完成
- [x] 3.2 无头截图：浏览器标签、工具栏与 host 区域
- [x] 3.3 修复 `?tab=` 深链被首屏 effect 覆盖的问题
- [x] 3.4 `npm run typecheck` 与 `vite build` 通过
- [x] 3.5 `openspec validate --all --strict` 通过
