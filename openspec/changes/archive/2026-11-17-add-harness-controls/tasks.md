## 1. 网关事件模式

- [x] 1.1 `/v1/chat/completions` 支持 `events:true`：以 `--output-format stream-json --stream-text` 运行，prompt 走 stdin
- [x] 1.2 SSE 透传结构化事件（`x_myflicker_event`：system/sessionId、tool_use、tool-result、text、result usage）
- [x] 1.3 文本增量按标准 `delta.content` 输出，兼容普通 OpenAI 客户端

## 2. 聊天界面

- [x] 2.1 聊天页改为只经公开 `/v1` 调用（主进程代理，key 不出主进程）
- [x] 2.2 渲染步骤块：tool_use 卡片、可折叠 tool result、流式文本
- [x] 2.3 支持中途停止（Abort）
- [x] 2.4 输出增长时自动滚动到底部

## 3. 聊天记录持久化

- [x] 3.1 聊天页常驻挂载，切换 Tab 不丢状态
- [x] 3.2 消息保存到本地（上限 60 条 / 512KB），重启后恢复
- [x] 3.3 重启后残留的流式消息标记为已停止；「清空」同时清除本地存储

## 4. 验证

- [x] 4.1 实测：`read` 工具卡片 + tool result + 最终文本 + session id 正确渲染
- [x] 4.2 实测：切换页面后对话仍在；重启应用后对话恢复
- [x] 4.3 文档（README 第 16 节）与 specs 同步；`openspec validate --all --strict` 通过

## 5. 迁移

- [x] 5.1 未完成的"按 key 策略 / 显式 session 恢复"已迁移到 `add-key-policy-and-session`
