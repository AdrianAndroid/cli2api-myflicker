## 1. 后端

- [x] 1.1 只读 git 辅助：`rev-parse` / `status --porcelain -z` / `diff HEAD`
- [x] 1.2 `GET /api/myflicker/changes`：仓库根、cwd、文件列表（上限 500）
- [x] 1.3 `GET /api/myflicker/changes/diff`：单文件 diff、200KB 截断、未跟踪标记
- [x] 1.4 沙箱：仓库根越界 403，文件路径禁止绝对路径与 `..`

## 2. 桌面端

- [x] 2.1 `api-client` + IPC + preload + 类型
- [x] 2.2 `RightPanel`：文件列表、状态徽标、自动选中首个文件
- [x] 2.3 diff 渲染：新增绿、删除红、hunk 着色
- [x] 2.4 对话标题栏「变更 / 收起」按钮，面板展开时工作区加宽
- [x] 2.5 非 git / 无改动 / 接口不可用三种状态提示

## 3. 验证

- [x] 3.1 临时仓库验证：列表 200、diff 200、未跟踪、非法路径 400、非 git、无 Key 401
- [x] 3.2 无头截图：变更列表与 diff 右栏
- [x] 3.3 `npm run typecheck` 与 `vite build` 通过
- [x] 3.4 `openspec validate --all --strict` 通过
