# 工作约定（AI agent 必读）

本项目是「私有 CLI myflicker → HTTP 网关 + 本地桌面控制台」。以下是**硬性约定**，任何自动化测试、验证、演示都必须遵守。

## 0. 最高优先级：测试不得打扰用户干活

**这是全仓库第一条规则，优先级高于任何"验证需要""演示需要""要看到效果"。**

用户在电脑前工作，测试必须完全隐形。以下行为一律禁止，没有例外：

| 禁止 | 举例 |
| --- | --- |
| 抢占窗口焦点 | `open -a`、`open <app>`、`osascript -e 'activate ...'`、`tell application … to activate`、Electron `win.show()/focus()` |
| 弹出任何界面 | 对话框、通知、系统弹窗、播放声音、Dock 弹跳、全屏、悬浮窗 |
| 打断/重启用户在用的程序 | `kill/quit` 用户的 App、覆盖安装 `/Applications/*`、停掉用户的 uvicorn/celery/redis |
| 覆盖用户文件 | 仓库根 `.env`、`~/.myflicker/**`、`~/Library/Application Support/myflicker-desktop/**`、用户正在跑的日志 |

判断标准只有一条：**如果用户此刻正在敲键盘/看屏幕，我的操作会不会让他丢失焦点、丢失窗口、丢失正在跑的任务？会，就不做。**

必须做可视化验证时：

1. 用无头截图（`MYFLICKER_DESKTOP_CAPTURE` + `SMOKE=1`），窗口 `show:false`、`focusable:false`、`dock.hide()`；
2. 数据目录用 `MYFLICKER_DESKTOP_DATA_DIR=/tmp/...`，端口/Redis 库都换掉；
3. 需要用户重启/重装/点按钮才能继续的，**先停下来问**，不要自作主张动他的运行环境。

## 1. 测试时不得打扰使用者（细则）

1. **截图验证必须无头**：`MYFLICKER_DESKTOP_CAPTURE=/tmp/x.png`（主进程自动 `show:false` + `focusable:false` + `app.dock.hide()`），配合 `MYFLICKER_DESKTOP_SMOKE=1` 跑完自动退出。
2. **不要置前、不要弹窗**：见第 0 节红线清单。
3. 只有用户明确说「打开/启动给我看」时，才可以真正启动 GUI；否则一律无头。

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

# 可选：无头模式预置 localStorage（当前只用于会话列表截图）
#   MYFLICKER_DESKTOP_STORAGE_SEED='{"myflicker.sessions.v1:local":{...}}'
#   仅在 MYFLICKER_DESKTOP_CAPTURE 存在时生效

# 3) 只跑后端（不涉及 UI）
API_PORT=8010 REDIS_URL=redis://127.0.0.1:6379/8 \
CELERY_BROKER_URL=redis://127.0.0.1:6379/9 CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/10 \
celery -A celery_tasks.celery_app worker --concurrency=1 -Q myflicker
```

## 4. 除此之外

- 提交/推送代码前先让用户确认。
- 不改与任务无关的文件，不动 `~/.myflicker`。
- 测试完成后清理自己产生的 `/tmp` 目录与进程，检查 `pgrep -fl "uvicorn main:app|celery -A celery_tasks"` 应为 0。

## 5. 规格驱动（OpenSpec）

本仓库用 OpenSpec 维护“系统现在怎么工作”（`openspec/specs/`）与“要改什么”（`openspec/changes/`）。

1. **动手前先读**：`openspec/specs/*/spec.md` 是行为基线；`openspec/changes/*/tasks.md` 是待办清单。
   只做清单里的项，发现清单与代码冲突时先改文档、再改代码。
2. **改行为必须改规格**：任何影响 HTTP 契约、隔离语义、并发模型、打包边界的提交，都要同步更新对应 spec
   （必要时新建 change，而不是直接改 specs/）。
3. **提交前校验**：`openspec validate --all --strict` 必须通过。
4. **不要手改 `openspec/changes/*/specs/` 的 delta 语义**：ADDED / MODIFIED 的标题不要混用。
5. 常用命令：

```bash
openspec list --changes            # 有哪些进行中的改动
openspec show <change>             # 查看某个改动的提案与任务
openspec validate --all --strict   # 校验
openspec archive <change>          # 完成后归档（delta 合并进 specs/）
```

6. 自动化测试依然遵守第 1–4 节：隔离端口/数据目录、不抢焦点、不动用户的实例与配置。

