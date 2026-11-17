## Why

这套客户端要同时满足两种人：

- **服务机**（我的 Mac）：把本机 myflicker 变成 API，主要工作是发 key、观察用量、保证服务稳定；
- **使用机**（同事的电脑）：只想要一个 Codex 式的界面，填连接串就能用，不应被 Python/venv/Redis 拖累。

现在两者混在一套界面里：缺依赖会顶黄条、服务模块对所有人可见、连接地址硬编码 127.0.0.1。
需要引入"角色 + 连接档案"，让同一份安装包按用途呈现不同界面。

## What Changes

### 1. 角色（Role）

- 首次启动选择「提供服务 / 连接使用」，可稍后切换；
- 角色决定首屏与左栏图标：服务机显示 🛠 服务 / 💬 工作区 / 📄 日志 / ⚙️ 设置；使用机只有 💬 工作区 / ⚙️ 设置；
- **使用机跳过全部后端初始化**（`bootstrap .env`、venv 探测、ServiceManager 都不启动）；
- 角色可共存：服务机也能连别的服务（多档案），但 🛠 服务模块仅对本地档案出现。

### 2. 连接档案（Profile）

- 一个档案 = `{name, baseUrl, keyRef, model, timeout, kind: local|remote}`；
- key 存系统钥匙串（`safeStorage`），渲染层只见到掩码；
- 「测试连接」依次校验 `/health` 与 `/v1/models`，分别显示服务可达 / 鉴权通过 / 模型可用；
- 支持**连接串**：`myflicker://<base64({baseUrl,key,label})>`，可复制粘贴自动填表（不做二维码/自动下发）；
- 所有工作区数据（项目/会话/消息）按 `profileId` 分区，切档案互不可见。

### 3. 离线可读不可发

- 无网络/服务不可达时：历史会话仍可浏览，输入框禁用并提示原因；
- 不回放"执行中"的旧消息（统一标为已停止）。

## Capabilities

### New Capabilities

- `app-roles`：角色选择、模块可见性、使用机免后端、离线只读。
- `connection-profiles`：多档案存储、探活、连接串、数据分区、密钥保管。

### Modified Capabilities

- `desktop-console`：启动流程按角色分支（使用机不初始化后端）。

## Impact

- 代码：`desktop/electron/main.cjs`（角色与档案）、`preload`、`App.tsx`（左栏按角色渲染）、`api-client.cjs`（baseUrl/key 由档案传入）、新增档案存储与 keychain 模块。
- 数据：本地库按 `profileId` 分区；现有 localStorage 聊天记录迁移到 `local` 档案下。
- 兼容性：默认档案仍是本机 `.env`，老用户升级后行为不变。

## Out of Scope

- 二维码 / 邀请码 / 服务端自动下发 key；
- 跨设备同步会话；
- 精简安装包（使用机也可携带后端代码，只是不启用）。
