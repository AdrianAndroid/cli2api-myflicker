# Multi-Tenancy Specification

## Purpose

定义"把本机 myflicker 分享给多个人"时的隔离契约：每个 API key 一个身份，身份决定工作目录、会话归属、任务可见性与队列；模型额度仍为共享。

## Requirements

### Requirement: Per-Key Identity

网关 SHALL 用 `API_KEYS=label:key[,label:key...]` 定义调用方身份；未配置时退化为单个 `API_KEY`（label 为 `default`）。`ADMIN_API_KEY` MUST NOT 占用普通身份的 workspace。

#### Scenario: 解析多个 key

- **WHEN** `API_KEYS=alice:<k1>,bob:<k2>`
- **THEN** 两个 key 各自得到独立 `label`，并分别映射到独立队列 `myflicker:alice` / `myflicker:bob`

### Requirement: Context Isolation By Workspace

对话上下文 SHALL 按工作目录隔离：每个 `label` 的默认工作目录为 `<WORKSPACE_ROOT>/<label>/`，myflicker 的会话按 cwd 归档，因此 `-c` 只能续接该 label 自己的会话。

#### Scenario: 同一用户续接会话

- **WHEN** alice 先执行一条任务，再以 `-c` 追问
- **THEN** 追问能看到 alice 之前的上下文

#### Scenario: 跨用户不可见

- **WHEN** bob 在自己的工作区以 `-c` 追问
- **THEN** bob 看不到 alice 的任何上下文，回答表现为"新对话"

### Requirement: Workspace Sandbox

来自非回环地址的调用方 SHALL 只能使用自己 workspace 内的目录；越界请求 MUST 被拒绝。

#### Scenario: 越权 cwd

- **WHEN** 局域网调用方指定 `cwd=/etc` 或别人的目录
- **THEN** 返回 403 且 `error.code` 为 `cwd_outside_workspace`
- **AND** 响应包含其自身的 `workspace`

#### Scenario: 本机运维

- **WHEN** 请求来自回环地址且 `SANDBOX_ENFORCE_LOOPBACK` 未开启
- **THEN** 允许使用任意目录（方便桌面端在真实仓库里跑）

### Requirement: Task Ownership

每个任务 SHALL 记录 `owner`（label）；列表与查询接口 MUST 按身份过滤。

#### Scenario: 任务列表隔离

- **WHEN** bob 请求 `GET /api/myflicker/tasks`
- **THEN** 只返回 `owner=bob` 的任务
- **AND** `admin` 身份可以看到全部任务

#### Scenario: 历史任务兼容

- **WHEN** 任务缺少 `owner` 字段（多租户改造前的旧数据）
- **THEN** 只有 admin 身份可见

### Requirement: Shared Quota, Separate Lanes

额度 SHALL 由所有身份共享（同一份 myflicker 登录态），但执行通道 MUST 相互独立：一个用户的长任务不得阻塞另一个用户的提交。

#### Scenario: 并行提交

- **WHEN** alice 与 bob 同时各提交一个耗时任务
- **THEN** 两个任务并发执行，互不排队

#### Scenario: 同用户串行

- **WHEN** alice 连续提交两个任务
- **THEN** 第二个任务必须等第一个结束（避免同目录锁冲突）

### Requirement: Usage Visibility

调用方 SHALL 能看到自己身份的工作区与队列深度，MUST NOT 看到其他身份的工作区路径。

#### Scenario: 健康快照中的身份信息

- **WHEN** alice 请求 `/api/myflicker/health`
- **THEN** 返回 `identity.label="alice"` 与其自身的 `workspace`
