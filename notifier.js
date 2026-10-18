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
    if (channel === 'ntfy') await ntfy(env, text);
    else if (channel === 'telegram') await tg(env, text);
    else if (channel === 'dingtalk') await dingtalk(env, text);
    else if (channel === 'webhook') await webhook(env, text);
    else if (channel === 'serverchan') await serverchan(env, text);
    else if (channel === 'pushplus') await pushplus(env, text);
    else if (channel === 'wxpusher') await wxpusher(env, text);
    else console.warn('[notify] 未知渠道:', channel);
  } catch (e) {
    // 通知失败必须静默：只记录，不向上抛，避免整轮查找崩溃或重复骚扰
    console.error('[notify] 发送失败(已忽略):', e.message);
  }
}

/**
 * ntfy：零配置推送（https://ntfy.sh）。无需注册、无需密钥，
 * 只要订阅同一个 topic 就能在手机/浏览器收到推送。
 * 用法：NTFY_TOPIC 填一个不易被猜到的频道名，然后：
 *   - 手机装 ntfy App（iOS App Store / Android），订阅该 topic
 *   - 或浏览器直接打开 https://ntfy.sh/<topic> 在线收
 */
async function ntfy(env, text) {
  const topic = env.NTFY_TOPIC;
  if (!topic) throw new Error('NTFY_TOPIC 未配置');
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Tags': 'bell' },
    body: text,
  });
  if (!r.ok) throw new Error(`ntfy ${r.status} ${await r.text()}`);
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

/**
 * PushPlus：另一个微信推送服务（https://www.pushplus.plus），免费额度比 Server酱更大。
 * 微信登录 pushplus.plus 即可拿到 token，无需服务器。
 */
async function pushplus(env, text) {
  const token = env.PUSHPLUS_TOKEN;
  if (!token) throw new Error('PUSHPLUS_TOKEN 未配置');
  const [title, ...rest] = text.split('\n');
  const r = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      title: title || 'findwatch',
      content: rest.join('\n'),
      template: 'txt',
    }),
  });
  if (!r.ok) throw new Error(`pushplus ${r.status} ${await r.text()}`);
}

/**
 * WxPusher：微信推送（https://wxpusher.zjiecode.com），免费、无需实名认证。
 * 微信扫码关注即可拿到 appToken(AT_ 开头) 和 UID(UID_ 开头)。
 */
async function wxpusher(env, text) {
  const token = env.WXPUSHER_TOKEN;
  const uid = env.WXPUSHER_UID;
  if (!token || !uid) throw new Error('WXPUSHER_TOKEN / WXPUSHER_UID 未配置');
  const [title, ...rest] = text.split('\n');
  const r = await fetch('https://wxpusher.zjiecode.com/api/send/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appToken: token,
      content: rest.join('\n') || text,
      summary: title || 'findwatch',
      contentType: 1,
      uids: [uid],
    }),
  });
  if (!r.ok) throw new Error(`wxpusher ${r.status} ${await r.text()}`);
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
