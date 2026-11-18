# Spec Delta

## MODIFIED Requirements

### Requirement: Secret Handling

客户端 key（`API_KEY` 与 `API_KEYS` 的每个条目）SHALL 在「服务」页始终明文可见并支持一键复制；`ADMIN_API_KEY`、设置页与局域网页仍 SHALL 掩码显示。密钥明文只应出现在主进程、`.env` 与本机服务页。

#### Scenario: 查看配置

- **WHEN** 用户打开设置或局域网页
- **THEN** `API_KEY` / `ADMIN_API_KEY` 显示为掩码

#### Scenario: 服务页展示客户端 Key

- **WHEN** 用户打开「服务」页
- **THEN** 明文列出每个生效的客户端 key（`API_KEY` 或 `API_KEYS` 中的 `label`）及完整值
- **AND** 值可一键复制
- **AND** `ADMIN_API_KEY` 不出现在该列表

#### Scenario: 多 key 配置

- **WHEN** `.env` 配置了 `API_KEYS=alice:<k1>,bob:<k2>`
- **THEN** 服务页分别展示 `alice` / `bob` 两条完整 key
- **AND** 与后端身份解析使用相同的 label 规则

#### Scenario: 轮换密钥

- **WHEN** 用户点击"轮换"
- **THEN** 新 key 被写入 `.env`（权限 600）
- **AND** 服务页展示新的完整 key
- **AND** 界面提示需要重启服务后生效
