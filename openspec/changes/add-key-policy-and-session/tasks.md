## 1. 策略与参数

- [ ] 1.1 `identity.py` 解析 `KEY_PROFILES=label:plan|dontAsk|autoEdit`，非法值告警并回落到 `default`
- [ ] 1.2 提交时按策略拼装 `--approval-mode`，并支持 `--tools` / `--mcp-config` 白名单
- [ ] 1.3 LAN 调用方请求里的提权参数被忽略（`ALLOW_YOLO=0` 时禁止 `yolo`）

## 2. 会话

- [ ] 2.1 从 myflicker 事件流解析 `sessionId`（解析失败不影响任务）
- [ ] 2.2 任务状态与响应返回 `session_id`
- [ ] 2.3 提交支持 `session_id` → `-r <id>`，并校验该会话属于同一 workspace

## 3. 界面

- [ ] 3.1 聊天页提供"继续该会话"（带 `-r`）
- [ ] 3.2 设置页展示每个 key 生效的审批模式

## 4. 验证

- [ ] 4.1 集成：两个 key 用不同审批模式跑同一 prompt，行为不同
- [ ] 4.2 集成：带 session_id 的第二次调用能看到第一次的上下文
- [ ] 4.3 文档与 specs 同步；`openspec validate --all --strict` 通过
