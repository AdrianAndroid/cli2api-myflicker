## 1. 中间件

- [x] 1.1 新增请求标识中间件：读取/生成 `X-Request-Id`，写入 `request.state`
- [x] 1.2 所有响应（含 4xx/5xx）都带 `X-Request-Id` 头
- [x] 1.3 标识校验：长度 1-128、仅可见 ASCII，否则重新生成

## 2. 任务记录

- [x] 2.1 提交响应体加入 `request_id`
- [x] 2.2 任务初始状态写入 `request_id`，`/result` 回显
- [x] 2.3 `task.submitted` 日志事件记录 `request_id`

## 3. 验证

- [x] 3.1 手测：不带头、带合法头、带非法头三种情况
- [x] 3.2 校验：`openspec validate --all --strict` 通过
- [x] 3.3 文档：`README_START.md` 的接口示例补充 `X-Request-Id`
