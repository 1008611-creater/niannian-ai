(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var TEMPLATE_ID = 'niannian-redraw-native-v1';
  var NODE_PREFIX = 'redraw-skill-';

  function routeValue(name) {
    var sources = [window.location.search, String(window.location.hash || '').split('?')[1] || ''];
    for (var index = 0; index < sources.length; index += 1) {
      var value = new URLSearchParams(sources[index]).get(name);
      if (value) return value.trim();
    }
    return '';
  }

  function projectId() { return routeValue('projectId'); }
  function projectKind() { return routeValue('projectKind') === 'script' ? 'script' : 'redraw'; }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]; }); }

  async function api(path, init) {
    var response = await fetch(path, Object.assign({credentials:'same-origin'}, init || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(body.error || '请求失败'); error.code = body.code; error.status = response.status; throw error; }
    return {body:body, headers:response.headers};
  }

  function textDocument(lines) {
    return {type:'doc',content:lines.map(function (line) { return {type:'paragraph',content:line ? [{type:'text',text:line}] : []}; })};
  }

  var definitions = [
    {key:'source',kind:'video',categoryId:'shots',title:'00 原片上传与权利确认',skillKey:'mx-shortdrama-00-router',description:'上传或选择当前项目原片，确认使用与改编权限，并完成媒体预检。',inputs:['视频文件','权利声明'],outputs:['源视频资产','预检报告'],parameters:{allowedFormats:'MP4 / MOV',rightsConfirmation:'required'},recovery:['reselect_asset','repair_input']},
    {key:'analysis',kind:'text',categoryId:'shots',title:'01 Step01 原片分析',skillKey:'mx-shortdrama-01-frame-extract',description:'在 Haika 服务端分析同一原片，提取镜头、首中尾帧、对白、OCR 与证据清单。',inputs:['已验证源视频'],outputs:['证据 manifest','镜头帧','对白/OCR'],parameters:{execution:'server',quality:'hq_full'},recovery:['reconcile_task','retry']},
    {key:'timeline',kind:'text',categoryId:'shots',title:'02 Step02 源片时间线',skillKey:'mx-shortdrama-02-source-timeline',description:'把 Step01 证据编译为可审核的镜头事实和时间线；接受前不进入下游生产。',inputs:['证据 manifest'],outputs:['已接受时间线','资产需求'],parameters:{reviewGate:'owner_acceptance'},recovery:['repair_input','retry']},
    {key:'adaptation',kind:'text',categoryId:'shots',title:'03 地区与内容改编',skillKey:'mx-shortdrama-03-mexico-localize',description:'基于已接受时间线设置目标地区、对白语言、人物关系和内容改编方案。',inputs:['已接受时间线'],outputs:['改编候选','本地化绑定'],parameters:{targetRegion:'待选择',targetLocale:'待选择'},recovery:['repair_input','rollback']},
    {key:'character',kind:'character',categoryId:'cast',title:'04 角色资产',skillKey:'mx-shortdrama-04-character-assets',description:'建立整部剧可复用的角色身份、服装、状态、声音与角色卡。',inputs:['本地化绑定','人物证据'],outputs:['角色卡','身份/声音锁定'],parameters:{candidateCount:1,continuity:'series'},recovery:['reselect_asset','retry']},
    {key:'scene',kind:'scene',categoryId:'scene',title:'05 场景资产',skillKey:'mx-shortdrama-04-character-assets',description:'建立重复地点的空间、机位、光线与剧情状态资产卡。',inputs:['本地化绑定','场景证据'],outputs:['场景卡','空间连续性'],parameters:{candidateCount:1,peopleAllowed:false},recovery:['reselect_asset','retry']},
    {key:'prop',kind:'image',categoryId:'prop',title:'06 道具资产',skillKey:'mx-shortdrama-04-character-assets',description:'锁定影响剧情连续性的关键道具、文字和状态变化。',inputs:['本地化绑定','道具/OCR 证据'],outputs:['道具卡','状态引用'],parameters:{candidateCount:1,textValidation:'required'},recovery:['reselect_asset','retry']},
    {key:'image2',kind:'image',categoryId:'shots',title:'07 Image2 首帧与故事板',skillKey:'image2-storyboard-video',description:'用已采用角色、场景和道具生成当前生产组首帧与正式故事板。',inputs:['角色卡','场景卡','道具卡','画面提示词'],outputs:['图像资产','预览','质量检查'],parameters:{channel:'1K / 2K / 4K 可选',aspectRatio:'跟随原片',spendGate:'explicit'},recovery:['reselect_asset','reconcile_task','retry']},
    {key:'h3',kind:'video',categoryId:'shots',title:'08 H3 视频生成',skillKey:'minimaxh3skill',modelKey:'minimax-h3',description:'按生产组用已锁定首帧、故事板和提示词生成短视频镜头。',inputs:['图像资产','视频提示词'],outputs:['视频镜头资产','播放预览'],parameters:{durationSeconds:'4-15',aspectRatio:'跟随原片',spendGate:'explicit'},recovery:['reconcile_task','retry']},
    {key:'animate',kind:'video',categoryId:'shots',title:'09 RunningHub 动作迁移',skillKey:'runninghub-animate-motion-transfer',modelKey:'runninghub-animate-motion-transfer',description:'使用一张目标人物图片和一段动作参考视频生成动作迁移结果。',inputs:['目标图片','动作参考视频'],outputs:['动作迁移视频','RH 币结算'],parameters:{workflow:'2083071192579264514',mode:'plus',spendGate:'explicit'},recovery:['reselect_asset','reconcile_task','retry']},
    {key:'smartcut',kind:'video',categoryId:'shots',title:'10 念念智能剪辑',skillKey:'mx-shortdrama-production-harness',description:'把已采用视频镜头送入外部智能剪辑器，保存会话并将导出成片回传项目素材库。',inputs:['已采用视频','剪辑参数'],outputs:['剪辑工程','回传成片'],parameters:{editor:'edit.cauai.fun',account:'shared_sign_in'},recovery:['reconcile_task','retry']},
    {key:'delivery',kind:'output',categoryId:'shots',title:'11 成片交付',skillKey:'mx-shortdrama-production-harness',description:'聚合最终视频，提供项目内播放、下载、采用记录与版本回读。',inputs:['智能剪辑成片'],outputs:['可播放成片','下载文件','交付版本'],parameters:{deliveryGate:'asset_readback_required'},recovery:['reconcile_task','rollback']}
  ];

  function port(id, required) { return {id:id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'input',type:id,required:required === true,multiple:false}; }
  function nodeId(key) { return NODE_PREFIX + key; }
  function makeNode(definition, index) {
    var column = index % 4;
    var row = Math.floor(index / 4);
    var details = [definition.description,'Skill: ' + definition.skillKey,'输入: ' + definition.inputs.join(' / '),'输出: ' + definition.outputs.join(' / ')];
    return {
      id:nodeId(definition.key),nodeId:nodeId(definition.key),kind:definition.kind,categoryId:'shots',title:definition.title,
      position:{x:120 + column * 500,y:140 + row * 430},prompt:details.join('\n'),contentJson:definition.kind === 'text' ? textDocument(details) : undefined,
      skillKey:definition.skillKey,skillVersion:'1.0.0',description:definition.description,
      inputPorts:definition.inputs.map(function (item, inputIndex) { return port(item, inputIndex === 0); }),
      outputPorts:definition.outputs.map(function (item) { return port(item, false); }),parameters:definition.parameters,assetRefs:[],taskRef:null,status:'draft',preview:null,
      recovery:{actions:definition.recovery,lastAction:null},meta:Object.assign({},definition.modelKey ? {modelKey:definition.modelKey,modelAlias:definition.modelKey} : {},{redrawSkill:{templateId:TEMPLATE_ID,step:index,logicalCategory:definition.categoryId,skillKey:definition.skillKey,skillVersion:'1.0.0',description:definition.description,inputPorts:definition.inputs,outputPorts:definition.outputs,parameters:definition.parameters,assetRefs:[],taskRef:null,preview:null,recovery:definition.recovery}})
    };
  }

  function makeEdges() {
    var edges = [];
    function connect(source, target, suffix) { edges.push({id:'redraw-edge-' + source + '-' + target + (suffix ? '-' + suffix : ''),source:nodeId(source),target:nodeId(target),mode:'reference',order:0}); }
    connect('source','analysis'); connect('analysis','timeline'); connect('timeline','adaptation');
    connect('adaptation','character'); connect('adaptation','scene'); connect('adaptation','prop');
    connect('character','image2','character'); connect('scene','image2','scene'); connect('prop','image2','prop');
    connect('image2','h3'); connect('image2','animate','image'); connect('source','animate','motion');
    connect('h3','smartcut','h3'); connect('animate','smartcut','animate'); connect('smartcut','delivery');
    return edges;
  }

  function installStyles() {
    if (document.getElementById('redraw-skill-workflow-styles')) return;
    var style = document.createElement('style'); style.id = 'redraw-skill-workflow-styles';
    style.textContent = [
      '#s1-chain-panel:not(.rw-executor-open),#s2-image2-launcher,#s3-animate-launcher,#s4-smart-cut-launcher{display:none!important}',
      '#redraw-workflow-launcher{position:fixed;left:18px;bottom:18px;z-index:130;min-height:44px;padding:0 14px;border:1px solid #d8d1c6;border-radius:6px;background:#2a2118;color:#fffaf3;font:700 13px/1 Inter,system-ui,sans-serif;box-shadow:0 10px 28px rgba(42,33,24,.18);cursor:pointer}',
      '#redraw-workflow-launcher[data-ready="true"]{background:#fffaf3;color:#2a2118}',
      '#redraw-skill-inspector{position:fixed;right:18px;top:72px;z-index:131;width:min(380px,calc(100vw - 36px));max-height:calc(100vh - 96px);overflow:auto;padding:16px;border:1px solid #d8d1c6;border-radius:6px;background:rgba(255,252,246,.98);color:#2a2118;box-shadow:0 18px 50px rgba(42,33,24,.18);font:13px/1.45 Inter,system-ui,sans-serif;backdrop-filter:blur(14px)}#redraw-skill-inspector[hidden]{display:none}',
      '#redraw-skill-inspector header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}#redraw-skill-inspector h2{margin:0;font-size:17px}#redraw-skill-inspector h3{margin:14px 0 6px;font-size:12px}#redraw-skill-inspector p{margin:6px 0;color:#6e5d4c}#redraw-skill-inspector .rw-close{border:0;background:transparent;cursor:pointer;color:#5d4d3d}',
      '#redraw-skill-inspector .rw-chip{display:inline-flex;margin:4px 5px 0 0;padding:4px 7px;border-radius:4px;background:#f1e8dc;color:#5d4d3d}#redraw-skill-inspector dl{display:grid;grid-template-columns:88px 1fr;gap:5px 8px;margin:10px 0}#redraw-skill-inspector dt{color:#8b7764}#redraw-skill-inspector dd{margin:0;word-break:break-word}',
      '#redraw-skill-inspector .rw-action{width:100%;min-height:40px;margin-top:12px;border:0;border-radius:5px;background:#9a6a3c;color:#fff;cursor:pointer;font-weight:700}#redraw-skill-inspector .rw-status{margin-top:10px;padding:9px;border-radius:5px;background:#f4eee6;color:#5d4d3d}#redraw-skill-inspector .rw-status.error{background:#fff0ee;color:#a33b2d}',
      '@media(max-width:600px){#redraw-workflow-launcher{left:10px;bottom:calc(10px + env(safe-area-inset-bottom))}#redraw-skill-inspector{right:10px;top:58px;width:calc(100vw - 20px);max-height:calc(100vh - 70px);padding:14px}}'
    ].join(''); document.head.appendChild(style);
  }

  function nativeDocument(response) { return response.body.document || {generationCanvas:{nodes:[],edges:[]}}; }
  function workflowNodes(documentState) { var canvas = documentState.generationCanvas || {}; return (Array.isArray(canvas.nodes) ? canvas.nodes : []).filter(function (node) { return node && node.meta && node.meta.redrawSkill && node.meta.redrawSkill.templateId === TEMPLATE_ID; }); }

  function executionTarget(skillKey) {
    if (['mx-shortdrama-00-router','mx-shortdrama-01-frame-extract','mx-shortdrama-02-source-timeline'].includes(skillKey)) return {id:'s1-chain-panel',label:'打开原片与时间线执行器'};
    if (skillKey === 'image2-storyboard-video') return {id:'s2-image2-launcher',label:'打开 Image2 执行器'};
    if (skillKey === 'runninghub-animate-motion-transfer') return {id:'s3-animate-launcher',label:'打开动作迁移执行器'};
    if (skillKey === 'mx-shortdrama-production-harness') return {id:'s4-smart-cut-launcher',label:'打开智能剪辑执行器'};
    return null;
  }

  function mount() {
    if (document.getElementById('redraw-workflow-launcher')) return;
    installStyles();
    var launcher = document.createElement('button'); launcher.id = 'redraw-workflow-launcher'; launcher.type = 'button'; launcher.textContent = '添加转绘工作流'; launcher.hidden = true; document.body.appendChild(launcher);
    var inspector = document.createElement('aside'); inspector.id = 'redraw-skill-inspector'; inspector.hidden = true; inspector.setAttribute('aria-label','转绘 Skill 节点详情'); inspector.innerHTML = '<header><div><small>REDRAW SKILL NODE</small><h2 data-rw-title>转绘节点</h2></div><button class="rw-close" type="button" aria-label="关闭节点详情">关闭</button></header><p data-rw-description></p><dl data-rw-meta></dl><section><h3>输入</h3><div data-rw-inputs></div></section><section><h3>输出</h3><div data-rw-outputs></div></section><section><h3>参数</h3><div data-rw-parameters></div></section><section><h3>素材与预览</h3><p data-rw-assets>等待上游节点输出或手动选择当前项目素材。</p></section><button class="rw-action" type="button" data-rw-action hidden></button><div class="rw-status" data-rw-status>点击画布中的转绘节点查看完整合同。</div>'; document.body.appendChild(inspector);
    var documentState = null; var revision = 0; var selected = null;

    function setStatus(message, error) { var target = inspector.querySelector('[data-rw-status]'); target.textContent = message; target.classList.toggle('error',Boolean(error)); }
    function chips(items) { return (items || []).map(function (item) { return '<span class="rw-chip">' + escapeHtml(typeof item === 'string' ? item : item.type || item.id) + '</span>'; }).join('') || '<span class="rw-chip">待上游提供</span>'; }
    function render(node) {
      selected = node; var skill = node.meta.redrawSkill; inspector.hidden = false;
      inspector.querySelector('[data-rw-title]').textContent = node.title || '转绘节点'; inspector.querySelector('[data-rw-description]').textContent = skill.description;
      inspector.querySelector('[data-rw-meta]').innerHTML = '<dt>Skill</dt><dd>' + escapeHtml(skill.skillKey) + '</dd><dt>版本</dt><dd>' + escapeHtml(skill.skillVersion) + '</dd><dt>状态</dt><dd>' + escapeHtml(node.status || 'draft') + '</dd><dt>节点 ID</dt><dd>' + escapeHtml(node.id) + '</dd>';
      inspector.querySelector('[data-rw-inputs]').innerHTML = chips(skill.inputPorts); inspector.querySelector('[data-rw-outputs]').innerHTML = chips(skill.outputPorts);
      inspector.querySelector('[data-rw-parameters]').innerHTML = Object.keys(skill.parameters || {}).map(function (key) { return '<span class="rw-chip">' + escapeHtml(key + ': ' + skill.parameters[key]) + '</span>'; }).join('') || '<span class="rw-chip">无额外参数</span>';
      inspector.querySelector('[data-rw-assets]').textContent = node.preview ? '已有结果预览，可从项目素材库读取。' : '当前引用 ' + String((node.assetRefs || []).length) + ' 个项目素材；没有浏览器临时 URL。';
      var target = executionTarget(skill.skillKey); var action = inspector.querySelector('[data-rw-action]'); action.hidden = !target; if (target) { action.textContent = target.label; action.dataset.target = target.id; }
      setStatus(skill.recovery && skill.recovery.length ? '失败时可执行：' + skill.recovery.join(' / ') : '等待上游输入。');
    }

    async function load() {
      launcher.hidden = !projectId();
      if (!projectId()) return;
      var response = await api('/api/studio/projects/' + encodeURIComponent(projectId()), {headers:{'x-niannian-project-kind':projectKind()}});
      documentState = nativeDocument(response); revision = Number(response.body.revision || 0); var count = workflowNodes(documentState).length;
      launcher.dataset.ready = count === definitions.length ? 'true' : 'false'; launcher.textContent = count === definitions.length ? '转绘工作流 · 12/12' : '添加转绘工作流';
    }

    async function createWorkflow() {
      launcher.disabled = true; launcher.textContent = '正在创建 12 个节点...';
      try {
        await load(); var canvas = documentState.generationCanvas || {nodes:[],edges:[]}; var existingNodes = Array.isArray(canvas.nodes) ? canvas.nodes : []; var existingEdges = Array.isArray(canvas.edges) ? canvas.edges : [];
        if (workflowNodes(documentState).length === definitions.length) { launcher.textContent = '转绘工作流 · 12/12'; launcher.dataset.ready = 'true'; return; }
        var ids = new Set(existingNodes.map(function (node) { return node && node.id; })); var edgeIds = new Set(existingEdges.map(function (edge) { return edge && edge.id; }));
        var additions = definitions.map(makeNode).filter(function (node) { return !ids.has(node.id); }); var newEdges = makeEdges().filter(function (edge) { return !edgeIds.has(edge.id); });
        var nextDocument = Object.assign({},documentState,{generationCanvas:Object.assign({},canvas,{nodes:existingNodes.concat(additions),edges:existingEdges.concat(newEdges)})});
        await api('/api/studio/projects/' + encodeURIComponent(projectId()), {method:'PUT',headers:{'content-type':'application/json','x-niannian-project-kind':projectKind(),'if-match':'"nomi-rev-' + revision + '"'},body:JSON.stringify({document:nextDocument})});
        window.location.reload();
      } catch (error) { launcher.disabled = false; launcher.textContent = '重试添加转绘工作流'; inspector.hidden = false; setStatus((error.code ? error.code + ': ' : '') + (error.message || '工作流创建失败'),true); }
    }

    launcher.addEventListener('click',createWorkflow); inspector.querySelector('.rw-close').addEventListener('click',function () { inspector.hidden = true; });
    inspector.querySelector('[data-rw-action]').addEventListener('click',function (event) { var target = document.getElementById(event.currentTarget.dataset.target); if (!target) return; if (target.id === 's1-chain-panel') { target.classList.add('rw-executor-open'); target.hidden = false; } else target.click(); inspector.hidden = true; });
    document.addEventListener('click',function (event) {
      var path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      var article = path.find(function (target) { return target instanceof Element && target.matches('[data-node-id]'); }) || (event.target instanceof Element ? event.target.closest('[data-node-id]') : null);
      if (!article || !documentState) return; var id = article.getAttribute('data-node-id'); var node = workflowNodes(documentState).find(function (item) { return item.id === id; }); if (node) render(node);
    },true);
    function refreshRoute() { load().catch(function (error) { launcher.textContent = '转绘工作流状态读取失败'; launcher.title = error.message || '读取失败'; }); }
    window.addEventListener('hashchange',refreshRoute); window.addEventListener('popstate',refreshRoute);
    refreshRoute(); setTimeout(refreshRoute,0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
}());
