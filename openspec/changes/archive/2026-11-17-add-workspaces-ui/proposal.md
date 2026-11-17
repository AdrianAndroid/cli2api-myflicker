## Why

连接档案和左栏已经落地，但工作区还是"一条永久时间线"：所有对话挤在同一列表里，无法并行几个话题，也无法从历史里挑一条继续。

已定的方向是 Codex 式工作区：左侧会话列表 + 中间活动流 + 右侧面板。本变更先落地前两块（会话与活动流），把右侧面板、项目切换留给后续变更。

## What Changes

- 工作区改为两栏：240px 会话列表 + 自适应活动流，两栏各自滚动，整体填满可用高度；
- 会话成为一等对象：可新建、切换、重命名、删除，自动用首条用户消息做标题；
- 会话按 `updatedAt` 分组（今天 / 昨天 / 更早），显示相对时间与步骤数；
- 所有会话按 `profileId` 分区存储，切换档案互不可见；旧的单条记录自动迁移为一条"历史对话"；
- 活动流保留现有气泡与工具卡片，补充会话级 `session_id` 记录，为后续续接做准备；
- 「清空」改为清空当前会话，而不是清掉全部历史。

## Capabilities

### New Capabilities

- `workspace-sessions`：本地会话线程、列表分组、档案隔离、活动流状态。

### Modified Capabilities

无。

## Impact

- 代码：`desktop/src/views/ChatPage.tsx`、新增 `desktop/src/lib/sessions.ts`、`desktop/src/styles.css`、`desktop/src/App.tsx`（工作区占满高度）。
- 数据：localStorage 新增 `myflicker.sessions.v1:<profileId>`，迁移旧 `myflicker.chat.messages.v1[:<profileId>]`。
- 兼容：首次打开时自动生成一条会话，行为与之前一致。

## Out of Scope

- 真正的 agent 续接：后端尚未接受 `session_id` / `--resume`，本变更只记录 `session_id`；
- 项目选择器（需要后端支持按请求切换 cwd）；
- 右侧面板（浏览器 / 变更 diff）；
- 会话搜索与置顶。
