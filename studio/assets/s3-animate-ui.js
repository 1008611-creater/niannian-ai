(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function value(name) {
    var sources = [window.location.search, String(window.location.hash || '').split('?')[1] || ''];
    for (var i = 0; i < sources.length; i += 1) {
      var found = new URLSearchParams(sources[i]).get(name);
      if (found) return found.trim();
    }
    return '';
  }
  function projectId() { return value('projectId'); }
  function projectKind() { return value('projectKind') === 'script' ? 'script' : 'redraw'; }
  function escapeHtml(input) {
    return String(input == null ? '' : input).replace(/[&<>"']/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }
  function makeId(prefix) {
    var tail = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2);
    return prefix + '-' + tail.slice(0, 32);
  }
  async function api(path, init) {
    var response = await fetch(path, Object.assign({credentials: 'same-origin'}, init || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(body.error || '请求失败'); error.code = body.code; error.status = response.status; throw error; }
    return {body: body, headers: response.headers};
  }
  function isImage(asset) { return String(asset && asset.mimeType || '').indexOf('image/') === 0 || asset && asset.kind === 'reference_image' || asset && asset.kind === 'generated_image'; }
  function isVideo(asset) { return String(asset && asset.mimeType || '').indexOf('video/') === 0 || asset && asset.kind === 'reference_video' || asset && asset.kind === 'generated_video'; }
  function statusLabel(status) {
    return {awaiting_authorization:'待授权',queued:'排队中',running:'生成中',succeeded:'已完成',failed:'失败',review:'需要处理'}[status] || status || '未知';
  }
  function installStyles() {
    if (document.getElementById('s3-animate-ui-styles')) return;
    var style = document.createElement('style');
    style.id = 's3-animate-ui-styles';
    style.textContent = [
      '#s3-animate-launcher{position:fixed;right:18px;bottom:72px;z-index:124;min-height:44px;padding:0 14px;border:1px solid var(--nomi-line,#d8d1c6);border-radius:6px;background:#6f3d31;color:#fffaf3;font:600 13px/1.2 Inter,system-ui,sans-serif;box-shadow:0 10px 28px rgba(42,33,24,.18);cursor:pointer}#s3-animate-launcher:focus-visible{outline:2px solid #9a6a3c;outline-offset:3px}#s3-animate-launcher[hidden]{display:none}',
      '#s3-animate-panel{position:fixed;right:18px;top:72px;z-index:126;width:min(410px,calc(100vw - 36px));max-height:calc(100vh - 144px);overflow:auto;padding:16px;border:1px solid var(--nomi-line,#d8d1c6);border-radius:6px;background:rgba(255,252,246,.98);color:#2a2118;box-shadow:0 18px 50px rgba(42,33,24,.18);font:13px/1.45 Inter,system-ui,sans-serif;backdrop-filter:blur(14px)}#s3-animate-panel[hidden]{display:none}#s3-animate-panel h2{margin:0;font-size:16px;font-weight:700}#s3-animate-panel h3{margin:16px 0 6px;font-size:12px;font-weight:700}#s3-animate-panel p{margin:5px 0;color:#786958}#s3-animate-panel .s3-header{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}#s3-animate-panel .s3-eyebrow{font-size:10px;font-weight:700;letter-spacing:.11em;color:#6f3d31}#s3-animate-panel .s3-close{min-height:32px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:#5d4d3d;cursor:pointer;font:inherit}#s3-animate-panel .s3-close:hover{background:#f2eadf}',
      '#s3-animate-panel .s3-input-groups{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}#s3-animate-panel .s3-assets{display:grid;gap:6px;margin-top:8px;max-height:138px;overflow:auto}#s3-animate-panel .s3-asset{display:flex;gap:8px;align-items:center;min-width:0;padding:7px;border:1px solid rgba(90,64,42,.14);border-radius:5px;background:#fffaf3;cursor:pointer}#s3-animate-panel .s3-asset:has(input:checked){border-color:#6f3d31;background:#f8eee2}#s3-animate-panel .s3-thumb{width:34px;height:34px;flex:0 0 34px;object-fit:cover;border-radius:4px;background:#eee5d9}#s3-animate-panel .s3-asset-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#s3-animate-panel .s3-field{display:grid;gap:5px;margin-top:10px}#s3-animate-panel label{font-size:12px;font-weight:600;color:#4c3828}#s3-animate-panel textarea,#s3-animate-panel select{box-sizing:border-box;width:100%;min-height:36px;border:1px solid rgba(90,64,42,.24);border-radius:5px;background:#fff;color:#2a2118;padding:8px;font:inherit}#s3-animate-panel textarea{min-height:56px;resize:vertical}#s3-animate-panel select:focus-visible,#s3-animate-panel textarea:focus-visible{outline:2px solid #9a6a3c;outline-offset:1px}',
      '#s3-animate-panel .s3-spec{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:8px;border:1px solid rgba(90,64,42,.13);border-radius:5px;background:#f7f1e8;color:#5d4d3d}#s3-animate-panel .s3-spec strong{color:#2a2118}#s3-animate-panel .s3-actions{display:flex;gap:8px;align-items:center;margin-top:14px}#s3-animate-panel button.s3-primary{min-height:40px;padding:0 12px;border:0;border-radius:5px;background:#6f3d31;color:#fff;cursor:pointer;font:600 13px/1 system-ui}#s3-animate-panel button.s3-primary:hover{background:#512a22}#s3-animate-panel button.s3-primary[disabled]{opacity:.45;cursor:default}#s3-animate-panel .s3-secondary{min-height:40px;padding:0 10px;border:1px solid rgba(90,64,42,.16);border-radius:5px;background:#f2eadf;color:#4c3828;cursor:pointer;font:600 12px/1 system-ui}',
      '#s3-animate-panel .s3-status{margin-top:12px;padding:9px;border-radius:5px;background:#f4eee6;color:#5d4d3d;white-space:pre-wrap}#s3-animate-panel .s3-status.error{background:#fff0ee;color:#a33b2d}#s3-animate-panel .s3-history{display:grid;gap:6px;margin-top:8px}#s3-animate-panel .s3-job{padding:9px;border-top:1px solid rgba(90,64,42,.12)}#s3-animate-panel .s3-job:first-child{border-top:0}#s3-animate-panel .s3-job-title{display:flex;justify-content:space-between;gap:8px;font-weight:600}#s3-animate-panel .s3-job small{color:#786958}#s3-animate-panel .s3-output{display:block;width:100%;max-height:180px;margin-top:7px;border-radius:5px;background:#eee5d9}#s3-animate-panel .s3-empty{color:#786958}',
      '@media (max-width:600px){#s3-animate-launcher{right:10px;bottom:calc(62px + env(safe-area-inset-bottom))}#s3-animate-panel{right:10px;top:58px;width:calc(100vw - 20px);max-height:calc(100vh - 124px);padding:14px}#s3-animate-panel .s3-input-groups{grid-template-columns:minmax(0,1fr)}}',
      '@media (prefers-reduced-motion:reduce){#s3-animate-panel *{scroll-behavior:auto!important;transition:none!important}}'
    ].join('');
    document.head.appendChild(style);
  }
  function setSiblingVisibility(active) {
    var s1 = document.getElementById('s1-chain-panel');
    var s2 = document.getElementById('s2-image2-panel');
    var s2Launcher = document.getElementById('s2-image2-launcher');
    if (active) {
      if (s1) s1.hidden = true;
      if (s2) s2.hidden = true;
      if (s2Launcher) s2Launcher.hidden = true;
    } else if (s2Launcher) {
      s2Launcher.hidden = false;
    }
  }

  function mount() {
    if (document.getElementById('s3-animate-panel')) return;
    installStyles();
    var launcher = document.createElement('button');
    launcher.id = 's3-animate-launcher'; launcher.type = 'button'; launcher.hidden = true;
    launcher.textContent = '动作迁移视频'; launcher.setAttribute('aria-label', '打开动作迁移视频候选'); document.body.appendChild(launcher);
    var panel = document.createElement('section');
    panel.id = 's3-animate-panel'; panel.hidden = true; panel.setAttribute('aria-label', '动作迁移视频候选');
    panel.innerHTML = '<div class="s3-header"><div><div class="s3-eyebrow">S3 ANIMATE</div><h2>动作迁移视频</h2><p>把当前项目的一张图片和一段动作视频绑定为可恢复候选。建立候选不会授权 Provider、提交任务或消费 RH 币。</p></div><button class="s3-close" type="button" data-s3-close aria-label="关闭动作迁移视频">关闭</button></div><h3>输入素材</h3><div class="s3-input-groups"><div><label>角色/画面图片</label><div class="s3-assets" data-s3-images><span class="s3-empty">正在读取项目图片...</span></div></div><div><label>动作参考视频</label><div class="s3-assets" data-s3-videos><span class="s3-empty">正在读取项目视频...</span></div></div></div><div class="s3-field"><label for="s3-animate-prompt">动作说明（选填）</label><textarea id="s3-animate-prompt" data-s3-prompt placeholder="补充需要保留的动作、构图或镜头约束"></textarea></div><div class="s3-field"><label for="s3-animate-channel">动作迁移渠道</label><select id="s3-animate-channel" data-s3-channel></select></div><div class="s3-input-groups"><div class="s3-field"><label for="s3-animate-duration">片段时长</label><select id="s3-animate-duration" data-s3-duration><option value="5">5 秒测试片段</option><option value="8">8 秒</option><option value="10">10 秒</option><option value="15">15 秒上限</option></select></div><div class="s3-field"><label for="s3-animate-ratio">输出比例</label><select id="s3-animate-ratio" data-s3-ratio><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></div></div><div class="s3-spec" data-s3-spec><strong>任务规格</strong><span>5 秒</span><span>9:16</span><span>1 张图 + 1 个视频</span></div><div class="s3-actions"><button type="button" class="s3-primary" data-s3-create disabled>建立视频候选</button><button type="button" class="s3-secondary" data-s3-refresh>刷新</button></div><div class="s3-status" data-s3-status aria-live="polite">选择一张图片和一个视频后建立候选。</div><h3>当前项目的动作迁移任务</h3><div class="s3-history" data-s3-history>暂无动作迁移任务。</div>';
    document.body.appendChild(panel);
    var imagesEl = panel.querySelector('[data-s3-images]'); var videosEl = panel.querySelector('[data-s3-videos]'); var channelEl = panel.querySelector('[data-s3-channel]'); var durationEl = panel.querySelector('[data-s3-duration]'); var ratioEl = panel.querySelector('[data-s3-ratio]'); var promptEl = panel.querySelector('[data-s3-prompt]'); var createEl = panel.querySelector('[data-s3-create]'); var historyEl = panel.querySelector('[data-s3-history]'); var specEl = panel.querySelector('[data-s3-spec]'); var statusEl = panel.querySelector('[data-s3-status]');
    var revision = 0; var documentState = null; var assets = []; var channels = []; var pollTimer = null;
    function setStatus(message, error) { statusEl.textContent = message; statusEl.classList.toggle('error', Boolean(error)); }
    function selectedAsset(name) { var selected = panel.querySelector('input[name="' + name + '"]:checked'); return selected ? selected.value : ''; }
    function currentChannel() { return channels.find(function (item) { return item.id === channelEl.value; }) || null; }
    function sync() { createEl.disabled = !selectedAsset('s3-image-asset') || !selectedAsset('s3-video-asset') || !currentChannel() || !durationEl.value || !ratioEl.value; }
    function renderAssetGroup(element, name, list, empty) {
      element.innerHTML = list.length ? list.map(function (asset) { var url = asset.downloadUrl || ''; return '<label class="s3-asset"><input type="radio" name="' + name + '" value="' + escapeHtml(asset.id) + '">' + (url ? '<img class="s3-thumb" src="' + escapeHtml(url) + '" alt="">' : '<span class="s3-thumb" aria-hidden="true"></span>') + '<span class="s3-asset-name">' + escapeHtml(asset.originalName || asset.id) + '</span></label>'; }).join('') : '<span class="s3-empty">' + escapeHtml(empty) + '</span>';
      element.querySelectorAll('input').forEach(function (input) { input.addEventListener('change', sync); });
    }
    function renderAssets() { renderAssetGroup(imagesEl, 's3-image-asset', assets.filter(isImage), '当前项目暂无图片素材，请先上传或完成上游图像节点。'); renderAssetGroup(videosEl, 's3-video-asset', assets.filter(isVideo), '当前项目暂无动作视频，请先上传原片或动作参考。'); }
    function renderChannels() {
      channelEl.innerHTML = channels.length ? channels.map(function (item) { return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.label) + '</option>'; }).join('') : '<option value="">暂无已启用的动作迁移渠道</option>';
      channelEl.disabled = !channels.length; sync();
    }
    function renderSpec() { specEl.innerHTML = '<strong>任务规格</strong><span>' + escapeHtml(durationEl.value || '—') + ' 秒</span><span>' + escapeHtml(ratioEl.value || '—') + '</span><span>1 张图 + 1 个视频</span><span>仅候选</span>'; sync(); }
    function renderHistory(jobs) {
      var items = (Array.isArray(jobs) ? jobs : []).filter(function (job) { return job.videoChannel === 'animate-transfer' || job.videoChannel === 'animate-ai-app' || String(job.model || '').indexOf('runninghub-animate') === 0; }).slice(0, 6);
      historyEl.innerHTML = items.length ? items.map(function (job) { var outputId = Array.isArray(job.outputAssetIds) && job.outputAssetIds[0]; var output = job.status === 'succeeded' && outputId ? '<video class="s3-output" controls preload="metadata" src="/api/projects/' + encodeURIComponent(projectId()) + '/assets/' + encodeURIComponent(outputId) + '/download"></video>' : ''; var error = job.error ? '<p class="s3-job-error">' + escapeHtml(job.error) + '</p>' : ''; var run = job.status === 'awaiting_authorization' && job.providerSubmitEnabled ? '<button type="button" class="s3-primary" data-s3-run="' + escapeHtml(job.id) + '">确认并生成</button>' : ''; return '<article class="s3-job"><div class="s3-job-title"><span>' + escapeHtml(job.videoChannelLabel || job.modelLabel || '动作迁移视频') + '</span><small>' + escapeHtml(statusLabel(job.status)) + '</small></div><small>' + escapeHtml((job.durationSeconds || '—') + ' 秒 · ' + (job.aspectRatio || '—') + ' · 提交：' + (job.providerSubmitEnabled ? '可用' : '未启用')) + '</small>' + error + run + output + '</article>'; }).join('') : '<span class="s3-empty">暂无动作迁移任务。</span>';
      historyEl.querySelectorAll('[data-s3-run]').forEach(function (button) { button.addEventListener('click', authorizeJob); });
    }
    function schedulePoll() { clearTimeout(pollTimer); pollTimer = setTimeout(load, 2500); }
    async function authorizeJob(event) { var button = event.currentTarget; var jobId = button.getAttribute('data-s3-run'); if (!jobId) return; if (!window.confirm('本次操作会提交 RunningHub 动作迁移并消耗 RH 币。确认继续？')) return; button.disabled = true; setStatus('动作迁移已提交，页面会自动查询同一个任务，不会重复提交。'); try { await api('/api/projects/' + encodeURIComponent(projectId()) + '/canvas/jobs/' + encodeURIComponent(jobId) + '/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectKind:projectKind(),confirmProviderSpend:true})}); schedulePoll(); } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '动作迁移提交失败') + '。候选已保留，可重试。', true); button.disabled = false; } }
    async function load() {
      var project = projectId(); launcher.hidden = !project; if (!project) { panel.hidden = true; return; }
      try {
        var results = await Promise.all([api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(project)), api('/api/projects/' + encodeURIComponent(project) + '/assets', {headers: {'x-niannian-project-kind': projectKind()}}), api('/api/canvas/provider-status'), api('/api/projects/' + encodeURIComponent(project) + '/canvas/jobs?projectKind=' + encodeURIComponent(projectKind()))]);
        documentState = results[0].body.document || {version: 1, nodes: [], edges: [], viewport: {x: 0, y: 0, zoom: 1}}; revision = Number(results[0].body.revision || 0); assets = Array.isArray(results[1].body.assets) ? results[1].body.assets : [];
        var status = results[2].body.providerStatus || {};
        channels = status.animateSubmitEnabled === true ? [{id:'animate-transfer',model:'runninghub-animate-motion-transfer',label:'动作迁移（工作流）'}] : [];
        var jobs = results[3].body.jobs || []; renderAssets(); renderChannels(); renderSpec(); renderHistory(jobs); if (jobs.some(function (job) { return String(job.model || '').indexOf('runninghub-animate') === 0 && ['queued','running'].includes(job.status); })) schedulePoll(); setStatus(channels.length ? '候选先预检；点击“确认并生成”后只提交一次，结果自动回到项目素材库。' : '当前服务器尚未启用动作迁移渠道。候选无法提交；请先完成服务端配置。');
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '读取项目状态失败'), true); }
    }
    async function saveDocument(next) { var result = await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(projectId()), {method:'PUT', headers:{'content-type':'application/json','if-match':'"canvas-rev-' + revision + '"'}, body:JSON.stringify({document:next})}); documentState = result.body.document; revision = Number(result.body.revision || revision); }
    async function createCandidate() {
      var channel = currentChannel(); var imageId = selectedAsset('s3-image-asset'); var videoId = selectedAsset('s3-video-asset'); if (!channel || !imageId || !videoId) return;
      createEl.disabled = true; setStatus('正在保存动作迁移节点并建立不提交的视频候选...'); var nodeId = makeId('s3-animate'); var duration = Number(durationEl.value || 5); var ratio = ratioEl.value || '9:16';
      var node = {id:nodeId,type:'video',kind:'video',skillKey:'runninghub-animate-motion-transfer',skillVersion:'1.0.0',description:'使用当前项目图片与动作视频生成动作迁移结果；任务可刷新回读，结果回到项目素材库。',inputPorts:[{id:'image_asset',type:'image_asset',required:true},{id:'motion_video',type:'motion_video',required:true}],outputPorts:[{id:'video_asset',type:'video_asset',required:false}],parameters:{modelKey:channel.model,durationSeconds:duration,aspectRatio:ratio},assetRefs:[{assetId:imageId,projectId:projectId(),role:'character_reference'},{assetId:videoId,projectId:projectId(),role:'motion_source'}],taskRef:null,status:'draft',preview:null,recovery:{actions:['repair_input','reselect_asset','reconcile_task','retry'],lastAction:'create_candidate'},data:{title:'动作迁移视频',prompt:promptEl.value.trim(),modelKey:channel.model,videoChannel:channel.id,durationSeconds:duration,aspectRatio:ratio,assetIds:[imageId,videoId],inputAssetIds:[imageId,videoId],status:'draft'}};
      try {
        await saveDocument(Object.assign({}, documentState || {}, {nodes:(documentState && documentState.nodes || []).concat([node])}));
        var created = await api('/api/projects/' + encodeURIComponent(projectId()) + '/canvas/jobs', {method:'POST',headers:{'content-type':'application/json','idempotency-key':makeId('s3-animate-candidate')},body:JSON.stringify({projectKind:projectKind(),nodeId:nodeId,model:channel.model,prompt:promptEl.value.trim(),inputAssetIds:[imageId,videoId],aspectRatio:ratio,durationSeconds:duration})});
        var updatedNodes = (documentState.nodes || []).map(function (item) { if (item.id !== nodeId) return item; return Object.assign({}, item,{status:'queued',taskRef:{id:created.body.job.id,status:created.body.job.status},data:Object.assign({},item.data,{status:'queued',taskRef:{id:created.body.job.id,status:created.body.job.status}})}); });
        await saveDocument(Object.assign({}, documentState,{nodes:updatedNodes}));
        var dryRun = await api('/api/projects/' + encodeURIComponent(projectId()) + '/canvas/jobs/' + encodeURIComponent(created.body.job.id) + '/dry-run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectKind:projectKind()})});
        if (dryRun.body.dryRun && dryRun.body.dryRun.spendRequested === true) throw new Error('候选预检请求了消费');
        await load(); setStatus('候选已保存：5–15 秒动作迁移任务已进入待授权状态。未提交 Provider、未消费 RH 币；授权后可从任务状态继续。');
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '建立视频候选失败') + '。输入已保留，可修复后重试。', true); sync(); }
    }
    launcher.addEventListener('click', function () { panel.hidden = false; launcher.hidden = true; setSiblingVisibility(true); load(); }); panel.querySelector('[data-s3-close]').addEventListener('click', function () { panel.hidden = true; launcher.hidden = false; setSiblingVisibility(false); launcher.focus(); }); panel.querySelector('[data-s3-refresh]').addEventListener('click', load); channelEl.addEventListener('change', renderSpec); durationEl.addEventListener('change', renderSpec); ratioEl.addEventListener('change', renderSpec); promptEl.addEventListener('input', sync); createEl.addEventListener('click', createCandidate); load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true}); else mount();
}());
