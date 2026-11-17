## Why

工作区已经能选项目、跑多会话，但 agent 改了哪些文件不可见，只能切到外部终端 `git diff`。

Codex 式布局的最后一块是右侧面板。先做「变更」：只读列出工作区改动，并对单个文件展示统一 diff。

## What Changes

- 网关新增两个只读接口：
  - `GET /api/myflicker/changes?path=` → git 根、cwd 与改动文件列表；
  - `GET /api/myflicker/changes/diff?path=&file=` → 单文件统一 diff。
  两者都复用 `resolve_cwd` 沙箱，仓库根越界返回 403，文件路径禁止绝对路径与 `..`；
- 工作区新增 360px 右栏：文件列表（状态徽标）+ diff 视图，可刷新、可收起；
- 打开面板时工作区自动加宽，避免对话列被挤压；
- 非 git 目录、旧服务端、无改动三种状态都有明确提示；
- 未跟踪文件只显示状态，不展示内容。

## Capabilities

### New Capabilities

- `workspace-panel`：右栏布局、变更列表、diff 视图与空/错误状态。

### Modified Capabilities

无（`api-contract` 以新增需求扩展）。

## Impact

- 代码：`main.py`（git 只读辅助 + 两个接口）、`desktop/electron/{api-client,main,preload}.cjs`、`desktop/src/{types.ts,views/RightPanel.tsx,views/ChatPage.tsx,styles.css}`；
- 性能：`git status` / `git diff` 5–8 秒超时，diff 截断 200KB；
- 兼容：旧服务端缺少接口时，面板提示"不支持变更面板"，不影响对话。

## Out of Scope

- 暂存 / 提交 / 回滚等写操作；
- 未跟踪文件内容预览；
- 浏览器标签页（`WebContentsView`）；
- 多仓库并排 diff。
