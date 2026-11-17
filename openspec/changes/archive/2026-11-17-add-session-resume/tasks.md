## 1. 网关

- [x] 1.1 解析并校验 `session_id`（类型、长度、字符集）
- [x] 1.2 续接时 `args_prefix` 追加 `--resume <id>`（已有则跳过）
- [x] 1.3 续接时 prompt 只取最后一条用户消息
- [x] 1.4 不传 `session_id` 时行为不变

## 2. 桌面端

- [x] 2.1 有 `sessionId` 时请求体带 `session_id` 且只发新消息
- [x] 2.2 标题栏「续接 <短 id>」标签
- [x] 2.3 点击标签断开续接
- [x] 2.4 错误照常显示在气泡内

## 3. 验证

- [x] 3.1 单测：续接参数、prompt 裁剪、非法 id 400
- [x] 3.2 无头截图：续接标签
- [x] 3.3 `npm run typecheck` 与 `vite build` 通过
- [x] 3.4 `openspec validate --all --strict` 通过
