# myflicker HTTP API 网关 — 启动与验证手册

把私有的、不支持并发的 CLI `myflicker` 封装成异步 HTTP API：
FastAPI 负责鉴权/提交/查询，Redis 负责队列与结果，Celery Worker 以
`--concurrency=1` 串行调用 myflicker，保证同一时刻只有一个 myflicker 进程。

## 0. 文件清单

| 文件 | 作用 |
| --- | --- |
| `main.py` | FastAPI 网关：`X-API-Key` 校验、提交任务、查询结果、健康检查 |
| `celery_tasks.py` | Celery app + 唯一的 myflicker 执行入口（subprocess、超时、JSONL 日志） |
| `requirements.txt` | Python 依赖 |
| `.env.example` / `.env` | 全部配置项（API_KEY、MYFLICKER_BIN、超时、Redis、监听地址、日志目录） |
| `test_client.py` | 命令行测试客户端：提交 + 自动轮询 + 打印日志 |
| `mock_myflicker.sh` | 可选：本地假 myflicker，用于没有真实二进制的联调自检 |
| `logs/` | 运行后自动生成的日志目录 |

## 1. 架构与数据流

```
Agent / curl
   │  POST /api/myflicker/submit  (X-API-Key)
   ▼
FastAPI (main.py)  ──apply_async──►  Redis broker(db1)  ──►  Celery worker (--concurrency=1)
   │                                                            │ subprocess.Popen([MYFLICKER_BIN, *args])
   │  写 pending 状态到 Redis(db0)                                │ stdout/stderr/returncode/timeout
   │                                                            ▼
   └── GET /api/myflicker/result/{task_id}  ◄── 写 success/failure 到 Redis(db0)
```

- 网关进程**从不**执行 myflicker，只入队；执行逻辑 100% 在 `celery_tasks.run_myflicker` 内。
- Worker 单并发 = 天然排队（FIFO），不会出现 myflicker 锁冲突。
- `worker_prefetch_multiplier=1` + `task_acks_late=True`，避免预取导致的任务滞留。

## 2. 安装

```bash
cd /Users/zhaojian/Desktop/cli2api-myflicker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Redis（二选一）：

```bash
# macOS (Homebrew)
brew install redis && brew services start redis

# Docker
docker run -d --name myflicker-redis -p 6379:6379 redis:7-alpine
```

```bash
redis-cli ping        # 期望输出 PONG
```

## 3. 配置

```bash
cp .env.example .env     # 仓库里已有一份开发用 .env，按需覆盖
```

必须改的两项：

```bash
API_KEY=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")   # 写进 .env
MYFLICKER_BIN=/绝对路径/myflicker                                         # 不依赖 PATH
MYFLICKER_CWD=/绝对路径/工作目录                                          # myflicker 的运行目录
```

`.env` 全部键位：

| Key | 说明 | 默认 |
| --- | --- | --- |
| `API_KEY` | 鉴权密钥，请求头 `X-API-Key`；为空则服务拒绝启动 | 无（必填） |
| `MYFLICKER_BIN` | myflicker 可执行文件路径（建议绝对路径） | `myflicker` |
| `MYFLICKER_CWD` | 默认工作目录；为空则继承 worker 的 cwd | 空 |
| `DEFAULT_TIMEOUT` | 未指定 timeout 时的超时（秒） | `300` |
| `MAX_TIMEOUT` | 允许的最大超时（秒），超过直接 400 | `3600` |
| `REDIS_URL` | 状态/结果存储 Redis（db0） | `redis://127.0.0.1:6379/0` |
| `CELERY_BROKER_URL` | 任务队列 broker（db1） | `redis://127.0.0.1:6379/1` |
| `CELERY_RESULT_BACKEND` | Celery 结果后端（db2） | `redis://127.0.0.1:6379/2` |
| `CELERY_QUEUE` | 队列名 | `myflicker` |
| `TASK_KEY_PREFIX` | Redis 键前缀 | `myflicker:task` |
| `RESULT_TTL` | 任务状态保留秒数 | `86400` |
| `API_HOST` / `API_PORT` | 监听地址/端口 | `0.0.0.0` / `8000` |
| `LOG_DIR` | 日志目录（相对路径按项目根解析） | `logs` |
| `MAX_OUTPUT_CHARS` | 返回体/JSONL 中 stdout/stderr 最大字符数 | `200000` |
| `MAX_ARGS` / `MAX_ARG_LEN` | 参数个数 / 单参数长度上限 | `200` / `4096` |
| `POLL_HINT_MS` | 返回体里的轮询建议间隔 | `1000` |
| `EXTRA_ENV` | 单行 JSON，注入到每个 myflicker 进程 | `{}` |

## 4. 启动顺序（严格按此顺序）

**第 1 步：确认 Redis 可用**

