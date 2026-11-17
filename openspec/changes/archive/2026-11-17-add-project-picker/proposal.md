## Why

工作区已经能管理多个会话，但所有会话都跑在服务端默认目录里，无法为不同任务选不同项目目录。

网关的 `/api/myflicker/submit` 与 `/v1/chat/completions` 早就接受 `cwd` 并做沙箱校验，缺的只是：

- 一个只读的目录浏览接口，让客户端知道工作区里有哪些目录；
- 工作区里的项目选择入口，并把选中的 `cwd` 带进每次对话。

## What Changes

- 新增 `GET /api/myflicker/workspaces`：按调用者的 workspace 列出子目录，支持 `?path=` 逐级浏览，越界返回 403；
- 会话新增 `cwd` 字段：每个会话可以有自己的项目目录，新会话继承当前会话的目录；
- 工作区标题栏新增项目胶囊，点开目录选择器（上级 / 回到工作区根 / 刷新 / 选用）；
- 发送对话时把 `cwd` 放进 `/v1/chat/completions` 请求体；
- 服务端拒绝时，错误照常显示在对话气泡里。

## Capabilities

### New Capabilities

- `workspace-projects`：会话级项目目录、目录浏览、选择器与错误处理。

### Modified Capabilities

无（`api-contract` 以新增需求的形式扩展）。

## Impact

- 代码：`main.py`（新接口）、`desktop/electron/{api-client,main,preload}.cjs`、`desktop/src/{types.ts,lib/sessions.ts,views/ChatPage.tsx,views/ProjectPicker.tsx,styles.css}`；
- 数据：会话存储新增可选 `cwd`，旧数据不受影响；
- 兼容：老服务端没有该接口时，选择器显示"该服务不支持目录浏览"，不影响对话。

## Out of Scope

- 在服务端创建 / 删除目录；
- 按项目聚合会话列表；
- 跨项目移动已有会话；
- 项目级权限或独立 Key。
