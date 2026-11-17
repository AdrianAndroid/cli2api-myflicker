## 1. 后端

- [x] 1.1 `GET /api/myflicker/workspaces`：列出目录、`?path=` 浏览、点目录过滤、上限 200
- [x] 1.2 复用 `resolve_cwd` 沙箱：越界 403，未认证 401
- [x] 1.3 路径归一化（`.resolve()`），保证 workspace/cwd/parent 一致

## 2. 桌面端

- [x] 2.1 `api-client.workspaces()` + `workspaces:list` IPC + preload + 类型
- [x] 2.2 项目选择器弹窗：路径、上级、回到根、刷新、子目录、选用
- [x] 2.3 会话新增 `cwd`，新建会话继承当前目录
- [x] 2.4 发送时把 `cwd` 放进 `/v1/chat/completions`
- [x] 2.5 标题栏项目胶囊 + 会话列表显示项目名
- [x] 2.6 旧服务不支持接口时给出提示，不影响对话

## 3. 验证

- [x] 3.1 隔离网关上验证目录接口：根 200、子目录 200、越界 403、无 Key 401
- [x] 3.2 无头截图：项目胶囊、选择器弹窗、离线只读
- [x] 3.3 `npm run typecheck` 与 `vite build` 通过
- [x] 3.4 `openspec validate --all --strict` 通过
