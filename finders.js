// finders.js —— 查找核心：对单个目标执行检查，返回是否「命中」以及指纹。
// 同时兼容 Node 18+ 与 Cloudflare Workers（均提供全局 fetch / Web Crypto / btoa）。

/**
 * SHA-256 指纹（用于 change 类型判断内容是否变化）
 */
export async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 带超时的 fetch
 */
export async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 简易 JSON 路径取值，支持 a.b.c 与 a[0].b
 */
export function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => {
    if (o == null) return undefined;
    const m = k.match(/^(\w+)\[(\d+)\]$/);
    if (m) return o[m[1]] != null ? o[m[1]][Number(m[2])] : undefined;
    return o[k];
  }, obj);
}

/**
 * 执行一次目标检查。
 * @param {object} t 目标定义，字段见 targets.example.json
 * @returns {Promise<{status:number, fingerprint:string, found:boolean|null, detail:string}>}
 *   - 对 type=change，found 返回 null（是否变化由调用方用 fingerprint 比对决定）
 */
export async function checkTarget(t) {
  const method = (t.method || 'GET').toUpperCase();
  const res = await fetchWithTimeout(
    t.url,
    {
      method,
      headers: t.headers || { 'User-Agent': 'findwatch/1.0' },
      redirect: 'follow',
    },
    Number(t.timeoutMs) || 10000
  );
  const status = res.status;
  const body = await res.text();
  const fingerprint = await sha256(body);

  let found = false;
  let detail = `HTTP ${status}`;

  switch (t.type) {
    case 'status': {
      const expect = Number(t.match);
      found = status === expect;
      detail = `status ${status} ${found ? '==' : '!='} ${expect}`;
      break;
    }
    case 'contains': {
      found = body.includes(t.match);
      detail = found ? `包含 "${t.match}"` : `未包含 "${t.match}" (长度 ${body.length})`;
      break;
    }
    case 'not_contains': {
      found = !body.includes(t.match);
      detail = found ? `已不含 "${t.match}"` : `仍包含 "${t.match}"`;
      break;
    }
    case 'change': {
      // 是否「变化」由调用方比对 fingerprint 决定，这里 found 置 null
      found = null;
      detail = `fingerprint ${fingerprint.slice(0, 12)}…`;
      break;
    }
    case 'json': {
      // t.match: {"path":"$.in_stock","equals":true}
      const data = JSON.parse(body);
      const val = getPath(data, t.match.path);
      found = String(val) === String(t.match.equals);
      detail = `${t.match.path} = ${val}`;
      break;
    }
    default:
      throw new Error(`未知 type: ${t.type}`);
  }

  return { status, fingerprint, found, detail };
}
