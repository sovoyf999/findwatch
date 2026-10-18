// scheduler.js —— Docker / 常驻形态：循环执行 watcher，实现真正的 7×24 常驻进程。
// watcher.js 每跑一轮即退出；这里用定时器持续调用，使容器成为常驻服务。
import { runOnce } from './watcher.js';

const INTERVAL_MIN = Number(process.env.INTERVAL_MINUTES) || 5;
const INTERVAL_MS = INTERVAL_MIN * 60 * 1000;

let running = false;
async function tick() {
  if (running) return; // 防止上一轮未完成就重叠触发
  running = true;
  try {
    await runOnce(process.env);
  } catch (e) {
    console.error('[scheduler] 本轮异常:', e.message);
  } finally {
    running = false;
  }
}

console.log(`[scheduler] 启动，每 ${INTERVAL_MIN} 分钟执行一次查找（INTERVAL_MINUTES 可调）`);
tick(); // 启动立即跑一轮
setInterval(tick, INTERVAL_MS); // 之后按间隔循环（setInterval 保持事件循环活跃，进程不退出）

// 优雅退出（Docker stop 发 SIGTERM）
process.on('SIGTERM', () => {
  console.log('[scheduler] 收到 SIGTERM，退出');
  process.exit(0);
});
process.on('SIGINT', () => process.exit(0));
