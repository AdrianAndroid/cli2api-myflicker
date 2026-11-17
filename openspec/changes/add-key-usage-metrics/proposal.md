## Why

网关已经能把 myflicker 按 key 分给多个人，但**没有任何用量记录与限额**：

- 一个 key 可以无限提交，共享的订阅额度没有刹车；
- 出问题时无法回答"是谁、在什么时候、跑了多久、消耗了多少"；
- 无法给不同的人不同的配额（例如每人每天 50 次 / 每人每周 200 次）。

## What Changes

### 1. 按 key 记录用量

每次任务结束（成功/失败/超时都算）追加一条用量记录，至少包含：`label`、`task_id`、`started_at`、`duration_ms`、`status`、`chars_out`（用于估算 token）、`estimated_tokens`、`requests=1`。写入 Redis，按 `label + 时间窗`（日/周）维护计数器，并保留最近 N 条明细。

### 2. 限额校验

新增配置 `KEY_LIMITS=alice:50/day,bob:200/week`。提交时先校验该 label 在当前窗口的已用量，超出后返回 429 `quota_exceeded`，并带上窗口、已用量、上限与重置时间。

### 3. 用量查询接口

新增 `GET /api/myflicker/usage?window=day|week`：

- 普通 key：只能看到自己的用量；
- admin key：可加 `?label=` 查看任意 label。

### 4. 桌面端展示

控制台新增"用量"视图：当前身份的日/周已用、上限、最近任务明细；admin 可以看到全部 label 的汇总。

## Capabilities

### New Capabilities

- `usage-metrics`：按 API key 的用量记录、配额窗口与用量查询。

### Modified Capabilities

- 无（`api-contract` 只是新增一个查询端点，需求层面的契约由 `usage-metrics` 覆盖；实现完成后再决定是否并入）。

## Impact

- 代码：`celery_tasks.py`（记录用量）、`identity.py`（解析 `KEY_LIMITS`）、`main.py`（限额校验 + `/usage`）、`desktop/src/views/*`（用量视图）。
- 配置：`.env` 新增 `KEY_LIMITS`。
- 兼容性：未配置 `KEY_LIMITS` 的行为保持不变（不限额）。

## Out of Scope

- 真实 token 计费：myflicker 不返回 token 用量，`estimated_tokens` 只能是按字符数估算。
- 余额/付款：本项目不涉及收费，只做配额控制。
- 跨机器汇总：P2 的多机器池化再做全局配额。
