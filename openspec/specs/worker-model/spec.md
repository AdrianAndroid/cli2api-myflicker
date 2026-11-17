# Worker Model Specification

## Purpose

定义 myflicker 的执行拓扑：一个工作目录同时只能有一个 myflicker 进程，因此"每用户一条串行通道、用户之间并行"是这套网关最重要的性能与正确性契约。

## Requirements

### Requirement: Per-Workspace Exclusivity

同一工作目录内，网关 MUST NOT 同时运行两个 myflicker 进程；不同工作目录之间 SHALL 允许并发。

#### Scenario: 同目录串行

- **WHEN** 同一 label 连续提交两个任务
- **THEN** 两个任务的执行区间不重叠
- **AND** 第二个任务在第一个结束后才开始

#### Scenario: 跨目录并行

- **WHEN** 两个 label 同时提交任务
- **THEN** 两个 myflicker 进程并发运行
- **AND** 两个任务的总耗时接近单个任务耗时，而不是叠加

### Requirement: One Serial Worker Per Identity

监督器（`worker_supervisor.py`）SHALL 为每个非 admin 的 label 启动恰好一个 `--concurrency=1` 的 Celery worker，消费队列 `myflicker:<label>`。

#### Scenario: 启动多个身份

- **WHEN** 配置了三个 label
- **THEN** 监督器启动三个 worker，各自只消费自己的队列

#### Scenario: 热增减身份

- **WHEN** 在 `.env` 中新增或删除 `API_KEYS` 条目
- **THEN** 监督器在数秒内为新增 label 拉起 worker、为删除的 label 停止 worker
- **AND** 其他 label 的 worker 不受影响

#### Scenario: worker 崩溃

- **WHEN** 某个 worker 进程意外退出
- **THEN** 监督器记录退出码并在退避后重新拉起该 worker

### Requirement: Task Routing

任务 MUST 被投递到提交者自己的队列；网关的队列深度、背压与健康上报 MUST 使用该调用方的队列。

#### Scenario: 路由到自有队列

- **WHEN** alice 提交任务
- **THEN** 该任务出现在 `myflicker:alice` 队列
- **AND** `GET /api/myflicker/health` 中的 `queue` 字段为 `myflicker:alice`

#### Scenario: 队列背压按身份计算

- **WHEN** alice 的队列等待数达到 `MAX_QUEUE_DEPTH`
- **THEN** 只有 alice 的新提交被 429 拒绝
- **AND** bob 仍可正常提交

### Requirement: Process Lifecycle

worker 内部对 myflicker 的调用 SHALL 使用独立进程组，超时 MUST 终止整个进程组；worker 自身被停止时 MUST 一并结束其子进程。

#### Scenario: 执行超时

- **WHEN** myflicker 运行超过该任务的 `timeout`
- **THEN** 网关对进程组先 SIGTERM，宽限期后 SIGKILL
- **AND** 任务被标记为 `failure` 且 `timed_out=true`

#### Scenario: 停止服务

- **WHEN** 桌面端点击停止或监督器收到 SIGTERM
- **THEN** 所有 worker 与它们启动的 myflicker 进程都被终止
- **AND** 端口与 Redis 队列不再有残留执行

### Requirement: Output Capture

worker SHALL 实时捕获 myflicker 的 stdout/stderr：全量写入任务日志文件，并按块推送到 Redis 供 SSE 消费。

#### Scenario: 流式消费

- **WHEN** 客户端以 SSE 订阅一次运行
- **THEN** 它收到的输出块顺序与实际进程输出一致
- **AND** 进程结束时收到结束标记

#### Scenario: 日志留档

- **WHEN** 一次运行结束
- **THEN** `logs/tasks/<task_id>.jsonl`、`.stdout.txt`、`.stderr.txt` 均存在
