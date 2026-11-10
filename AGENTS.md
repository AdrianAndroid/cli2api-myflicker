# 工作约定（AI agent 必读）

本项目是「私有 CLI myflicker → HTTP 网关 + 本地桌面控制台」。以下是**硬性约定**，任何自动化测试、验证、演示都必须遵守。

## 1. 测试时不得打扰使用者

1. **禁止抢占焦点**：不要用 `open -a`、`open <app>`、`osascript -e 'activate ...'`、`tell application ... to activate` 之类会把窗口提到前台的操作。
2. **截图验证必须无头**：用 `MYFLICKER_DESKTOP_CAPTURE=/tmp/x.png`（主进程会自动 `show:false` + `focusable:false` + `app.dock.hide()`），配合 `MYFLICKER_DESKTOP_SMOKE=1` 跑完自动退出。
3. **不要置前、不要弹窗**：任何会让用户当前工作被打断的行为（对话框、通知、声音、全屏、Dock 弹跳）都不做。
4. 只有在用户明确说「打开/启动给我看」时，才可以真正启动 GUI。

## 2. 测试必须隔离

1. **独立数据目录**：测试一律设置 `MYFLICKER_DESKTOP_DATA_DIR=/tmp/mf-test-data`。
   这会同时隔离 `.env`、`.venv`、`logs/` 和**单实例锁**（否则用户开着 App 时测试进程会被直接退出）。
2. **独立端口 / Redis DB**：测试用 `.env` 里把 `API_PORT` 改成 8010 之类的非默认端口，`REDIS_URL` / `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` 用独立 db（如 `/8`、`/9`、`/10`）。
3. **不要动用户的服务**：
   - 不要 `pkill -f uvicorn|celery|python`，不要 `redis-cli shutdown`；
   - 只停止「自己 spawn 的」进程（`ServiceManager` 的 `owns` 标记就是这么做的），别对外部实例动手。
4. **不要覆盖已安装的 App**：`/Applications/myflicker-console.app` 属于用户。验证打包用 `desktop/release/mac-arm64/` 或复制到 `/tmp` 再跑；升级安装要等用户开口。
5. **不要修改用户的真实配置/日志**：仓库根 `.env`、`~/Library/Application Support/myflicker-desktop/`（或等价数据目录）都视为用户资产，测试不写入。

## 3. 标准无头测试命令

```bash
# 1) 准备隔离配置（首次）
mkdir -p /tmp/mf-test-data
cp .env /tmp/mf-test-data/.env      # 再把 API_PORT / REDIS_* / LOG_DIR 改成测试值

# 2) 无头跑：不弹窗、不抢焦点，跑完自动退出
cd desktop
MYFLICKER_DESKTOP_DATA_DIR=/tmp/mf-test-data \
MYFLICKER_DESKTOP_AUTOSTART=1 \
MYFLICKER_DESKTOP_CAPTURE=/tmp/ui.png \
MYFLICKER_DESKTOP_CAPTURE_DELAY_MS=12000 \
MYFLICKER_DESKTOP_SMOKE=1 \
./release/mac-arm64/myflicker.app/Contents/MacOS/myflicker

# 3) 只跑后端（不涉及 UI）
API_PORT=8010 REDIS_URL=redis://127.0.0.1:6379/8 \
CELERY_BROKER_URL=redis://127.0.0.1:6379/9 CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/10 \
celery -A celery_tasks.celery_app worker --concurrency=1 -Q myflicker
```

## 4. 除此之外

- 提交/推送代码前先让用户确认。
- 不改与任务无关的文件，不动 `~/.myflicker`。
- 测试完成后清理自己产生的 `/tmp` 目录与进程，检查 `pgrep -fl "uvicorn main:app|celery -A celery_tasks"` 应为 0。
