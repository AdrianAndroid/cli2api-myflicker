## 1. 用量存储

- [ ] 1.1 在 `celery_tasks.py` 任务终态处写入用量记录（Redis `hash` + 日/周计数器，带 TTL）
- [ ] 1.2 记录字段：`label`、`task_id`、`status`、`started_at`、`duration_ms`、`chars_out`、`estimated_tokens`
- [ ] 1.3 明细列表按 label 保留最近 N 条（默认 200），超出裁剪

## 2. 配额校验

- [ ] 2.1 `identity.py` 解析 `KEY_LIMITS=label:N/day|week`，非法条目忽略并告警
- [ ] 2.2 提交前校验当前窗口用量，超限返回 429 `quota_exceeded`（含 `window`/`used`/`limit`/`reset_at`）
- [ ] 2.3 校验失败不影响其他 label；Redis 不可用时 fail-open 并记录告警

## 3. 查询接口

- [ ] 3.1 新增 `GET /api/myflicker/usage?window=day|week`（普通 key 只看自己）
- [ ] 3.2 admin key 支持 `?label=` 查询任意身份，并在 `/api/myflicker/tasks` 旁提供汇总
- [ ] 3.3 OpenAPI/schema 与 `openspec/specs/api-contract/spec.md` 同步更新

## 4. 桌面端

- [ ] 4.1 新增"用量"视图：日/周已用、上限、重置时间、最近明细
- [ ] 4.2 admin 视图可切换 label 查看汇总
- [ ] 4.3 超限时在提交页给出明确提示（而不是只显示 429）

## 5. 验证

- [ ] 5.1 单测：窗口边界（跨天重置）、超限拒绝、fail-open
- [ ] 5.2 集成：两个 key 并发提交，A 超限后 B 仍可提交并执行
- [ ] 5.3 文档：`README_START.md` 增加 `KEY_LIMITS` 配置说明与 `/usage` 示例
