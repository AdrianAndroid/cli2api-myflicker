# Tasks

## 1. 客户端 key 解析与 IPC

- [x] 1.1 新建 `desktop/electron/client-keys.cjs`：按 `identity.py` 规则导出 `parseClientKeys(env)` / `clientKeysFromEnv()`（`API_KEY` → label `default`，`API_KEYS` 的 `label:key`，无 label → `key-<sha256前12位>`，去重）；验证：`node -e "const {parseClientKeys}=require('./desktop/electron/client-keys.cjs'); ..."` 覆盖单 key、多 key、无 label、重复 key 四组样例并断言输出。
- [x] 1.2 `main.cjs` 注册 `env:client-keys`（读取 `envStore.readAll()` 后调用解析模块），`preload.cjs` 暴露 `clientKeys()`，`types.ts` 的 `Bridge` 增加返回类型；验证：`cd desktop && npm run typecheck` 通过。
- [x] 1.3 确认 `env:read` 的掩码行为未变；验证：主进程代码路径不修改 `maskEnv`，设置页渲染不变（typecheck + 代码检查）。

## 2. 服务页展示

- [x] 2.1 `OverviewPage.tsx` 新增"客户端 Key"卡片：进入页面时拉取 `window.api.clientKeys()`，逐条显示 label + 完整 key + 复制按钮（2 秒"已复制"反馈），空配置时提示去设置页；验证：`npm run typecheck && npm run build` 通过。
- [x] 2.2 无头截图验证：`MYFLICKER_DESKTOP_DATA_DIR=/tmp/mf-keys-test`、`MYFLICKER_DESKTOP_CAPTURE=/tmp/mf-keys.png`、`SMOKE=1` 启动，截图可见 key 明文；验证：截图文件存在且尺寸非零，进程退出后无残留窗口。
- [x] 2.3 `README_START.md` 桌面端小节补充"服务页可直接复制客户端 key"说明；验证：文档中出现该说明。

## 3. 验收

- [x] 3.1 隔离数据目录中把 `.env` 改成 `API_KEYS=alice:k1,bob:k2` 后启动控制台截图，页面出现两条完整 key；验证：截图 + 无头运行日志无报错。
- [x] 3.2 `openspec validate --all --strict` 通过；验证：命令退出码 0。
