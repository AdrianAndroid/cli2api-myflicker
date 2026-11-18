# Spec Delta

## ADDED Requirements

### Requirement: Claude Code Configuration

控制台 SHALL 提供将本机网关地址与客户端 key 写入 Claude Code 用户配置（默认 `~/.claude/settings.json`）的能力，并在写入前备份原文件、在界面只展示 key 掩码。

#### Scenario: 一键配置

- **WHEN** 用户点击「配置 Claude Code」且本机 `.env` 配置了 `API_KEY`（或 `API_KEYS`）
- **THEN** 控制台把 `ANTHROPIC_BASE_URL` 写为 `http://127.0.0.1:<API_PORT>`（`API_HOST=0.0.0.0` 时映射为回环地址）
- **AND** 把 `ANTHROPIC_AUTH_TOKEN` 写为该 key
- **AND** 保留 `settings.json` 中其它字段、移除冲突的 `ANTHROPIC_API_KEY`
- **AND** 原文件被复制为 `settings.json.myflicker-backup-<时间戳>`（权限 600），新文件权限 600

#### Scenario: 未配置 key

- **WHEN** `.env` 中没有可用的 `API_KEY` / `API_KEYS`
- **THEN** 配置失败并提示先配置 key，不修改 `settings.json`

#### Scenario: 查看状态

- **WHEN** 用户打开「连接」页
- **THEN** 卡片显示目标配置文件路径、当前 `ANTHROPIC_BASE_URL` 与 key 掩码
- **AND** 明确提示当前是否已指向本机服务

#### Scenario: 恢复备份

- **WHEN** 用户点击「恢复上次备份」
- **THEN** 最近一次备份被写回 `settings.json`
- **AND** 卡片状态刷新为恢复后的地址
