# Desktop Console Specification

## Purpose

定义 Electron 控制台的契约：进程编排、状态呈现、配置与密钥处理，以及打包后"源码在包内、可写数据在用户目录"的边界。

## Requirements

### Requirement: Service Orchestration

控制台 SHALL 按 `Redis → FastAPI → worker 监督器 → 自检` 的顺序启动服务，并按相反顺序停止；检测到已运行的服务时 MUST 复用而不是重复拉起。

#### Scenario: 启动顺序

- **WHEN** 用户点击"启动服务"
- **THEN** 界面逐步显示 Redis / API / worker 三步状态
- **AND** 只有当 `/api/myflicker/health` 返回 200 时状态才变为"就绪"

#### Scenario: 复用已有实例

- **WHEN** 8000 端口上已有同 key 的网关
- **THEN** 控制台进入"复用"模式，不再启动第二个网关

#### Scenario: 端口被其它实例占用

- **WHEN** 端口被占且 `API_KEY` 不匹配
- **THEN** 明确报错并提示可能是另一个实例，而不是静默失败

### Requirement: Serial Execution Safety

控制台 MUST NOT 提供提高单个 worker 并发的入口；worker 的数量只能由 API key 数量决定。

#### Scenario: 界面约束

- **WHEN** 用户查看任务页与状态条
- **THEN** 只显示"每用户串行 · 用户间并行"，不存在并发调节控件

### Requirement: Secret Handling

API keys SHALL 始终在界面上以掩码显示；明文只在创建/轮换的瞬间展示一次，并且只存在于主进程与 `.env`。

#### Scenario: 查看配置

- **WHEN** 用户打开设置或局域网页
- **THEN** `API_KEY` / `ADMIN_API_KEY` 显示为掩码

#### Scenario: 轮换密钥

- **WHEN** 用户点击"轮换"
- **THEN** 新 key 被写入 `.env`（权限 600）并仅展示一次
- **AND** 界面提示需要重启服务后生效

### Requirement: Testability Without Interruption

控制台 SHALL 支持无头截图与独立数据目录运行，供自动化验证使用而不得抢占用户焦点。

#### Scenario: 无头截图

- **WHEN** 进程带 `MYFLICKER_DESKTOP_CAPTURE` 启动
- **THEN** 窗口不显示、不获取焦点、Dock 图标隐藏
- **AND** 截图写入指定路径后按 `MYFLICKER_DESKTOP_SMOKE` 决定是否退出

#### Scenario: 独立数据目录

- **WHEN** 进程带 `MYFLICKER_DESKTOP_DATA_DIR` 启动
- **THEN** `.env`、`.venv`、日志与单实例锁都落在该目录
- **AND** 用户正在使用的实例不受影响

### Requirement: Packaged Runtime

安装包 SHALL 只包含只读源码（`Resources/backend/`），可写数据（`.env`、`.venv`、`logs`、`workspace`）MUST 位于用户数据目录；首次运行 MUST 生成配置并检测 Python 运行环境。

#### Scenario: 首次启动

- **WHEN** 用户数据目录中不存在 `.env`
- **THEN** 从包内 `.env.example` 生成可写 `.env`，写入随机 `API_KEY`、`LOG_DIR`、`WORKSPACE_ROOT`、`REDIS_BIN`

#### Scenario: 依赖缺失

- **WHEN** venv 不存在或缺少依赖
- **THEN** 界面显示"运行环境未就绪"，并提供一键初始化（创建 venv + 安装 requirements）

#### Scenario: 初始化失败

- **WHEN** pip 安装失败
- **THEN** 失败原因写入 `setup.log` 并在界面可见，启动服务被阻止并给出原因

### Requirement: Settings Absorbs LAN Controls

局域网访问控制 SHALL 位于设置页，不再作为独立入口。

#### Scenario: 从设置切换访问范围

- **WHEN** 用户在设置页切换"仅本机 / 局域网"
- **THEN** 控制台写入 `API_HOST` 并提示需要重启服务生效
- **AND** 地址列表、Key 轮换与安全策略仍在同一页可见

### Requirement: Overview And Left Rail Navigation

控制台 SHALL 采用"总览首屏 + 左侧图标栏"的信息架构，把全局状态常驻在左栏顶部。

#### Scenario: 打开即见全局状态

- **WHEN** 用户打开控制台且服务已就绪
- **THEN** 首屏显示队列深度、在线 worker 数与运行时长三项大号指标
- **AND** 显示当前最繁忙（或"暂无任务"）的任务摘要

#### Scenario: 左侧导航

- **WHEN** 用户切换页面
- **THEN** 可通过左侧图标栏在服务、任务、工作区、日志、连接、设置之间切换
- **AND** 当前页的图标有明确的高亮状态

#### Scenario: 状态常驻左栏

- **WHEN** 用户处于任意页面
- **THEN** 左栏顶部显示服务运行状态点（使用机或远端档案显示连接状态点）
- **AND** 队列深度与 worker 数在服务页可见
- **AND** 界面不再出现底部 Tab 栏或悬浮服务条

#### Scenario: 服务启停入口

- **WHEN** 用户需要启动、重启或停止服务
- **THEN** 在「服务」页卡片内完成操作
- **AND** 不依赖任何常驻悬浮控件
