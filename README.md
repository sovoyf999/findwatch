# findwatch —— 7×24 免费持续查找监视器

**一句话**：持续查找你指定的目标内容/资源，**找到时主动通知你，没找到时保持静默、绝不打扰**。免费、无需信用卡、7×24 运行。

代码一次编写，提供三种运行形态：
- **GitHub Actions 定时任务（推荐，主形态，免费云端）**：放进**公开仓库即无限分钟免费**，5 分钟粒度，无 CPU 时间上限，跑真实 Node。**完全在 GitHub 云端、不占你本机**，是「挂到云端 + 免费 + 不本地」的直接落地方式。
- **Cloudflare Worker + Cron（常驻服务形态，免费云端）**：真·常驻，我们已有部署通道；免费版每调用仅 10ms CPU，只适合极少量轻量目标（详见限制章）。
- **Docker 容器（常驻进程形态，需宿主机）**：`docker compose up` 即常驻；但**需要一台 24 小时开机的机器**。免费且无 Visa/MC 卡的常驻容器云基本不存在（Oracle 要 Visa/MC、LightNode ¥55/月）。Docker 形态适合你已有/愿购宿主机时使用。

> ⚠️ 现实约束：**「免费 + 云端 + 常驻 Docker 容器」三者不可兼得**（无 Visa/MC 卡时）。免费且云端的路径是 GitHub Actions / Cloudflare Worker（已是云端、不本地）；常驻 Docker 容器需要 Oracle(Visa/MC) 或付费轻量云。

---

## 一、查找目标的输入方式（明确）

目标以**结构化 JSON 数组**描述，每个元素一个监视项。两种注入途径：

**A. 配置文件（GitHub Actions 主形态）** —— 编辑仓库根目录 `targets.json`（参考 `targets.example.json`），提交即生效。

字段说明：
| 字段 | 必填 | 含义 |
|---|---|---|
| `id` | ✅ | 唯一标识，用于状态去重 |
| `name` | 否 | 通知里显示的名字 |
| `type` | ✅ | 查找方式（见下表） |
| `url` | ✅ | 目标地址（HTTP/HTTPS） |
| `match` | ✅* | 匹配条件（`type` 不同含义不同） |
| `headers` | 否 | 自定义请求头（如 User-Agent） |
| `method` | 否 | 默认 GET |
| `notifyOnce` | 否 | 默认 `true`：找到后只通知一次并**停用**该目标（适合「抢到就完事」的一次性目标）。设 `false` 进入**持续监视模式**：仅在「未命中→命中」跳变时通知一次，恢复后自动重新武装，**不会重复轰炸**（服务故障、版本发布这类长期盯的目标请用这个） |
| `channel` | 否 | 覆盖默认通知渠道 |
| `active` | 否 | 设 `false` 临时停用 |
| `timeoutMs` | 否 | 单次请求超时，默认 10000 |

`type` 与 `match` 的对应：
| type | match 含义 | 典型用途 |
|---|---|---|
| `status` | 期望的 HTTP 状态码（数字） | 监视「页面恢复可访问(200)」「接口报错(非200)」 |
| `contains` | 响应体需包含的字符串 | 监视「到货/有货/某关键词出现」 |
| `not_contains` | 响应体需**不再**包含的字符串 | 监视「售罄字样消失」 |
| `change` | 无需 match，内容指纹变化即命中 | 监视「网页/接口内容有更新」 |
| `json` | `{ "path": "a.b", "equals": true }` | 监视「接口字段变为某值」 |

**B. HTTP 管理 API（Cloudflare Worker 形态）** —— 受 `ADMIN_TOKEN` 保护：
- `GET /api/targets` 列出
- `POST /api/targets`（Bearer 令牌）新增，body 为单个目标对象
- `DELETE /api/targets?id=xxx` 删除

> 动态增删目标用 B；版本化、可审查用 A。两者核心字段完全一致。

---

## 二、服务器的运行环境（明确）

| 形态 | 运行环境 | 触发方式 | 状态存储 |
|---|---|---|---|
| GitHub Actions | GitHub 托管 Ubuntu  runner（Node 20） | `cron: '*/5 * * * *'`（每 5 分钟） | 仓库内 `state.json`（自动提交回写） |
| Cloudflare Worker | Cloudflare 全球边缘（V8 isolate） | Cron Trigger（每 5 分钟） | KV 命名空间 `WATCH_KV` |

核心逻辑（`finders.js` 查找器 + `notifier.js` 通知器）**同时兼容 Node 与 Workers**（纯用全局 `fetch` / Web Crypto / `btoa`，无第三方依赖）。本地 `node watcher.js` 可直接调试。

---

## 三、资源与并发限制（明确）

### GitHub Actions 形态（推荐）
- **分钟额度**：公开仓库 **无限分钟、免费**；私有仓库 2000 分钟/月（Free 计划），超出即停（默认 $0 消费上限，不会自动扣费）。
- **最小调度间隔**：5 分钟（GitHub 硬限制；实际可能延迟数分钟，视为近似）。
- **单次任务上限**：6 小时；本任务秒级完成。
- **并发任务数**：Free 20（本任务仅 1 个 job）。
- **本程序并发**：目标检查用 `CONCURRENCY`（默认 5）的协程池并行 fetch，避免串行过慢；调高可加速但更费分钟数。
- **免费可行性**：公开仓库 + 5 分钟粒度 + 任务 10~30 秒 ≈ 每月约 1440~4320 分钟，**公开仓库无限、零成本**；私有仓库建议用 15 分钟粒度（≈720 分钟/月）以留余量。

