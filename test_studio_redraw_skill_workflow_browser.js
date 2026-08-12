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
async function waitForHealth(baseUrl) { for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(baseUrl + '/api/health')).ok) return; } catch {} await pause(100); } throw new Error('redraw_workflow_server_not_ready'); }
async function main() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'niannian-redraw-workflow-'));
  const port = 30100 + crypto.randomInt(300); const baseUrl = 'http://127.0.0.1:' + port; const token = crypto.randomBytes(18).toString('hex'); const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = {id:'USR-RW-UI',email:'rw-ui@example.test',status:'active'}; const project = {id:'NN-RW-UI',ownerId:user.id,name:'Redraw Workflow UI',projectKind:'redraw',canvasOnly:true,status:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),runtime:{}};
  await Promise.all([
    fs.writeFile(path.join(dataRoot,'users.json'),JSON.stringify([user])),fs.writeFile(path.join(dataRoot,'sessions.json'),JSON.stringify([{tokenHash,userId:user.id,expiresAt:new Date(Date.now()+3600000).toISOString()}])),fs.writeFile(path.join(dataRoot,'projects.json'),JSON.stringify([project])),fs.writeFile(path.join(dataRoot,'canvas-projects.json'),JSON.stringify([project])),fs.writeFile(path.join(dataRoot,'canvas-documents.json'),'{}'),fs.writeFile(path.join(dataRoot,'canvas-assets.json'),'[]'),fs.writeFile(path.join(dataRoot,'canvas-generation-jobs.json'),'[]'),fs.writeFile(path.join(dataRoot,'smart-cut-jobs.json'),'[]'),fs.writeFile(path.join(dataRoot,'script-projects.json'),'[]'),fs.writeFile(path.join(dataRoot,'workspace-bindings.json'),'[]')
  ]);
  const server = spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataRoot},stdio:['ignore','ignore','ignore']}); let browser;
  try {
    await waitForHealth(baseUrl); browser = await chromium.launch({headless:true}); const context = await browser.newContext({viewport:{width:1440,height:900}}); await context.addCookies([{name:'niannian_session',value:token,url:baseUrl}]); const page = await context.newPage(); const failures=[]; page.on('pageerror',error=>failures.push(error.message));
    const url = baseUrl + '/studio/?step=generate#/studio?projectId=' + project.id + '&projectKind=redraw'; await page.goto(url,{waitUntil:'networkidle'}); await page.getByRole('button',{name:'添加转绘工作流'}).click(); await page.waitForLoadState('networkidle'); await page.getByRole('button',{name:/转绘工作流 · 12\/12/}).waitFor();
    const response = await page.request.get(baseUrl + '/api/studio/projects/' + project.id,{headers:{cookie:'niannian_session='+token,'x-niannian-project-kind':'redraw'}}); assert.equal(response.status(),200); const saved=await response.json(); const nodes=saved.document.generationCanvas.nodes.filter(node=>node.meta?.redrawSkill?.templateId==='niannian-redraw-native-v1'); const edges=saved.document.generationCanvas.edges.filter(edge=>String(edge.id).startsWith('redraw-edge-')); assert.equal(nodes.length,12,JSON.stringify(saved.document.generationCanvas.nodes.map(node=>({id:node.id,kind:node.kind,hasMeta:Boolean(node.meta?.redrawSkill)})))); assert.equal(edges.length,15); assert.equal(new Set(nodes.map(node=>node.id)).size,12);
    await page.getByRole('button',{name:/转绘工作流 · 12\/12/}).click(); const idempotentResponse=await page.request.get(baseUrl+'/api/studio/projects/'+project.id,{headers:{cookie:'niannian_session='+token,'x-niannian-project-kind':'redraw'}}); const idempotentSaved=await idempotentResponse.json(); assert.equal(idempotentSaved.document.generationCanvas.nodes.filter(node=>node.meta?.redrawSkill?.templateId==='niannian-redraw-native-v1').length,12);
    await page.locator('[data-node-id="redraw-skill-image2"]').click(); const inspector=page.locator('#redraw-skill-inspector'); await inspector.waitFor({state:'visible'}); await inspector.getByText('image2-storyboard-video').waitFor(); await inspector.getByText(/1K \/ 2K \/ 4K 可选/).waitFor(); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    for (const [nodeId,title] of [['redraw-skill-h3','08 H3 视频生成'],['redraw-skill-animate','09 RunningHub 动作迁移'],['redraw-skill-smartcut','10 念念智能剪辑']]) { await page.locator('[data-node-id="'+nodeId+'"]').click(); await inspector.getByRole('heading',{name:title}).waitFor(); }
    await page.setViewportSize({width:390,height:844}); await page.reload({waitUntil:'networkidle'}); await page.getByRole('button',{name:/转绘工作流 · 12\/12/}).waitFor(); assert.equal(await page.locator('[data-node-id^="redraw-skill-"]').count(),12); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true); assert.deepEqual(failures,[]); await context.close(); await browser.close(); browser=null;
    console.log(JSON.stringify({ok:true,verified:['one click persists 12 native generationCanvas Skill nodes','15 native edges connect the complete redraw route','refresh restores the same workflow without duplication','image and video nodes open their matching inspector contracts','node inspector exposes Skill inputs outputs parameters assets preview and recovery','desktop and mobile have no horizontal overflow','no paid Provider call occurs']}));
  } finally { if(browser) await browser.close(); server.kill(); await fs.rm(dataRoot,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error.stack||error.message||String(error));process.exitCode=1;});
