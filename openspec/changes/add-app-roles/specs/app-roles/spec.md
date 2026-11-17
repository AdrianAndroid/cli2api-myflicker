# Spec Delta

## Purpose

让同一份客户端按用途呈现两种形态：提供 API 的服务机，以及只消费 API 的使用机。

## ADDED Requirements

### Requirement: Role Selection

首次启动时 SHALL 要求选择角色（提供服务 / 连接使用），并在设置中允许切换。

#### Scenario: 选择使用机

- **WHEN** 用户选择「连接使用」
- **THEN** 应用进入连接卡（地址 + key + 测试连接）
- **AND** 不执行 `.env` 生成、venv 探测或本地进程启动

#### Scenario: 选择服务机

- **WHEN** 用户选择「提供服务」
- **THEN** 应用执行环境初始化并在成功后进入服务总览

### Requirement: Module Visibility By Role

左栏图标 SHALL 由角色决定；服务模块 MUST 只对本地档案可见。

#### Scenario: 使用机不显示服务模块

- **WHEN** 当前档案为 `remote`
- **THEN** 左栏不出现「服务」与「服务日志」入口
- **AND** 无法通过快捷键或 URL 直达服务管理页

#### Scenario: 服务机多个档案

- **WHEN** 服务机同时存在 `local` 与 `remote` 档案
- **THEN** 切到 `remote` 档案时服务模块隐藏，切回 `local` 时恢复

### Requirement: Client Mode Without Backend

使用机 SHALL 在缺少 Python 运行环境时仍可完整使用工作区。

#### Scenario: 未安装依赖

- **WHEN** 机器上没有 venv 且角色为使用机
- **THEN** 不显示"运行环境未就绪"提示
- **AND** 连接成功后可以正常发消息

### Requirement: Offline Read Only

服务不可达时，历史会话 SHALL 仍可浏览，发送能力 MUST 被禁用。

#### Scenario: 断网浏览

- **WHEN** 档案对应的服务不可达
- **THEN** 顶部显示连接中断提示
- **AND** 输入框禁用并说明原因
- **AND** 历史消息与工具步骤仍可查看
