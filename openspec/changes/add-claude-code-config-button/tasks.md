# Tasks

## 1. 配置读写模块

- [x] 1.1 新建 `desktop/electron/claude-config.cjs`：`status(env)` / `configure(env)` / `restore(env)`，支持 `MYFLICKER_CLAUDE_SETTINGS` 覆盖路径；验证：node 单元测试覆盖首次写入、合并保留其它字段、删除 `ANTHROPIC_API_KEY`、备份生成、恢复备份。

## 2. IPC 与类型

- [x] 2.1 `main.cjs` 注册 `claude:status` / `claude:configure` / `claude:restore`，`preload.cjs` 暴露同名方法，`types.ts` 增加返回类型；验证：`cd desktop && npm run typecheck` 通过。
- [x] 2.2 确认写入失败（无 key / 非法 JSON）不会破坏原文件；验证：单元测试用缺 key 与损坏 JSON 两组样例断言文件内容不变。

## 3. 界面

- [x] 3.1 `ConnectPage.tsx` 新增「Claude Code 接入」卡片：显示路径、当前地址、掩码 token、"已指向本机/未指向"状态，以及「配置 Claude Code」「恢复上次备份」按钮；验证：`npm run typecheck && npm run build` 通过。
- [x] 3.2 无头截图验证：隔离数据目录启动控制台并切到「连接」页截图，卡片与按钮可见；验证：截图文件非空，无报错日志。
- [x] 3.3 `README_START.md` 桌面端小节补充按钮说明；验证：文档含"配置 Claude Code"与备份说明。

## 4. 验收

- [x] 4.1 端到端：临时 `MYFLICKER_CLAUDE_SETTINGS` 指向 `/tmp`，配置后文件地址为 `http://127.0.0.1:58001`、token 与 `.env` 一致、备份存在；验证：脚本断言后清理。
- [x] 4.2 `openspec validate --all --strict` 通过；验证：命令退出码 0。
