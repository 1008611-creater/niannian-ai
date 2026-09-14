#!/usr/bin/env node
// scripts/check-progress-update.cjs
// commit-msg hook：对提交说明做基本校验，确保存在非空 subject 行。
// 由 .git/hooks/commit-msg 调用（通过 scripts/install-git-hooks.cjs 安装）。
// 原脚本已在仓库中丢失（从未被 git 跟踪），此处补回其功能最小可用版本。

const fs = require('node:fs');

const msgPath = process.argv[2];
if (!msgPath) {
  // 无消息文件路径则放行
  process.exit(0);
}

let msg = '';
try {
  msg = fs.readFileSync(msgPath, 'utf8');
} catch {
  process.exit(0);
}

// 去掉注释行（以 # 开头的行，部分工具会写入）
const lines = msg.split('\n').filter((l) => !l.trimStart().startsWith('#'));
const subject = (lines[0] || '').trim();

if (subject.length === 0) {
  console.error('\n[check-progress-update] 提交说明不能为空，请填写 subject 行。\n');
  process.exit(1);
}

if (subject.length > 120) {
  console.error('\n[check-progress-update] 提交说明 subject 过长（>120 字符），请精简。\n');
  process.exit(1);
}

process.exit(0);
