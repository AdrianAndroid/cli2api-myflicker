# Design

## Context

`anthropic_api.py` 目前只读请求体 `cwd`，否则 `resolve_cwd(identity, None, ip)` 返回 per-key workspace。Claude Code 在 system prompt 的 `# Environment` 段写入 `Primary working directory: <abs>`，请求体/头都没有该字段。`identity.resolve_cwd` 对回环客户端不启用沙箱，对非回环强制 workspace 边界。

## Goals / Non-Goals

**Goals:**
- 单用户本机零配置：Claude Code 在哪个项目开，myflicker 就在哪个目录跑。
- 显式 `cwd` 字段/头仍可精确覆盖。
- 目录不可用时不产生 403，而是安全回退。

**Non-Goals:**
- 不做跨项目自动建目录（不创建 prompt 中的路径）。
- 不修改 OpenAI 面的 cwd 规则。
- 不实现 Claude Code 工具回环。

## Decisions

1. **解析 system prompt 而不是让用户配头**：Claude Code 默认带 `Primary working directory`，零配置；同时新增 `X-Myflicker-Cwd` 头给其它客户端。
2. **优先级 body > header > prompt > workspace**：显式值语义最强；prompt 是推断值，最低但优先于空 workspace。
3. **只接受绝对且存在的目录**：不 `mkdir`（用户明确不需要新建目录），避免把错误路径写进日志/任务；`os.path.isdir` 校验。
4. **沙箱失败回退而非报错**：自动推断不应让远端客户端请求失败；显式 cwd 仍按原契约 403。回退时 cwd_source 保留 `prompt`，任务记录里的 `cwd` 显示真实目录。
5. **日志加 `cwd_source`**：四种取值，便于区分"没识别到"与"识别到但被沙箱拦下"。

## Risks / Trade-offs

- [system prompt 文本格式随 Claude Code 版本变化] → 正则同时匹配 `Primary working directory:` 与 `Working directory:`；识别失败只回退，不影响可用性；头覆盖兜底。
- [多项目并发切换] → myflicker 锁按目录，两个项目可并行；同项目串行，符合既有约束。
- [误识别到 prompt 中示例路径] → 只取第一个绝对路径且必须存在；Claude Code 该段位于 system 顶部，实践稳定。
