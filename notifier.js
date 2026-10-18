// notifier.js —— 通知器：命中目标后主动通知用户。
// 设计原则：
//   1. 仅在「从未命中 -> 命中」的状态跳变时发送（调用方控制），本身 fail-safe：
//      通知发送失败只记录错误、绝不抛出，不影响其它目标，也不向用户报错式骚扰。
//   2. 凭据只从 env 读取（GitHub Secrets / Worker env binding），不写进日志、不进仓库。
//   3. 兼容 Node（env=process.env）与 Cloudflare Workers（env=ctx.env）。

/**
 * 主动通知入口
 * @param {object} env 环境变量（凭据所在）
 * @param {string} channel 渠道名：telegram | dingtalk | webhook | serverchan | none
 * @param {string} title 标题
 * @param {string} message 正文
 */
export async function notify(env, channel, title, message) {
  channel = channel || env.NOTIFY_CHANNEL;
  if (!channel || channel === 'none') {
    console.log('[notify] channel=none，跳过');
    return;
  }
  const text = `${title}\n\n${message}`;
  try {
    if (channel === 'telegram') await tg(env, text);
    else if (channel === 'dingtalk') await dingtalk(env, text);
    else if (channel === 'webhook') await webhook(env, text);
    else if (channel === 'serverchan') await serverchan(env, text);
    else console.warn('[notify] 未知渠道:', channel);
  } catch (e) {
    // 通知失败必须静默：只记录，不向上抛，避免整轮查找崩溃或重复骚扰
    console.error('[notify] 发送失败(已忽略):', e.message);
  }
}

async function tg(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 未配置');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status} ${await r.text()}`);
}

async function dingtalk(env, text) {
  const url = env.DINGTALK_WEBHOOK;
  if (!url) throw new Error('DINGTALK_WEBHOOK 未配置');
  let full = url;
  if (env.DINGTALK_SECRET) {
    const ts = Date.now();
    const sign = base64(await hmacSha256(`${ts}\n${env.DINGTALK_SECRET}`, env.DINGTALK_SECRET));
    full = `${url}&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
  }
  const r = await fetch(full, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
  });
  if (!r.ok) throw new Error(`dingtalk ${r.status}`);
}

async function webhook(env, text) {
  const url = env.NOTIFY_WEBHOOK;
  if (!url) throw new Error('NOTIFY_WEBHOOK 未配置');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, title: text.split('\n')[0] }),
  });
  if (!r.ok) throw new Error(`webhook ${r.status}`);
}

async function serverchan(env, text) {
  const key = env.SERVERCHAN_SENDKEY;
  if (!key) throw new Error('SERVERCHAN_SENDKEY 未配置');
  const [title, ...rest] = text.split('\n');
  const r = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: title || 'findwatch', desp: rest.join('\n') }).toString(),
  });
  if (!r.ok) throw new Error(`serverchan ${r.status}`);
}

// ---- 工具：HMAC-SHA256 + Base64（Web Crypto，Node/Workers 通用） ----
async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}
function base64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
