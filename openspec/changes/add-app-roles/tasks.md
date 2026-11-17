## 1. 角色与首屏

- [x] 1.1 首次启动角色选择页（提供服务 / 连接使用），写入本地设置
- [x] 1.2 左栏按角色/档案渲染图标（`remote` 档案或 client 角色隐藏服务与日志）
- [x] 1.3 使用机跳过 `.env` 生成、venv 探测与 ServiceManager
- [x] 1.4 连接页可切换角色；切换后回到对应首屏

## 2. 连接档案

- [x] 2.1 档案模型与本地存储（`id/name/baseUrl/keyRef/model/timeout/kind`）
- [x] 2.2 key 存入系统钥匙串（`safeStorage`），界面只显示掩码
- [x] 2.3 连接卡：地址 + key + 模型 + 超时 + 测试连接
- [x] 2.4 探活：`/health` → `/v1/models`，分别给出结果
- [x] 2.5 连接串导出/导入（`myflicker://<base64>`）
- [x] 2.6 参数化 `api-client`：baseUrl/key 由当前档案传入（移除硬编码 127.0.0.1）

## 3. 数据分区与离线

- [x] 3.1 消息按 `profileId` 分区，切换档案互不可见（项目/会话待工作区 UI 落地）
- [x] 3.2 迁移现有 localStorage 聊天记录到 `local` 档案
- [x] 3.3 离线只读：连接中断时禁用输入、保留历史浏览

## 4. 验证

- [x] 4.1 以同一客户端的 client 角色连接本机 8000 验证通过（物理第二台待部署）
- [x] 4.2 服务机切换 local/remote 档案，服务模块显隐正确
- [x] 4.3 服务不可达时显示断连横幅、输入禁用、历史可浏览
- [x] 4.4 `openspec validate --all --strict` 通过
