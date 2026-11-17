## ADDED Requirements

### Requirement: Workspace Listing

网关 SHALL 提供 `GET /api/myflicker/workspaces`，按调用者身份列出其工作区内的目录。

#### Scenario: 列出工作区

- **WHEN** 调用方携带合法 Key 请求该接口
- **THEN** 返回 `workspace`、当前 `cwd`、`parent`（若有）与 `dirs` 列表
- **AND** 子目录数量上限 200，跳过点目录

#### Scenario: 逐级浏览

- **WHEN** 调用方带上 `?path=<绝对或相对路径>`
- **THEN** 返回该目录的信息与子目录
- **AND** 相对路径以调用者 workspace 为基准解析

#### Scenario: 越界路径

- **WHEN** 请求路径超出调用者 workspace 且沙箱生效
- **THEN** 返回 403 `cwd_outside_workspace`
- **AND** 响应里带 workspace 路径

#### Scenario: 未认证

- **WHEN** 请求缺少或使用错误的 Key
- **THEN** 返回 401，且不泄露任何目录信息
