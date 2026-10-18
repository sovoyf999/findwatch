// watcher.js —— 主循环（GitHub Actions / 本地运行）。每次调用 = 执行一个完整轮询周期。
// 设计保证：
//   - 命中目标 -> 仅在「从未命中 -> 命中」跳变时通知一次（notifyOnce 默认 true）。
//   - 未命中 / 出错 -> 完全静默，不发送任何信息。
//   - 单个目标出错不影响其它目标。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { checkTarget } from './finders.js';
import { notify } from './notifier.js';

const TARGETS_FILE = process.env.TARGETS_FILE || 'targets.json';
const STATE_FILE = process.env.STATE_FILE || 'state.json';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 5);

function loadJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function runOnce(env) {
  const targets = loadJSON(TARGETS_FILE, []);
  const state = loadJSON(STATE_FILE, {});

  // 只跑启用且未被「找到后停用」的目标
  const active = targets.filter((t) => t.active !== false && !state[t.id]?.disabled);
  console.log(`[watch] 本次检查 ${active.length} 个目标（共 ${targets.length} 个）`);

  for (let i = 0; i < active.length; i += CONCURRENCY) {
    const batch = active.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const prev = state[t.id] || {};
          const res = await checkTarget(t);

          let found;
          if (t.type === 'change') {
            // 首次只有基线、无历史指纹，不视为「变化」，仅建立基线
            found = prev.fingerprint ? res.fingerprint !== prev.fingerprint : false;
            res.detail = found ? '内容已变化' : prev.fingerprint ? '内容未变' : '已建立基线';
          } else {
            found = res.found;
          }

          if (found && !prev.found) {
            // 状态跳变：主动通知
            const title = `🔔 找到目标：${t.name || t.id}`;
            const msg = `匹配条件达成（${res.detail}）\nURL: ${t.url}`;
            await notify(env, t.channel || env.NOTIFY_CHANNEL, title, msg);
            console.log(`[notify] ${t.id}: ${res.detail}`);
          } else if (!found) {
            // 未命中：保持静默
            console.log(`[silent] ${t.id}: 未命中（${res.detail}）`);
          } else {
            // 已命中且非首次：不再重复通知
            console.log(`[skip] ${t.id}: 已命中，不再重复通知`);
          }

          const newState = {
            found: Boolean(found),
            fingerprint: res.fingerprint,
            lastStatus: res.status,
            lastChecked: new Date().toISOString(),
            detail: res.detail,
          };
          // 默认找到后停用该目标，避免反复通知（置 notifyOnce:false 可改为每次都通知）
          if (t.notifyOnce !== false && found) newState.disabled = true;
          return [t.id, newState];
        } catch (e) {
          // 检查出错：静默记录，不影响整体
          console.error(`[error] ${t.id}: ${e.message}（已忽略）`);
          return [t.id, { ...(state[t.id] || {}), error: e.message, lastChecked: new Date().toISOString() }];
        }
      })
    );
    for (const [id, st] of results) state[id] = st;
  }

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('[watch] 本轮结束');
}

export { runOnce };

// 仅当作独立脚本执行时才自动跑一轮并退出（被 scheduler.js import 时不触发）
if (import.meta.url === `file://${process.argv[1]}`) {
  runOnce(process.env)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
