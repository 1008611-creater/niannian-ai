// 一次性补丁：把 /api/projects/<id>/canvas PUT 的乐观锁 409 改为 last-write-wins，
// 避免 hydrate 期迁移保存与持久化订阅的丢失更新竞态导致画布整体不可用。
const fs = require('fs');
const path = process.argv[2] || '/opt/niannian-ai/server.js';
const src = fs.readFileSync(path, 'utf8');

const target = "        throw Object.assign(new Error('画布已在其他页面更新，请先重新载入。'), {code:'CANVAS_REVISION_CONFLICT',httpStatus:409});";

const replacement = [
  "        // 乐观锁冲突（多为 hydrate 期迁移保存与持久化订阅的丢失更新竞态）：以服务端当前修订为基准确认本次写入",
  "        // （等价客户端 reload+retry 的 last-write-wins），避免画布因 409 整体不可用；多标签页真实分歧时以最后一次写入为准。",
].join('\n');

const count = src.split(target).length - 1;
if (count !== 1) {
  console.error('PATCH TARGET count = ' + count + ' (expected 1) — aborting, no change made');
  process.exit(2);
}
const out = src.replace(target, replacement);
fs.writeFileSync(path, out, 'utf8');
console.log('PATCH APPLIED OK to', path);