```bash
redis-cli ping
```

**第 2 步：启动 Celery worker（串行执行的关键）**

```bash
cd /Users/zhaojian/Desktop/cli2api-myflicker
source .venv/bin/activate
celery -A celery_tasks.celery_app worker --concurrency=1 --loglevel=info -Q myflicker
```

- `--concurrency=1` **必须显式写**，这是"同一时刻只有一个 myflicker 进程"的唯一保证。
- 不要加 `--prefetch-multiplier` 其它值，不要在同一个 Redis 上再起第二个 worker；
  如需水平扩展，必须先解决 myflicker 自身的排他锁问题（否则会锁冲突）。
- 后台常驻（示例）：

```bash
nohup celery -A celery_tasks.celery_app worker --concurrency=1 --loglevel=info \
      -Q myflicker > logs/worker.log 2>&1 &
```

**第 3 步：启动 FastAPI 网关**

```bash
cd /Users/zhaojian/Desktop/cli2api-myflicker
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
# 或：python main.py   （读取 API_HOST / API_PORT）
```

生产环境可用 `--workers 2`（网关本身无状态，串行性由 worker 保证）。

**第 4 步：健康检查**

```bash
curl -s http://127.0.0.1:8000/api/myflicker/health \
  -H "X-API-Key: $API_KEY" | python3 -m json.tool
```

期望：`redis.ok=true`、`worker.ok=true`、`worker.online_workers>=1`。

## 5. curl 调用示例

```bash
export API_KEY="dev-local-key-please-change-0123456789"
export BASE="http://127.0.0.1:8000"
```

### 5.1 提交任务

```bash
curl -s -X POST "$BASE/api/myflicker/submit" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"args": ["list", "--verbose"], "timeout": 120, "source": "curl-smoke"}'
```

返回（HTTP 202，立即返回，不阻塞）：

```json
{
  "ok": true,
  "task_id": "0f3c9a1e7b6d4c2f9a8e5d1b3c7f2a90",
  "status": "pending",
  "submitted_at": "2026-11-09T08:00:00.000+00:00",
  "args": ["list", "--verbose"],
  "cmdline": "/usr/local/bin/myflicker list --verbose",
  "timeout": 120.0,
  "cwd": "/Users/zhaojian/Desktop/myflicker-workspace",
  "result_url": "/api/myflicker/result/0f3c9a1e7b6d4c2f9a8e5d1b3c7f2a90",
  "poll_hint_ms": 1000
}
```

错误示例：

```bash
# 缺 key / 错 key → 401
curl -s "$BASE/api/myflicker/result/<task_id>"
# {"ok":false,"error":{"code":"missing_api_key","message":"X-API-Key header is required"}}

# 参数非法 → 400/422
curl -s -X POST "$BASE/api/myflicker/submit" -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" -d '{"args": "list"}'
```

### 5.2 轮询结果

```bash
curl -s "$BASE/api/myflicker/result/<task_id>" -H "X-API-Key: $API_KEY"
```

进行中：

```json
{"ok": true, "task_id": "0f3c...", "status": "running",
 "submitted_at": "...", "started_at": "...", "finished_at": null,
 "duration_ms": null, "returncode": null, "timed_out": false,
 "cmd": ["/usr/local/bin/myflicker", "list", "--verbose"],
 "cmdline": "...", "cwd": "...", "timeout": 120.0, "source": "curl-smoke",
 "error": null, "finished": false, "poll_hint_ms": 1000}
```

成功：

```json
{"ok": true, "task_id": "0f3c...", "status": "success",
 "submitted_at": "...", "started_at": "...", "finished_at": "...",
 "duration_ms": 1834, "returncode": 0, "timed_out": false,
 "cmd": ["/usr/local/bin/myflicker", "list", "--verbose"],
 "cmdline": "...", "cwd": "...", "timeout": 120.0, "source": "curl-smoke",
 "error": null, "finished": true,
 "stdout": "PROJECT  ...", "stderr": ""}
```

失败（含超时）：`status=failure` + `returncode`（可能为 `-9`）+ `timed_out=true` + `error="timeout after 120.0s"`。

一条命令轮询到结束：

```bash
TASK_ID=$(curl -s -X POST "$BASE/api/myflicker/submit" \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"args":["list"]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['task_id'])")

while true; do
  BODY=$(curl -s "$BASE/api/myflicker/result/$TASK_ID" -H "X-API-Key: $API_KEY")
  echo "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'])"
  echo "$BODY" | grep -q '"finished": *true' && { echo "$BODY" | python3 -m json.tool; break; }
  sleep 2
done
```

带服务端事件日志（排查用）：

```bash
curl -s "$BASE/api/myflicker/result/$TASK_ID?include_events=true" -H "X-API-Key: $API_KEY"
```

## 6. test_client.py 用法

