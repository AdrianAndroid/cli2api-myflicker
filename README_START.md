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
- 每 key 一个 `--concurrency=1` worker：用户内串行、用户间并行；`worker_prefetch_multiplier=1` + `task_acks_late=True`。

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
python worker_supervisor.py   # 每个 API_KEY 一个 --concurrency=1 的 worker
```

> 重要：**myflicker 的锁是按工作目录的**，不同目录可以并行。监督器给每个 API key
> 起一个独立的串行 worker（队列 `myflicker:<label>`），于是：
> **同一个用户的任务严格串行（不撞锁），不同用户之间并行（不用排队）**。
> `API_KEYS` 增删后，监督器会在几秒内自动增减 worker，无需重启网关。

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
| 同一用户任务变慢 | 该用户自己的队列在串行（正常）；不要给单个 worker 加 `--concurrency>1`，同目录并发会撞 myflicker 锁 |
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
- [ ] 连续提交 3 个任务（同一个 key），执行区间**互不重叠**（用户内串行）
- [ ] 两个 key 同时各提交一个任务，两个 worker **同时执行**（用户间并行）
- [ ] `logs/myflicker_tasks.jsonl` 生成，且每个 task_id 有 `task.submitted → task.started → process.started → process.stdout → task.finished`
- [ ] `logs/tasks/<task_id>.jsonl`、`<task_id>.stdout.txt`、`<task_id>.stderr.txt` 均生成且非空
- [ ] `python test_client.py list --verbose` 退出码 0，并打印完整 stdout

## 11. 局域网提供服务（LAN 模式）

`.env` 里把 `API_HOST` 设为 `0.0.0.0`（桌面端的「局域网」页可一键切换），服务即可被同网段机器访问。

```
LAN 客户端 ──HTTP + X-API-Key──►  http://<你的 IP>:8000   （或 http://<host>.local:8000）
                                         │
                                  网关做三重校验：来源 CIDR → API Key → 限流 → 队列背压
```

| 控制项 | `.env` key | 行为 |
| --- | --- | --- |
| 来源白名单 | `ALLOWED_CIDRS` | 非回环 IP 不在网段内 → `403 ip_not_allowed`；回环永远放行 |
| 鉴权 | `API_KEY` / `ADMIN_API_KEY` | task key 用于 submit/result/cancel；admin key 用于 `GET /tasks`（未设置时复用 task key） |
| 限流 | `RATE_LIMIT_PER_MIN` | 固定窗口，按 `key+IP` 计数，超限 `429` + `Retry-After` |
| 背压 | `MAX_QUEUE_DEPTH` | 串行队列已排队数 ≥ 上限 → `429 queue_full`（附 `queue_depth`），避免远端把队列堆爆 |
| 子命令白名单 | `ALLOWED_ARGS_REGEX` | 拼接后的 args 不匹配正则 → `400 arg_not_allowed` |

新增/扩展接口：

```bash
# 队列快照（需要 admin key）
curl -s "http://<IP>:8000/api/myflicker/tasks?limit=20" -H "X-API-Key: $ADMIN_KEY"

# 取消「还在排队」的任务（running 会返回 409，避免强杀 myflicker）
curl -s -X POST "http://<IP>:8000/api/myflicker/tasks/<task_id>/cancel" -H "X-API-Key: $API_KEY"

# /health 现在额外返回 bind / lan_enabled / lan_urls / queue_depth / security
curl -s "http://<IP>:8000/api/myflicker/health" -H "X-API-Key: $API_KEY" | python3 -m json.tool
```

注意事项：

1. 网关只暴露 `submit` / `result` / `tasks` / `cancel` / `health`，**进程启停永远只在桌面端**。
2. macOS 需要在「系统设置 › 网络 › 防火墙」放行 python/uvicorn 的入站连接。
3. 只想本机用就把 `API_HOST` 改回 `127.0.0.1`，桌面端「局域网」页有开关。
4. `http://<host>.local:8000` 依赖 Bonjour/mDNS，IP 变化后仍可用。
5. 不要在公共 Wi-Fi 上把端口对公网暴露；确需如此请前置 TLS（`TLS_CERT`/`TLS_KEY` 或 Caddy）。

## 12. 桌面端控制台（desktop/）

Electron + React 写的本地控制台，负责**启停服务**和**调试任务**，本身不执行 myflicker。

```bash
cd desktop
npm install          # 首次
npm run build        # 构建渲染层（vite → desktop/dist）
npm start            # 启动桌面应用
```

`npm start` 打开窗口后：

| 页面 | 能做什么 |
| --- | --- |
| 任务 | 提交任务（args 逐项、timeout、cwd、env），列表实时刷新，查看 stdout/stderr/事件链，取消排队任务 |
| 聊天 | 用自然语言行（其实是 myflicker 参数）连续测试，`/timeout`、`/cwd`、`/env K=V` 会话级指令 |
| 日志 | worker/api/redis 实时输出，关键字过滤、暂停、打开日志文件 |
| 局域网 | 本机/LAN 切换、展示调用地址（IP 与 `.local`）、Key 掩码与轮换、安全策略、curl 示例 |
| 设置 | `.env` 结构化编辑（文件/目录选择器）、保存后提示重启 |

