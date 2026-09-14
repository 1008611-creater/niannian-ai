#!/usr/bin/env node
// scripts/check-no-secrets.mjs
// Pre-commit guard: 扫描暂存区源码/配置文件，拒绝疑似密钥/敏感凭证被提交。
// 由 .git/hooks/pre-commit 调用（通过 scripts/install-git-hooks.cjs 安装）。
// 仅对源码与配置文件做保守匹配，跳过构建产物/依赖，避免误报。

import { execSync } from 'node:child_process';
import { basename } from 'node:path';

// 自身与构建产物/依赖：不扫描（构建产物含 base64 数据会误报，且无密钥必要）
const SKIP_FILES = new Set(['scripts/check-no-secrets.mjs']);
const SKIP_DIR_PREFIX = [
  'studio/assets/',
  'dist/',
  'dist-canvas/',
  'dist-studio/',
  'node_modules/',
  'build/',
  '.next/',
  'out/',
  'coverage/',
  '.pnpm-store/',
];

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.env', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.py', '.sh', '.bash', '.md', '.html', '.css', '.txt',
]);

// 保守的疑似密钥模式：仅匹配真实凭证形态，不误伤关键词或正则字面量
const SECRET_PATTERNS = [
  // AWS Access Key ID（真值形态）
  /\bAKIA[0-9A-Z]{16}\b/,
  // 私钥块
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  // 常见密钥赋值：keyword = '实际值' 且值长度 >= 16（排除正则字面量行）
  /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|bearer)\s*[:=]\s*['"][A-Za-z0-9_\-./+]{16,}['"]/i,
  // 已知平台 PAT 前缀
  /\b(?:ghp|gho|ghu|ghs|ghr|glpat|glpat-|xox[baprs]-|ya29\.)[A-Za-z0-9_\-]{20,}\b/,
];

function shouldSkip(file) {
  if (SKIP_FILES.has(file)) return true;
  if (SKIP_DIR_PREFIX.some((p) => file.startsWith(p) || file.includes('/' + p))) return true;
  if (basename(file) === '.env' || file.endsWith('.env') || file.includes('.env.')) return false; // .env 要扫描
  const ext = file.slice(file.lastIndexOf('.'));
  return !TEXT_EXT.has(ext);
}

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function stagedContent(file) {
  try {
    return execSync(`git show :${file}`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function main() {
  const files = getStagedFiles().filter((f) => !shouldSkip(f));
  const hits = [];

  for (const file of files) {
    const content = stagedContent(file);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue; // 跳过 JS 行注释
      for (const re of SECRET_PATTERNS) {
        if (re.test(line)) {
          hits.push({ file, line: i + 1, snippet: line.trim().slice(0, 120) });
          break;
        }
      }
    }
  }

  if (hits.length > 0) {
    console.error('\n[check-no-secrets] 在暂存区发现疑似密钥/敏感信息，已中止提交：');
    for (const h of hits) {
      console.error(`  - ${h.file}:${h.line}  ${h.snippet}`);
    }
    console.error('\n若为误报，请人工复核后使用 git commit --no-verify 提交（不推荐）。\n');
    process.exit(1);
  }

  process.exit(0);
}

main();
