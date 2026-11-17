# Design：按 key 用量与排行

## 数据

```
usage:count:<label>:day:<YYYY-MM-DD>   hash  {requests, failures, timeouts, duration_ms, chars_out, tokens}
usage:count:<label>:week:<YYYY-Www>    hash  （同上）
usage:recent:<label>                    list  最近 200 条 JSON 明细
usage:labels                            set   出现过的 label（admin 汇总用）
usage:limit:<label>                     hash  {limit, window, updated_at}（由 KEY_LIMITS 同步，供展示）
```

- 每次任务进入终态 `INCRBY/HINCRBY` 对应窗口，并 `EXPIRE` 到窗口结束后一天；
- 明细只保留 `task_id/status/duration_ms/chars_out/tokens/started_at`，不含 prompt；
- Redis 不可用时 fail-open，并写 `usage.log` 告警。

## 接口

```
GET /api/myflicker/stats?window=day|week

200 {
  "window": "day",
  "reset_at": "2026-11-18T00:00:00Z",
  "totals": {"requests": 128, "labels": 4, "tokens": 91234, "over_quota": 1},
  "me": {"label": "alice", "requests": 50, "limit": 50, "success_rate": 0.96,
         "avg_duration_ms": 1820, "tokens": 23100},
  "labels": [                      // admin 才有；普通身份只有 me 一行
    {"label": "alice", "requests": 50, "limit": 50, "success_rate": 0.96,
     "avg_duration_ms": 1820, "tokens": 23100},
    ...
  ],
  "recent": [ {"task_id": "...", "status": "success", "duration_ms": 900, "tokens": 1200} ]
}
```

- 排序：`requests` 降序；同值按 label 字典序；
- 普通 key 的 `labels` 只含自己；
- `?label=` 仅 admin 可用，用于单 label 明细钻取。

## 界面（服务页）

```
服务总览
╭─ 服务 ───────────────────────────────────── [ 未启动 ] ─╮
│  队列 0        在线 Worker 0        运行 0ms              │
│  [ 启动服务 ]                                             │
╰───────────────────────────────────────────────────────────╯

╭─ 用量 · 按 key 排行 ─────────────── [ 今日 | 本周 ] ─────╮
│ 总请求 128     在线 key 4    估算 token 91k   超限 1     │
│ ───────────────────────────────────────────────────────── │
│ key      请求   成功率   平均耗时   token    配额          │
│ alice     50    96%     1.8s      23k      ██████ 50/50  │
│ bob       40    100%    1.2s      18k      ███░░░ 40/200 │
│ carol     28    93%     2.4s      15k      █░░░░░ 28/200 │
│                                                           │
│ 点击一行 → 任务页按 owner 过滤                            │
╰───────────────────────────────────────────────────────────╯
```

- 普通身份只渲染自己一行，标题改为「我的用量」；
- 超限行用红色进度条，并在行尾显示 `reset_at`；
- 数据每 5s 刷新，窗口切换立即重取。

## 分步

1. 用量写入 + 明细（无 UI，先用 curl 验证）
2. `/stats` + admin 排行
3. 配额校验与 429 提示
4. 服务页排行卡片 + 行点击过滤
5. 文档与截图