启动顺序由主进程状态机控制：`Redis → FastAPI → Worker(--concurrency=1) → /health 自检`；
停止顺序反向，Worker 给 10s 优雅退出，超时对**整个进程组** SIGKILL。
已经手动起了服务时会自动「复用」而不是重复拉起（避免双 worker 破坏串行）。

调试与打包：

```bash
npm run typecheck    # 渲染层类型检查
npm run dist:mac     # dmg（未签名，仅本机自用）
npm run dist:win     # nsis
npm run dist:linux   # AppImage
```

截图自检（无头验证 UI 是否正常渲染）：

```bash
MYFLICKER_DESKTOP_AUTOSTART=1 \
MYFLICKER_DESKTOP_CAPTURE=/tmp/ui.png \
MYFLICKER_DESKTOP_CAPTURE_DELAY_MS=12000 \
MYFLICKER_DESKTOP_SMOKE=1 npm start
```

桌面端日志：`logs/desktop/{worker,api,redis}.log`（环形缓冲 3000 行 + 文件追加）。

### 12.1 打包产物里到底有什么

`npm run dist:mac`（或 `electron-builder --mac --dir`）产出的 `.app` 里：

| 位置 | 内容 |
| --- | --- |
| `Contents/Resources/app.asar` | 渲染层 `dist/` + Electron 主进程代码（`electron/*.cjs`）+ React 依赖 |
| `Contents/Resources/backend/` | **Python 后端源码**：`main.py`、`celery_tasks.py`、`requirements.txt`、`.env.example`、`mock_myflicker.sh`、`test_client.py`、`README_START.md` |
| 用户数据目录（不在包内） | `.env`、`.venv`、`logs/`、`workspace/`，首次运行时自动生成 |

用户数据目录：

| 平台 | 路径 |
| --- | --- |
| macOS | `~/Library/Application Support/myflicker-desktop/` |
| Windows | `%APPDATA%\myflicker-desktop\` |
| Linux | `~/.config/myflicker-desktop/` |

首次启动做了什么：

1. 把包内 `.env.example` 复制成用户数据目录下的可写 `.env`（权限 600），并写入随机 `API_KEY`、`LOG_DIR`、`MYFLICKER_CWD`（`…/workspace`）、`REDIS_BIN`（自动探测 brew 路径）。
2. 检测 Python 运行环境：没有 `.venv` 或缺依赖时，顶部出现黄色横幅 **「运行环境未就绪」**，点 **初始化运行环境** 即在数据目录建 venv 并 `pip install -r requirements.txt`，进度实时打到 `setup.log`。
3. 就绪后再点「启动服务」，状态机才去拉 Redis / FastAPI / Worker。

命令行等价操作（CI / 排查用）：

```bash
# 只打 app 目录，不生成 dmg（最快验证打包内容）
cd desktop && npx electron-builder --mac --dir
ls release/mac-arm64/myflicker.app/Contents/Resources/backend/

# 无头跑一遍：初始化 + 启动 + 截图
MYFLICKER_DESKTOP_INIT=1 MYFLICKER_DESKTOP_AUTOSTART=1 \
MYFLICKER_DESKTOP_CAPTURE=/tmp/ui.png MYFLICKER_DESKTOP_CAPTURE_DELAY_MS=15000 \
MYFLICKER_DESKTOP_SMOKE=1 \
./release/mac-arm64/myflicker.app/Contents/MacOS/myflicker
```

需要注意：

- 包里 **不含** Python 解释器、`.venv`、`redis-server`：分别依赖本机 `python3`（≥3.9）和系统 Redis（或 `.env` 里的 `REDIS_BIN`）。
- 开发模式与打包模式的路径：开发用仓库根目录的 `.env`；打包后读用户数据目录的 `.env`。想强制指定后端源码目录，设 `MYFLICKER_PROJECT_ROOT=/path/to/repo`。
- 想让一次运行使用独立的数据目录（`.env`/`.venv`/`logs`/单实例锁全隔离，做测试或并行演示时用），设 `MYFLICKER_DESKTOP_DATA_DIR=/tmp/mf-test-data`。
- 截图自检默认是**无头**的（窗口 `show:false` + 不抢焦点 + Dock 隐藏），不会打断正在使用电脑的人；具体纪律见 `AGENTS.md`。
- 未做代码签名/公证：`.app` 在本机可运行，分发给别人会被 Gatekeeper 拦；需要你的 Apple Developer 证书。
- `MYFLICKER_BIN` 在打包后默认是 `.env.example` 里的值，**必须**在设置页改成真实 myflicker 路径（或用 `mock_myflicker.sh` 自测）。

## 13. OpenAI 兼容接口（/v1）

同一进程额外挂了一套 OpenAI Chat Completions 协议，任何 OpenAI SDK / Agent 框架把 `base_url` 指过来即可。

```bash
BASE=http://127.0.0.1:8000
curl -s $BASE/v1/models -H "Authorization: Bearer $API_KEY"

curl -s -X POST $BASE/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"myflicker-agent","messages":[{"role":"user","content":"列出当前目录结构"}],"timeout":180}'

