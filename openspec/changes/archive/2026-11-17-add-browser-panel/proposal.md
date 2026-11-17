## Why

变更面板已经占住右栏，但 agent 常需要看文档、预览页面，现在只能切出去用外部浏览器。

把浏览器嵌进右栏，就能在对话旁边查资料，也为后续「把页面内容发给 agent」打基础。

## What Changes

- 右栏增加「变更 / 浏览器」两个标签；
- 浏览器使用 Electron `WebContentsView` 原生视图，渲染层只上报要覆盖的矩形；
- 工具栏：后退、前进、刷新、地址栏、打开；
- 地址只接受 http(s)，缺协议自动补 `https://`；
- 新窗口请求一律拒绝，视图沙箱开启、无 Node；
- 切到变更标签、收起面板或关闭窗口时隐藏 / 销毁视图，避免遮挡与泄漏；
- 无地址时加载内置占位页（data URL），提示"输入地址开始浏览"。

## Capabilities

### New Capabilities

- `workspace-browser`：右栏标签、内嵌视图定位、导航、隔离与生命周期。

### Modified Capabilities

无。

## Impact

- 代码：`desktop/electron/{main,preload}.cjs`、`desktop/src/{types.ts,views/RightPanel.tsx,styles.css}`；
- 资源：每个窗口最多一个浏览器视图，关闭窗口时释放；
- 安全：仅 http(s)、拒绝 `window.open`、沙箱化、无 Node 集成；
- 兼容：面板默认仍显示「变更」，浏览器标签按需打开。

## Out of Scope

- 把网页内容抽取后发给 agent（下一阶段接 chrome-devtools-mcp）；
- 多标签页、书签、历史记录；
- 下载、文件上传、开发者工具；
- 代理与证书设置。