```bash
source .venv/bin/activate

# 自动读取 .env 里的 API_KEY；未知参数全部透传给 myflicker
python test_client.py list --verbose

# 指定超时 / 工作目录 / 扩展环境变量
python test_client.py run --file ./demo.json --timeout 600 \
  --cwd /Users/zhaojian/Desktop/myflicker-workspace \
  --env MYFLICKER_TOKEN=abc --env NO_COLOR=1

# 调整轮询策略并打印服务端事件
python test_client.py --poll-interval 2 --max-retries 100 --max-wait 600 \
  --show-events list --verbose

# 指向远端网关
python test_client.py --api-url http://10.0.0.8:8000 --api-key "$API_KEY" list
```

输出示例：

```
[08:00:00] SUBMIT url=http://127.0.0.1:8000/api/myflicker/submit args=['list', '--verbose']
[08:00:00] SUBMITTED task_id=0f3c... status=pending timeout=300.0 poll_hint_ms=1000
[08:00:01] POLL #1 status=running elapsed=1.0s started_at=2026-11-09T08:00:01.102+00:00 returncode=None
[08:00:03] POLL #2 status=success elapsed=2.8s started_at=... returncode=0
[08:00:03] FINISHED task_id=0f3c... status=success wall=2.8s
------------------------------------------------------------------------------
status      : success
returncode  : 0
...
--- stdout ---
PROJECT  ...
--- stderr ---

------------------------------------------------------------------------------
[08:00:03] RESULT: success
```

退出码：`0` 成功 / `1` myflicker 失败或超时 / `2` 客户端或网关错误（鉴权、连接、轮询耗尽）。

## 7. 日志：位置与格式

| 位置 | 内容 |
| --- | --- |
| `logs/myflicker_tasks.jsonl` | **统一全链路日志**，所有任务的所有事件按时间追加，一行一个 JSON |
| `logs/tasks/<task_id>.jsonl` | **单任务独立日志**，同一事件流，只含该 task_id |
| `logs/tasks/<task_id>.stdout.txt` | 该次运行的完整 stdout（不截断） |
| `logs/tasks/<task_id>.stderr.txt` | 该次运行的完整 stderr（不截断） |
| worker / uvicorn 的 stdout | 同一份事件的纯文本版本（`logging` 输出） |

JSONL 每行字段：`ts`(UTC ISO8601)、`level`、`event`、`task_id`、`pid`、`host`，外加该事件特有字段。
事件类型与出现顺序：

| event | 触发点 | 关键字段 |
| --- | --- | --- |
| `task.submitted` | 网关收到提交 | `args`, `source`, `client_ip`, `user_agent`, `timeout`, `cwd` |
| `task.enqueued` / `task.enqueue_failed` | 入队结果 | `queue`, `celery_task_id` / `error` |
| `task.started` | worker 开始执行 | `celery_task_id`, `command`, `cmdline`, `cwd`, `timeout` |
| `process.started` | 子进程拉起成功 | `pid`, `command` |
| `process.spawn_failed` | 可执行文件/目录/cwd 异常 | `error` |
| `process.timeout` | 命中 subprocess 超时并杀进程组 | `pid`, `timeout`, `reason` |
| `process.stdout` / `process.stderr` | 每次运行结束落盘输出 | `bytes`, `content`(截断), `file` |
| `task.finished` | 汇总 | `status`, `returncode`, `timed_out`, `duration_ms`, `error`, `cmdline`, `cwd` |

查看：

```bash
tail -f logs/myflicker_tasks.jsonl | python3 -m json.tool --json-lines
cat logs/tasks/<task_id>.jsonl | python3 -m json.tool --json-lines
```

日志写入失败不会中断任务（写入被 try/except 包裹，只会在 worker stdout 报错）。

## 8. DeepSeek Harness（Agent）接入逻辑

Agent 侧只有两条动作，**先 submit 拿 task_id，再循环轮询 result**，永不等待同步返回。

### 8.1 工具（function calling）定义

```json
[
  {
    "name": "myflicker_submit",
    "description": "提交一个 myflicker CLI 任务，立即返回 task_id（状态 pending）。",
    "parameters": {
      "type": "object",
      "properties": {
        "args": {"type": "array", "items": {"type": "string"},
                 "description": "myflicker 参数列表，例如 [\"list\", \"--verbose\"]"},
        "timeout": {"type": "number", "description": "超时秒数，默认取自服务端配置"},
        "cwd": {"type": "string", "description": "可选，工作目录"},
        "env": {"type": "object", "additionalProperties": {"type": "string"}}
      },
      "required": ["args"]
    }
  },
  {
    "name": "myflicker_result",
    "description": "查询 myflicker 任务结果：pending/running/success/failure。",
    "parameters": {
      "type": "object",
      "properties": {"task_id": {"type": "string"}},
      "required": ["task_id"]
    }
  }
]
```

