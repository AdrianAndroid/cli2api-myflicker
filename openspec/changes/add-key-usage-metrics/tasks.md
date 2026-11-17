## 1. 用量存储

- [ ] 1.1 在 `celery_tasks.py` 任务终态处写入用量记录（Redis `hash` + 日/周计数器，带 TTL）
- [ ] 1.2 记录字段：`label`、`task_id`、`status`、`started_at`、`duration_ms`、`chars_out`、`estimated_tokens`
- [ ] 1.3 明细列表按 label 保留最近 N 条（默认 200），超出裁剪
- [ ] 1.4 维护 `usage:labels` 集合，供 admin 汇总时遍历（禁止 `KEYS *`）

## 2. 配额校验

- [ ] 2.1 `identity.py` 解析 `KEY_LIMITS=label:N/day|week`，非法条目忽略并告警
- [ ] 2.2 提交前校验当前窗口用量，超限返回 429 `quota_exceeded`（含 `window`/`used`/`limit`/`reset_at`）
- [ ] 2.3 校验失败不影响其他 label；Redis 不可用时 fail-open 并记录告警

## 3. 统计接口

- [ ] 3.1 新增 `GET /api/myflicker/stats?window=day|week`（普通 key 只回自己一行）
- [ ] 3.2 admin 返回总计 + 全部 label 行，按请求数降序，含成功率、平均耗时、token、配额
- [ ] 3.3 窗口切换返回新的 `reset_at`，最近明细不重复计数
- [ ] 3.4 OpenAPI/schema 与 `openspec/specs/api-contract/spec.md` 同步更新

## 4. 桌面端

- [ ] 4.1 服务页新增用量卡片：总请求、在线 key、估算 token、超限 key 数
- [ ] 4.2 按 key 排行表格：label / 请求 / 成功率 / 平均耗时 / token / 配额进度
- [ ] 4.3 日 / 周切换；普通用户只看自己，admin 看全部
- [ ] 4.4 点击行跳转任务列表并按 label 过滤
- [ ] 4.5 提交超限时给出明确提示（而不是只显示 429）

## 5. 验证

- [ ] 5.1 单测：窗口边界（跨天重置）、超限拒绝、fail-open
- [ ] 5.2 集成：两个 key 并发提交，A 超限后 B 仍可提交并执行
- [ ] 5.3 无头截图：服务页用量卡片 + 排行
- [ ] 5.4 文档：`README_START.md` 增加 `KEY_LIMITS` 配置说明与 `/stats` 示例
