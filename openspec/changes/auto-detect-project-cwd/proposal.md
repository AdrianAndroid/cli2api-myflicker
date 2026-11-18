# Proposal

## Why

Claude Code 不在请求体里传 cwd，只把 `Primary working directory` 写在 system prompt；网关因此总在空的 per-key workspace 里执行 myflicker，用户在具体项目里"怎么都干不了"。需要让请求自动落到 Claude Code 当前项目目录。

## What Changes

- `/v1/messages` 的 cwd 解析顺序调整为：请求体 `cwd` → 请求头 `X-Myflicker-Cwd` → system prompt 中 `Primary working directory:` / `Working directory:` 指向的绝对路径（必须存在且是目录）→ 该 key 的 workspace。
- 自动识别到的目录若超出沙箱（非回环客户端）则回退 workspace，不报错；显式 `cwd` 头/字段仍按原规则返回 403。
- `request.accepted` 日志新增 `cwd_source`（body/header/prompt/workspace），便于确认实际执行目录。
- README 补充 Claude Code 项目目录自动识别说明。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `api-contract`: Anthropic 面的工作目录解析规则与日志字段。

## Impact

- 代码：`anthropic_api.py`（解析与日志）、`README_START.md`。
- 行为：Claude Code 的请求默认在它声明的项目目录执行；无该信息时行为不变。
- 无破坏性变更：请求体 `cwd` 仍最高优先级。