### 8.2 Agent 侧调用流程（Python 伪代码，可直接改成工具实现）

```python
import time, httpx

BASE = "http://127.0.0.1:8000"
HEADERS = {"X-API-Key": "<API_KEY>"}

def myflicker_submit(args, timeout=None):
    body = {"args": args, "source": "deepseek-harness"}
    if timeout:
        body["timeout"] = timeout
    r = httpx.post(f"{BASE}/api/myflicker/submit", headers=HEADERS, json=body, timeout=30)
    r.raise_for_status()
    return r.json()["task_id"]          # 立刻返回，交给 Agent 记住

def myflicker_result(task_id):
    r = httpx.get(f"{BASE}/api/myflicker/result/{task_id}", headers=HEADERS, timeout=30)
    if r.status_code == 404:
        return {"status": "failure", "error": "task expired or unknown"}
    r.raise_for_status()
    return r.json()

def run_and_wait(args, timeout=None, max_wait=600, interval=1.0):
    task_id = myflicker_submit(args, timeout)
    deadline = time.time() + max_wait
    while time.time() < deadline:
        res = myflicker_result(task_id)
        if res["status"] in ("success", "failure"):
            return res                     # 交给模型：stdout/stderr/returncode/error
        time.sleep(res.get("poll_hint_ms", 1000) / 1000 * interval)
    return {"status": "failure", "task_id": task_id, "error": "client gave up waiting"}
```

Harness 侧的硬性约定：

1. `X-API-Key` 从环境变量读取，不写进 prompt、不写进对话历史。
2. submit 之后**必须**保存 `task_id`；同一任务不要重复 submit（myflicker 串行，重复提交只会排队浪费时间）。
3. 轮询间隔取响应里的 `poll_hint_ms`（默认 1000ms），并做指数退避，最长不超过 5s。
4. 结束条件是 `finished == true`（即 `status in ("success","failure")`），不要用 HTTP 200 判断成功。
5. `status=failure` 时把 `stderr` + `returncode` + `error`（可能是 `timeout after Xs`）一起回填给模型，由模型决定是否改参数重试。
6. 工具超时（客户端 `httpx` timeout）要大于"提交接口"本身的耗时（submit 是毫秒级），轮询接口同样毫秒级，无长连接。

## 9. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| submit 返回 202 但状态一直 pending | worker 没起或队列名不一致：检查 `celery ... -Q myflicker` 与 `CELERY_QUEUE` |
| `health` 里 `worker.ok=false` | worker 未启动 / broker db 不一致（检查 `CELERY_BROKER_URL`） |
| `error="executable not found"` | `MYFLICKER_BIN` 路径错或不可执行（`chmod +x`） |
| `error="cwd not found"` | `MYFLICKER_CWD` 或请求里的 `cwd` 不存在 |
| `status=failure, returncode=-9` | 命中超时，进程组被 SIGKILL；调大 `timeout` 或 `DEFAULT_TIMEOUT` |
| 任务并发时快时慢 | 队列在串行排队（正常）；不要为了提速加 `--concurrency>1`，会触发 myflicker 锁冲突 |
| `result` 返回 404 | 超过 `RESULT_TTL` 已过期，或 task_id 拼错 |

## 10. 自检清单

- [ ] `redis-cli ping` 返回 `PONG`
- [ ] `.env` 里 `API_KEY`、`MYFLICKER_BIN`、`MYFLICKER_CWD` 已填真实值
- [ ] worker 命令包含 `--concurrency=1`，日志出现 `concurrency: 1`
- [ ] `GET /api/myflicker/health` 返回 `redis.ok=true`、`worker.ok=true`
- [ ] 不带 `X-API-Key` 请求返回 **401**；错误 key 也返回 **401**
- [ ] `POST /api/myflicker/submit` 在 **1 秒内**返回 202 + `task_id`（不阻塞）
- [ ] 立刻查询该 task 得到 `pending` 或 `running`，轮询后变为 `success`
- [ ] `success` 响应里包含 `returncode`、`stdout`、`stderr`、`cmd`
- [ ] 故意提交 `{"args":["--nope"]}` 或让命令 sleep 超时，得到 `status=failure` 且 `timed_out=true`
- [ ] 连续提交 3 个任务，worker 日志显示它们的执行区间**互不重叠**（串行）
- [ ] `logs/myflicker_tasks.jsonl` 生成，且每个 task_id 有 `task.submitted → task.started → process.started → process.stdout → task.finished`
- [ ] `logs/tasks/<task_id>.jsonl`、`<task_id>.stdout.txt`、`<task_id>.stderr.txt` 均生成且非空
- [ ] `python test_client.py list --verbose` 退出码 0，并打印完整 stdout
