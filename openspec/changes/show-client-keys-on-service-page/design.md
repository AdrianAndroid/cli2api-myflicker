# Design

## Context

主进程用 `maskEnv()`（`main.cjs`）把 `API_KEY` / `ADMIN_API_KEY` 统一替换为 `••••••••` 后经 `env:read` 交给渲染进程；安全约束见 `desktop-console` 的 Secret Handling。后端身份解析规则在 `identity.py`：`API_KEYS=label:key,...`，无 label 的 key 记为 `key-<sha256前12位>`，只有 `API_KEY` 时 label 为 `default`。

## Goals / Non-Goals

**Goals:**
- 服务页始终能复制全部可用客户端 key，不依赖打开 `.env`。
- 解析结果与网关实际接受的身份完全一致，避免"页面有 key 但 401"。

**Non-Goals:**
- 不改变 `env:read` 的掩码行为，设置页/局域网页继续掩码。
- 不暴露 `ADMIN_API_KEY`，不改远端连接档案的钥匙串/掩码策略。
- 不新增后端接口。

## Decisions

1. **新增专用 IPC `env:client-keys`，而不是把 `env:read` 改成明文**。理由：掩码是设置页的既有契约，单独接口把"明文"限制在唯一用途上，便于以后审计；替代方案（在渲染层从连接档案拼 key）拿不到本地 `.env` 的值。
2. **解析逻辑放独立 CJS 模块 `client-keys.cjs`**，导出 `parseClientKeys(env)` 与 `clientKeysFromEnv()`。理由：可用 `node -e` 直接做单元验证，不用启动 Electron；主进程只做 `readAll()` 后调用。
3. **卡片放「服务」页卡片下方，始终渲染**。理由：用户要求始终可见，且服务页是"怎么接这个服务"的自然位置；替代方案（仅 running 时显示）会造成启动前无法抄 key。
4. **复制用 `navigator.clipboard.writeText` + 2 秒"已复制"反馈**；Electron 渲染进程在安全上下文下可用。替代方案（主进程 clipboard IPC）多一层通道，无必要。
5. **只读、不缓存**：每次进入服务页重新拉取，避免环境变量修改（重载 `.env`）后展示旧值。

## Risks / Trade-offs

- [明文 key 出现在界面，可能被截屏/录屏泄露] → 仅本机服务页展示；管理 key 与远程档案 key 仍掩码；后续如需收紧可加"点击显示"开关（会改本规格，另开 change）。
- [密码管理器/剪贴板历史留存] → 复制是用户主动行为；不自动复制。
- [`API_KEYS` 值含逗号/冒号等特殊字符导致解析与后端不一致] → 直接复用后端的 split 规则，并在 tasks 中用同一组样例（含无 label、多条目）对比验证。

## Migration Plan

纯前端增量，无数据迁移；回滚 = 移除卡片与 IPC 注册。
