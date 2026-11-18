# Tasks

## 1. cwd 解析

- [x] 1.1 `anthropic_api.py` 增加目录识别：从 system/messages 文本匹配 `Primary working directory:` / `Working directory:`，仅接受绝对且存在的目录；实现优先级 body > `X-Myflicker-Cwd` > prompt > workspace；验证：单元调用识别函数，覆盖存在/不存在/相对路径三种样例。
- [x] 1.2 `request.accepted` 增加 `cwd_source`（body/header/prompt/workspace）；验证：四种来源各发一次请求，日志字段正确。
- [x] 1.3 沙箱回退：自动识别目录超出 workspace 时回退 workspace 且不报错；显式 cwd 仍 403；验证：单测 `_resolve_request_cwd` 与 403 分支。

## 2. 集成与文档

- [x] 2.1 隔离环境（8010/Redis 13-15/假 CLI）发送带 `Primary working directory: <tmp项目>` 的请求，任务 `cwd` 为该目录且文件可读；验证：任务日志 `task.started.cwd` 与 `request.accepted.cwd_source=prompt`。
- [x] 2.2 同一环境用 `X-Myflicker-Cwd` 覆盖，任务 cwd 为头中的目录；验证：日志 `cwd_source=header`。
- [x] 2.3 无任何 cwd 信息时回退 workspace，行为与改动前一致；验证：日志 `cwd_source=workspace`。
- [x] 2.4 `README_START.md` 说明自动识别与头覆盖；验证：文档包含示例。
- [x] 2.5 `openspec validate --all --strict` 通过；验证：命令退出码 0。
