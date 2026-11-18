# Spec Delta

## Purpose

约束网关与桌面端的日志体积：通过大小轮转、按天/总量保留、批量写入与输出截断，保证长时间运行后日志仍可排查且不会无限膨胀。

## ADDED Requirements

### Requirement: Log File Rotation

后端统一任务日志与桌面进程日志 SHALL 在单文件超过 `LOG_MAX_BYTES`（默认 20MB）时轮转，最多保留 `LOG_BACKUPS`（默认 5）份后备文件；轮转 MUST NOT 丢失正在写入的事件（按行切分、追加到新文件）。

#### Scenario: 统一日志轮转

- **WHEN** `logs/myflicker_tasks.jsonl` 超过上限
- **THEN** 文件被重命名为 `.1`，旧 `.1` 顺延为 `.2`，超出份数的最旧文件删除
- **AND** 新事件写入新的 `myflicker_tasks.jsonl`

#### Scenario: 桌面进程日志轮转

- **WHEN** `logs/desktop/api.log` 超过上限
- **THEN** 同样顺延为 `api.log.1` 等，内存环形缓冲不受影响

### Requirement: Log Retention And Pruning

系统 SHALL 在启动时与之后每小时清理日志：删除超过 `LOG_RETENTION_DAYS`（默认 7 天）的文件；若 `tasks/` 与统一日志总量超过 `LOG_DIR_MAX_BYTES`（默认 500MB），按修改时间从旧到新删除直到低于上限。

#### Scenario: 按天清理

- **WHEN** 某任务日志文件修改时间早于保留窗口
- **THEN** 启动清理时被删除

#### Scenario: 按总量清理

- **WHEN** 日志总量超过上限
- **THEN** 从最旧文件开始删除，直到总量回落到上限以内
- **AND** 最近一次任务的日志不被删除

### Requirement: Batched And Bounded Writes

`log_event` SHALL 以进程内缓冲批量追加（默认每 500ms 或 64 条刷新，ERROR 级立即刷新），MUST NOT 为每条事件单独 open/close 文件；`write_output_file` SHALL 在落盘前按 `MAX_OUTPUT_CHARS` 截断 stdout/stderr。

#### Scenario: 高频事件

- **WHEN** 一个任务连续产生大量事件
- **THEN** 文件写入次数显著少于事件条数
- **AND** 进程退出前缓冲被刷新

#### Scenario: 超大输出

- **WHEN** myflicker 输出超过 `MAX_OUTPUT_CHARS`
- **THEN** 落盘的 stdout/stderr 文件不超过该上限
