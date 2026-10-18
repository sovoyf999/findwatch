// src/worker.js —— Cloudflare Workers 变体（真·常驻服务形态）
// 复用同一套 finders.js / notifier.js。Cron 触发时轮询；也可通过 HTTP 管理目标。
//
// ⚠️ 免费版限制：每次调用（含 Cron）仅 10ms CPU 时间。只能跑极少量、超轻量的目标；
//    真要实用请升级 Workers Paid（$5/月，Cron CPU 提到 30s）。详见 README。

import { checkTarget } from '../finders.js';
import { notify } from '../notifier.js';

export default {
  async scheduled(event, env, ctx) {
    const targets = JSON.parse((await env.WATCH_KV.get('targets')) || '[]');
    const state = JSON.parse((await env.WATCH_KV.get('state')) || '{}');

    const active = targets.filter((t) => t.active !== false && !state[t.id]?.disabled);
    for (const t of active) {
      try {
        const prev = state[t.id] || {};
        const res = await checkTarget(t);
        const found =
          t.type === 'change'
            ? prev.fingerprint
              ? res.fingerprint !== prev.fingerprint
              : false
            : res.found;

        if (found && !prev.found) {
          await notify(
            env,
            t.channel || env.NOTIFY_CHANNEL,
            `🔔 找到目标：${t.name || t.id}`,
            `匹配达成（${res.detail}）\n${t.url}`
          );
        }
        state[t.id] = {
          found: Boolean(found),
          fingerprint: res.fingerprint,
          lastStatus: res.status,
          lastChecked: new Date().toISOString(),
        };
        if (t.notifyOnce !== false && found) state[t.id].disabled = true;
      } catch (e) {
        console.error('[err]', t.id, e.message);
      }
    }
    await env.WATCH_KV.put('state', JSON.stringify(state));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('Authorization') || '';
    if (!auth || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (url.pathname === '/api/targets') {
      if (request.method === 'GET') {
        return new Response((await env.WATCH_KV.get('targets')) || '[]', {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (request.method === 'POST') {
        const t = await request.json();
        const list = JSON.parse((await env.WATCH_KV.get('targets')) || '[]');
        list.push(t);
        await env.WATCH_KV.put('targets', JSON.stringify(list, null, 2));
        return new Response('created', { status: 201 });
      }
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const list = JSON.parse((await env.WATCH_KV.get('targets')) || '[]').filter((x) => x.id !== id);
        await env.WATCH_KV.put('targets', JSON.stringify(list, null, 2));
        return new Response('deleted');
      }
    }
    return new Response('findwatch worker', { status: 200 });
  },
};
