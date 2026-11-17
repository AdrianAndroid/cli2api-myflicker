## ADDED Requirements

### Requirement: Workspace Changes

网关 SHALL 提供只读的变更查询接口，且只允许访问调用者 workspace 内的仓库。

#### Scenario: 列出改动

- **WHEN** 调用方携带合法 Key 请求 `/api/myflicker/changes?path=<目录>`
- **THEN** 返回 `git: true`、仓库根、当前 cwd 与最多 500 个改动文件
- **AND** 文件包含 `path`、`status`、`staged`、`untracked`

#### Scenario: 非 git 目录

- **WHEN** 目标目录不在 git 仓库内
- **THEN** 返回 `git: false` 与空文件列表
- **AND** 不返回 5xx

#### Scenario: 单文件 diff

- **WHEN** 调用方请求 `/api/myflicker/changes/diff?path=<目录>&file=<相对路径>`
- **THEN** 返回统一 diff（最多 200KB，超出截断）
- **AND** 未跟踪文件返回空 diff 且 `untracked: true`

#### Scenario: 越界仓库

- **WHEN** 仓库根超出调用者 workspace 且沙箱生效
- **THEN** 返回 403 `repo_outside_workspace`

#### Scenario: 非法文件路径

- **WHEN** `file` 是绝对路径或包含 `..`
- **THEN** 返回 400 `invalid_file`
