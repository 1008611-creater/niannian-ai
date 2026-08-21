'use strict';

// 前端（Nomi renderer）发布适配脚本
// 用法：node scripts/build_canvas_frontend.js
// 流程：studio-source 构建 → dist-canvas 产物复制到 studio/ → 重建 index.html
//   （保留服务端适配文件引用，替换核心 UI 引用为最新构建产物）
// 产出：studio/index.html + studio/assets/* 处于可提交、可发布状态。

const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'studio-source');
const STUDIO = path.join(ROOT, 'studio');
const OUT = path.join(SOURCE, 'dist-canvas');

function fail(message) {
  console.error('[build_canvas_frontend] ' + message);
  process.exit(1);
}

if (!fs.existsSync(path.join(SOURCE, 'package.json'))) fail('未找到 studio-source/package.json，请确认源码目录完整');

// 1. 构建（tailwind + vite build 到独立 outDir，避开 dist 残留问题）
console.log('▶ 构建 Tailwind...');
execSync('node scripts/build-tailwind.mjs --minify', {cwd: SOURCE, stdio: 'inherit'});
console.log('▶ 构建 Vite renderer...');
// 用系统 rmdir 清理旧产物目录（node fs.rmSync 会被部分环境的 safe-delete shim 拦截）
try { execSync(`cmd /c rmdir /s /q "${OUT}"`, {stdio: 'ignore'}); } catch { /* 目录不存在 */ }
execSync('node node_modules/vite/bin/vite.js build --mode production --outDir dist-canvas', {cwd: SOURCE, stdio: 'inherit'});

const srcAssets = path.join(OUT, 'assets');
const dstAssets = path.join(STUDIO, 'assets');
if (!fs.existsSync(srcAssets)) fail('构建产物 assets 缺失');
if (!fs.existsSync(dstAssets)) fail('studio/assets 缺失');

// 2. 复制构建产物（覆盖核心 UI；服务端适配文件不在产物中，自然保留）
console.log('▶ 复制构建产物到 studio/assets...');
let copied = 0;
for (const f of fs.readdirSync(srcAssets)) {
  fs.copyFileSync(path.join(srcAssets, f), path.join(dstAssets, f));
  copied += 1;
}
const tw = path.join(OUT, 'tailwind.generated.css');
if (fs.existsSync(tw)) fs.copyFileSync(tw, path.join(STUDIO, 'tailwind.generated.css'));
console.log(`  复制 ${copied} 个产物文件`);

// 3. 重建 index.html
console.log('▶ 重建 studio/index.html...');
const online = fs.readFileSync(path.join(STUDIO, 'index.html'), 'utf8');
const distHtml = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const coreRefs = [...distHtml.matchAll(/<script type="module"[^>]*assets\/[^"]+[^>]*>|<link rel="modulepreload"[^>]*assets\/[^"]+[^>]*>|<link rel="stylesheet"[^>]*assets\/[^"]+[^>]*>/g)].map((m) => m[0]);
if (!coreRefs.length) fail('未从构建产物 index.html 提取到核心 UI 引用');
const coreStart = online.indexOf('<link rel="modulepreload"');
const headEnd = online.indexOf('</head>');
if (coreStart === -1 || headEnd === -1) fail('线上 index.html 结构不符合预期');
const rebuilt = online.slice(0, coreStart) + coreRefs.join('\n    ') + '\n  ' + online.slice(headEnd);
fs.writeFileSync(path.join(STUDIO, 'index.html'), rebuilt, 'utf8');

// 4. 校验
const check = fs.readFileSync(path.join(STUDIO, 'index.html'), 'utf8');
if (!check.includes('web-runtime-adapter')) fail('index.html 丢失服务端适配文件引用（web-runtime-adapter）');
for (const ref of coreRefs) {
  const asset = /assets\/([^"?]+)/.exec(ref);
  if (asset && !fs.existsSync(path.join(STUDIO, 'assets', asset[1]))) fail('index.html 引用的资源缺失：' + asset[1]);
}
console.log('✅ 完成：studio/index.html + assets 已就绪，可直接提交发布');
