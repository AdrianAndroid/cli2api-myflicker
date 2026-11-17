# cli2api-myflicker

把私有 CLI `myflicker` 封装成异步 HTTP API：FastAPI + Redis + Celery（`--concurrency=1` 串行执行）。

- 快速开始 / 配置 / curl 示例 / 日志格式 / DeepSeek Harness 接入 / 局域网 / 桌面端 → [README_START.md](./README_START.md)
- 桌面控制台（Electron，启停服务 + 任务/聊天/日志/局域网/设置）→ [desktop/](./desktop)
- 代码：`main.py`（网关）、`openai_api.py`（/v1 兼容层）、`celery_tasks.py`（唯一执行入口）、`worker_supervisor.py`（每用户串行 worker）、`identity.py`（多租户/沙箱）
- **测试纪律（红线）**：见 [AGENTS.md](./AGENTS.md) 第 0 节 —— 测试不得抢焦点、不得弹窗、不得打断或重装用户在用的程序

```bash
cp .env.example .env      # 填 API_KEY / MYFLICKER_BIN / MYFLICKER_CWD
pip install -r requirements.txt
celery -A celery_tasks.celery_app worker --concurrency=1 --loglevel=info -Q myflicker
uvicorn main:app --host 0.0.0.0 --port 8000
```