### Cloudflare Workers 形态（常驻，受限于免费额度）
- **请求额度**：100,000 次/天（硬上限，超则当日停服直到 UTC 0 点）。
- **CPU 时间**：**免费版每次调用仅 10ms**（Cron 也 10ms）。注意：网络等待 `fetch()` 不计入 CPU，但 JS 计算（解析/哈希）会计入 —— 因此**免费版只能跑极少量（1~3 个）、超轻量目标**。
- **子请求数**：50 次/请求。
- **Cron 触发器**：免费账户 5 个/账号；最小间隔 1 分钟。
- **内存**：128 MB/isolate。
- **实用建议**：真要用 Worker 常驻且目标较多，请升级 Workers Paid（$5/月，Cron CPU 提到 30s、10,000 子请求）。本仓库 Worker 代码已就绪，升配即可直接用。

---

## 四、通知渠道的具体实现要求（明确）

**接口契约**（`notifier.js`）：`notify(env, channel, title, message)`。实现要求：
1. **只在状态跳变时发送**：调用方保证仅当「从未命中→命中」才调用；本程序 `notifyOnce`（默认 true）确保找到后停用该目标，**不会重复骚扰**。
2. **未命中/出错绝对静默**：未命中不调用通知；单个目标检查异常仅记录日志、跳过，**不向用户发送任何错误/打扰信息**。
3. **fail-safe**：通知发送失败只 `console.error` 后忽略，**绝不抛出**，不影响本轮其它目标，也不重试轰炸用户。
4. **凭据隔离**：所有令牌只从环境变量（GitHub Secrets / Worker env binding）读取，**不写日志、不进仓库**。

**已实现的渠道**（通过 `NOTIFY_CHANNEL` 或每个目标的 `channel` 选择）：

| 渠道 | 需要的环境变量 | 适用场景 |
|---|---|---|
| `telegram` | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | 全球可用；**国内需代理** |
| `dingtalk` | `DINGTALK_WEBHOOK` + `DINGTALK_SECRET` | **国内原生可达，推荐国内用户** |
| `webhook` | `NOTIFY_WEBHOOK` | 通用 POST JSON，兼容 ntfy / Discord / Bark 等 |
| `serverchan` | `SERVERCHAN_SENDKEY` | 推送到微信（免费额度有限） |
| `none` | — | 仅记录不发送（调试用） |

> 国内用户优先选 `dingtalk` 或 `serverchan`；若在境外/有代理可选 `telegram`。

---

## 五、部署步骤

### 形态 A：GitHub Actions（推荐，5 分钟上手）
1. 把本目录推到一个 **公开** GitHub 仓库（公开=无限免费分钟）。
2. 仓库 **Settings → Secrets → Actions** 添加：
   - `NOTIFY_CHANNEL`（如 `dingtalk`）
   - 对应渠道的凭据（如 `DINGTALK_WEBHOOK`、`DINGTALK_SECRET`）
3. 编辑 `targets.json`（照 `targets.example.json`），提交。
4. 从此每 5 分钟自动查找；命中即通知，`state.json` 自动回写。
5. 手动触发：`Actions → findwatch → Run workflow`。

### 形态 B：Cloudflare Worker
1. `npm i -g wrangler`；`wrangler login`。
2. `wrangler kv namespace create WATCH_KV`，把返回的 id 填入 `wrangler.toml`。
3. `wrangler secret put ADMIN_TOKEN` 及通知凭据。
4. 初始化目标：`wrangler kv key put --binding=WATCH_KV targets '[]'`。
5. `wrangler deploy`；之后用受保护的 `/api/targets` 动态增删目标。

---

### 形态 C：Docker（常驻进程 / 也可跑在 GitHub Actions 上）
- **自己有宿主机时（常驻 7×24）**：`docker compose up -d` 即可，容器以 `scheduler.js` 循环运行（`INTERVAL_MINUTES` 可调），`state.json` 通过卷持久化。
- **没有宿主机、想用免费云端跑 Docker**：直接让 GitHub Actions 拉起容器跑一轮即可（公开仓库无限免费分钟），见 `.github/workflows/watch-docker.yml`。每次定时触发时 `docker build` + `docker run node watcher.js` 跑一个周期，状态靠 `state.json` 回写保持。
  > 说明：Actions 上每个周期是一个「跑完即退出的临时容器」，不是单台永生容器；对轮询类任务功能等价且免费。若想要「单台容器 24 小时常驻在云端」，免费且无 Visa/MC 卡的云基本不存在（见顶部现实约束）。

## 六、本地调试
```bash
cp .env.example .env      # 填好凭据
cp targets.example.json targets.json
node watcher.js           # 跑一轮；命中会真实发通知，未命中静默
```

## 七、设计保证小结
- ✅ 找到目标 → **主动**通知（默认仅一次）
- ✅ 未找到 / 出错 → **完全静默**，不发送任何打扰信息
- ✅ 免费、7×24、无需信用卡
- ✅ 无第三方依赖，Node / Workers 双形态通用
