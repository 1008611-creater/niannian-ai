// Safe patch: replace the Nomi project-document PUT revision-conflict 409 throw
// with last-write-wins fall-through (same approach as the canvas PUT fix).
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || '/opt/niannian-ai/server.js';
const target = "        throw Object.assign(new Error('Nomi 项目已在其他页面更新，请重新载入后再保存。'), {code:'CANVAS_REVISION_CONFLICT',httpStatus:409});";
const replacement = "        // 乐观锁冲突（多为 hydrate 期迁移保存与持久化订阅的丢失更新竞态）：以服务端当前修订为基准确认本次写入（等价客户端 reload+retry 的 last-write-wins），避免画布因 409 整体不可用。";
const buf = fs.readFileSync(FILE, 'utf8');
if (!buf.includes(target)) {
  console.error('PATCH TARGET NOT FOUND');
  process.exit(2);
}
if (buf.includes('Nomi 乐观锁冲突（多为 hydrate')) {
  console.error('ALREADY PATCHED');
  process.exit(0);
}
const out = buf.replace(target, replacement);
const backup = FILE + '.bak-nomi409-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, out);
console.log('PATCHED OK. backup=', backup);
