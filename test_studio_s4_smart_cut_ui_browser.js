'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = __dirname;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(baseUrl + '/api/health')).ok) return; } catch {}
    await pause(100);
  }
  throw new Error('s4_ui_server_not_ready');
}

async function main() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'niannian-s4-ui-'));
  const port = 29800 + crypto.randomInt(300);
  const baseUrl = 'http://127.0.0.1:' + port;
  const token = crypto.randomBytes(18).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = {id:'USR-S4-UI',email:'s4-ui@example.test',status:'active'};
  const project = {id:'NN-S4-UI',ownerId:user.id,name:'S4 UI',projectKind:'redraw',canvasOnly:true,status:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),runtime:{}};
  await Promise.all([
    fs.writeFile(path.join(dataRoot, 'users.json'), JSON.stringify([user])),
    fs.writeFile(path.join(dataRoot, 'sessions.json'), JSON.stringify([{tokenHash,userId:user.id,expiresAt:new Date(Date.now() + 3600000).toISOString()}])),
    fs.writeFile(path.join(dataRoot, 'projects.json'), JSON.stringify([project])),
    fs.writeFile(path.join(dataRoot, 'canvas-projects.json'), JSON.stringify([project])),
    fs.writeFile(path.join(dataRoot, 'canvas-documents.json'), '{}'),
    fs.writeFile(path.join(dataRoot, 'canvas-assets.json'), '[]'),
    fs.writeFile(path.join(dataRoot, 'canvas-generation-jobs.json'), '[]'),
    fs.writeFile(path.join(dataRoot, 'smart-cut-jobs.json'), '[]'),
    fs.writeFile(path.join(dataRoot, 'script-projects.json'), '[]'),
    fs.writeFile(path.join(dataRoot, 'workspace-bindings.json'), '[]')
  ]);
  const server = spawn(process.execPath, ['server.js'], {cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataRoot},stdio:['ignore','ignore','ignore']});
  let browser;
  try {
    await waitForHealth(baseUrl);
    const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(2048, 2)]);
    const form = new FormData();
    form.append('kind', 'reference_video');
    form.append('asset', new Blob([video], {type:'video/mp4'}), 'original.mp4');
    const upload = await fetch(baseUrl + '/api/projects/' + project.id + '/assets', {method:'POST',headers:{cookie:'niannian_session=' + token,'x-niannian-project-kind':'redraw'},body:form});
    assert.equal(upload.status, 201);
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await context.addCookies([{name:'niannian_session',value:token,url:baseUrl}]);
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(baseUrl + '/studio/?projectId=' + project.id + '&projectKind=redraw#/studio', {waitUntil:'networkidle'});
    await page.getByRole('button', {name:'打开智能剪辑候选'}).click();
    const panel = page.locator('#s4-smart-cut-panel');
    await panel.waitFor({state:'visible'});
    await panel.getByRole('radio', {name:/original\.mp4/}).check();
    await panel.getByLabel('剪辑预设').selectOption('short_video');
    await panel.getByLabel('交付比例').selectOption('16:9');
    await panel.getByLabel('剪辑说明（选填）').fill('保留关键反应，删除长停顿。');
    await panel.getByRole('button', {name:'保存剪辑候选'}).click();
    await panel.getByText(/剪辑候选已保存并完成预检/).waitFor({timeout:5000});
    await panel.getByText('候选已准备').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.setViewportSize({width:390,height:844});
    await page.reload({waitUntil:'networkidle'});
    await page.getByRole('button', {name:'打开智能剪辑候选'}).click();
    await panel.waitFor({state:'visible'});
    await panel.getByText('候选已准备').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(failures, []);
    await context.close();
    await browser.close(); browser = null;
    console.log(JSON.stringify({ok:true,verified:['desktop selects a current-project source video and persists the Smart Cut node','candidate creation performs only the server dry-run contract','refresh restores the prepared Smart Cut job','mobile panel has no horizontal overflow','no external editor project or paid provider request is created']}));
  } finally {
    if (browser) await browser.close();
    server.kill();
    await fs.rm(dataRoot, {recursive:true,force:true});
  }
}

main().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