# 流式（SSE，增量来自 myflicker 的 stdout）
curl -sN -X POST $BASE/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"myflicker-agent","stream":true,"messages":[{"role":"user","content":"hello"}]}'
```

Python（官方 openai SDK，无需改代码逻辑）：

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="<API_KEY>")
resp = client.chat.completions.create(
    model="myflicker-agent",
    messages=[{"role": "user", "content": "列出当前目录结构"}],
    timeout=180,
)
print(resp.choices[0].message.content)
```

映射规则（很关键）：

| OpenAI 字段 | 映射到 myflicker |
| --- | --- |
| `messages[]` | 拼成一个 prompt（单条消息原样；多条消息按 `role: content` 连接） |
| 默认参数 | `-q`（非交互）。带上 `-c` 需要自己传 `myflicker_args: ["-q","-c"]` |
| `myflicker_args`（扩展字段） | 覆盖默认参数，例如 `["-q","--model","doubao-seed"]` |
| `cwd` / `env`（扩展字段） | 工作目录与额外环境变量 |
| `timeout` | 单次任务超时（秒），上限 `MAX_TIMEOUT` |
| `stream: true` | SSE 增量，chunk 来自 worker 实时推送的 stdout |
| `model` | 仅作标识，透传到响应；不参与路由 |

实现要点：

- 每个请求 = 一条 Celery 任务（`myflicker.run`），仍然只有一个 `--concurrency=1` 的 worker，**不会并发拉起 myflicker**。
- 响应体是标准 `chat.completion`（`id/object/created/model/choices/usage`），额外附一个 `x_myflicker` 字段：`task_id / status / returncode / duration_ms / cmdline / stderr`，方便排障；OpenAI SDK 会忽略它。
- `usage` 是**估算值**（按字符数 /4 粗算），myflicker 不返回真实 token 数。
- 失败时 `finish_reason` 为 `error`，内容里带 `[myflicker failed: …]` 与 stderr，HTTP 仍返回 200（符合 OpenAI 客户端预期）；请求本身不合法才返回 4xx，鉴权失败返回 401 且是 OpenAI 错误结构。

不支持的（明确说清楚，避免误判）：`tools/function calling`、`response_format`、图片/音频多模态输入、`logprobs`、`n>1`、`temperature` 等采样参数（CLI 不接受这些概念，传了也不生效）。

## 14. 多人共享 / 局域网：上下文如何隔离

结论先说：**myflicker 的会话是按「工作目录」归属的**（`~/.myflicker/projects/<cwd 编码>/`），
`-c/--continue` 只续当前目录最近一次会话。所以只要给每个调用方一个独立目录，对话上下文就天然隔离。

实测（同一台机器）：

```
/tmp/iso-a: myflicker -q "记住 42"                 → OK
/tmp/iso-a: myflicker -q -c "我刚才让你记的数字"     → 42        （续到自己的会话）
/tmp/iso-b: myflicker -q -c "我刚才让你记的数字"     → 这是本对话的第一条消息…   （看不到 a 的上下文）
```

配置：

```ini
# .env
API_KEYS=alice:<key-a>,bob:<key-b>     # 每个 label 一个 key
WORKSPACE_ROOT=/Users/zhaojian/Library/Application Support/myflicker-desktop/workspace
SANDBOX_ENFORCE=1                      # 非回环调用方只能用自己的 workspace
```

行为：

| 维度 | 结果 |
| --- | --- |
| 会话/上下文 | **隔离**：`<WORKSPACE_ROOT>/<label>/` 各自一份，`-c` 只续自己的 |
| 文件 | **隔离**：默认 cwd 就是自己的 workspace；局域网调用方越界（`/etc`、别人的目录）→ `403 cwd_outside_workspace` |
| 任务可见性 | **隔离**：任务记 `owner`，别人的 task_id 查出来是 `404`（不泄露存在性）；`/tasks` 只列自己的 |
| 模型额度/登录态 | **共享**：同一个 `~/.myflicker` 凭证，费用算你的（这是你接受的部分） |
| skills / rules / MCP | 共享（同一份配置） |
| 并发 | 共享一个 `--concurrency=1` worker，任务排队 |

注意：

- 换 `HOME` 并不能做更彻底的隔离：myflicker 的登录态不在 `~/.myflicker` 里，换 HOME 会直接
  `Authentication required`。所以「共享额度 + 隔离上下文」就用上面的 workspace 方案。
- 首次访问某个 label 时后端会自动创建 `<WORKSPACE_ROOT>/<label>/uploads/`。
- 本机（127.0.0.1）默认不受沙箱限制，方便你用桌面端在任意仓库里跑；要连本机也限制，设
  `SANDBOX_ENFORCE_LOOPBACK=1`。

给同事发什么：

```bash
# 让对方执行
export BASE=http://172.24.121.94:8000
export KEY=<alice 对应的 key>

curl -s $BASE/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"myflicker-agent","messages":[{"role":"user","content":"看一下你工作区里的文件"}]}'
```

对方看到的永远是自己的 workspace，看不到你的、也看不到其他人的对话。

