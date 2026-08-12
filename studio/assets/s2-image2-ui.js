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
  function installStyles() {
    if (document.getElementById('s2-image2-ui-styles')) return;
    var style = document.createElement('style');
    style.id = 's2-image2-ui-styles';
    style.textContent = [
      '#s2-image2-launcher{position:fixed;right:18px;bottom:18px;z-index:124;min-height:44px;padding:0 14px;border:1px solid var(--nomi-line,#d8d1c6);border-radius:6px;background:var(--nomi-ink,#2a2118);color:var(--nomi-paper,#fffaf3);font:600 13px/1.2 Inter,system-ui,sans-serif;box-shadow:0 10px 28px rgba(42,33,24,.18);cursor:pointer}#s2-image2-launcher:focus-visible{outline:2px solid var(--nomi-accent,#9a6a3c);outline-offset:3px}#s2-image2-launcher[hidden]{display:none}',
      '#s2-image2-panel{position:fixed;right:18px;top:72px;z-index:125;width:min(392px,calc(100vw - 36px));max-height:calc(100vh - 144px);overflow:auto;padding:16px;border:1px solid var(--nomi-line,#d8d1c6);border-radius:6px;background:rgba(255,252,246,.98);color:#2a2118;box-shadow:0 18px 50px rgba(42,33,24,.18);font:13px/1.45 Inter,system-ui,sans-serif;backdrop-filter:blur(14px)}#s2-image2-panel[hidden]{display:none}#s2-image2-panel h2{margin:0;font-size:16px;font-weight:700}#s2-image2-panel h3{margin:16px 0 6px;font-size:12px;font-weight:700}#s2-image2-panel p{margin:5px 0;color:#786958}#s2-image2-panel .s2-header{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}#s2-image2-panel .s2-eyebrow{font-size:10px;font-weight:700;letter-spacing:.11em;color:#9a6a3c}#s2-image2-panel .s2-close{min-height:32px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:#5d4d3d;cursor:pointer;font:inherit}#s2-image2-panel .s2-close:hover{background:#f2eadf}',
      '#s2-image2-panel .s2-field{display:grid;gap:5px;margin-top:10px}#s2-image2-panel label{font-size:12px;font-weight:600;color:#4c3828}#s2-image2-panel textarea,#s2-image2-panel select{box-sizing:border-box;width:100%;min-height:36px;border:1px solid rgba(90,64,42,.24);border-radius:5px;background:#fff;color:#2a2118;padding:8px;font:inherit}#s2-image2-panel textarea{min-height:72px;resize:vertical}#s2-image2-panel select:focus-visible,#s2-image2-panel textarea:focus-visible{outline:2px solid #9a6a3c;outline-offset:1px}',
      '#s2-image2-panel .s2-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}#s2-image2-panel .s2-assets{display:grid;gap:6px;margin-top:8px;max-height:160px;overflow:auto}#s2-image2-panel .s2-asset{display:flex;gap:8px;align-items:center;padding:7px;border:1px solid rgba(90,64,42,.14);border-radius:5px;background:#fffaf3;cursor:pointer}#s2-image2-panel .s2-asset:has(input:checked){border-color:#9a6a3c;background:#f8eee2}#s2-image2-panel .s2-thumb{width:34px;height:34px;flex:0 0 34px;object-fit:cover;border-radius:4px;background:#eee5d9}#s2-image2-panel .s2-asset-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#s2-image2-panel .s2-spec{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:8px;border:1px solid rgba(90,64,42,.13);border-radius:5px;background:#f7f1e8;color:#5d4d3d}#s2-image2-panel .s2-spec strong{color:#2a2118}#s2-image2-panel .s2-actions{display:flex;gap:8px;align-items:center;margin-top:14px}#s2-image2-panel button.s2-primary{min-height:40px;padding:0 12px;border:0;border-radius:5px;background:#2a2118;color:#fff;cursor:pointer;font:600 13px/1 system-ui}#s2-image2-panel button.s2-primary:hover{background:#513d2b}#s2-image2-panel button.s2-primary[disabled]{opacity:.45;cursor:default}#s2-image2-panel .s2-secondary{min-height:40px;padding:0 10px;border:1px solid rgba(90,64,42,.16);border-radius:5px;background:#f2eadf;color:#4c3828;cursor:pointer;font:600 12px/1 system-ui}',
      '#s2-image2-panel .s2-status{margin-top:12px;padding:9px;border-radius:5px;background:#f4eee6;color:#5d4d3d;white-space:pre-wrap}#s2-image2-panel .s2-status.error{background:#fff0ee;color:#a33b2d}#s2-image2-panel .s2-history{display:grid;gap:6px;margin-top:8px}#s2-image2-panel .s2-job{padding:8px;border-top:1px solid rgba(90,64,42,.12)}#s2-image2-panel .s2-job:first-child{border-top:0}#s2-image2-panel .s2-job-title{display:flex;justify-content:space-between;gap:8px;font-weight:600}#s2-image2-panel .s2-job small{color:#786958}#s2-image2-panel .s2-output{display:block;width:100%;max-height:160px;margin-top:7px;object-fit:contain;border-radius:5px;background:#eee5d9}',
      '@media (max-width:600px){#s2-image2-launcher{right:10px;bottom:calc(10px + env(safe-area-inset-bottom))}#s2-image2-panel{right:10px;top:58px;width:calc(100vw - 20px);max-height:calc(100vh - 124px);padding:14px}#s2-image2-panel .s2-grid{grid-template-columns:minmax(0,1fr)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function mount() {
    if (document.getElementById('s2-image2-panel')) return;
    installStyles();
    var launcher = document.createElement('button');
    launcher.id = 's2-image2-launcher'; launcher.type = 'button'; launcher.hidden = true;
    launcher.textContent = '关键帧图像'; launcher.setAttribute('aria-label', '打开关键帧图像候选'); document.body.appendChild(launcher);
    var panel = document.createElement('section');
    panel.id = 's2-image2-panel'; panel.hidden = true; panel.setAttribute('aria-label', '关键帧图像候选');
    panel.innerHTML = '<div class="s2-header"><div><div class="s2-eyebrow">S2 IMAGE2</div><h2>关键帧图像</h2><p>在当前项目内选择一张参考图，建立可恢复候选。此处不会直接提交生成或消费额度。</p></div><button class="s2-close" type="button" data-s2-close aria-label="关闭关键帧图像">关闭</button></div><h3>输入参考</h3><div class="s2-assets" data-s2-assets><span>正在读取项目图片...</span></div><div class="s2-field"><label for="s2-image2-prompt">画面说明</label><textarea id="s2-image2-prompt" data-s2-prompt placeholder="描述主体、构图、光线和需要保留的参考特征"></textarea></div><div class="s2-grid"><div class="s2-field"><label for="s2-image2-channel">输出档位</label><select id="s2-image2-channel" data-s2-channel></select></div><div class="s2-field"><label for="s2-image2-resolution">清晰度</label><select id="s2-image2-resolution" data-s2-resolution></select></div></div><div class="s2-field"><label for="s2-image2-ratio">画面比例</label><select id="s2-image2-ratio" data-s2-ratio></select></div><div class="s2-spec" data-s2-spec>正在读取输出规格...</div><div class="s2-actions"><button type="button" class="s2-primary" data-s2-create disabled>建立生成候选</button><button type="button" class="s2-secondary" data-s2-refresh>刷新</button></div><div class="s2-status" data-s2-status aria-live="polite">选择一张项目图片后，填写画面说明。</div><h3>当前项目的图像候选</h3><div class="s2-history" data-s2-history>暂无候选。</div>';
    document.body.appendChild(panel);
    var assetsEl = panel.querySelector('[data-s2-assets]'); var channelEl = panel.querySelector('[data-s2-channel]'); var resolutionEl = panel.querySelector('[data-s2-resolution]'); var ratioEl = panel.querySelector('[data-s2-ratio]'); var promptEl = panel.querySelector('[data-s2-prompt]'); var createEl = panel.querySelector('[data-s2-create]'); var historyEl = panel.querySelector('[data-s2-history]'); var specEl = panel.querySelector('[data-s2-spec]'); var statusEl = panel.querySelector('[data-s2-status]');
    var revision = 0; var documentState = null; var assets = []; var channels = [];
    function setStatus(message, error) { statusEl.textContent = message; statusEl.classList.toggle('error', Boolean(error)); }
    function selectedAssetId() { var selected = panel.querySelector('input[name="s2-reference-asset"]:checked'); return selected ? selected.value : ''; }
    function currentChannel() { return channels.find(function (item) { return item.id === channelEl.value; }) || null; }
    function sync() { createEl.disabled = !selectedAssetId() || !promptEl.value.trim() || !currentChannel() || !resolutionEl.value || !ratioEl.value; }
    function renderAssets() {
      var images = assets.filter(function (asset) { return String(asset.mimeType || '').indexOf('image/') === 0; });
      assetsEl.innerHTML = images.length ? images.map(function (asset) { var url = asset.downloadUrl || ''; return '<label class="s2-asset"><input type="radio" name="s2-reference-asset" value="' + escapeHtml(asset.id) + '">' + (url ? '<img class="s2-thumb" src="' + escapeHtml(url) + '" alt="">' : '<span class="s2-thumb" aria-hidden="true"></span>') + '<span class="s2-asset-name">' + escapeHtml(asset.originalName || asset.id) + '</span></label>'; }).join('') : '<span>当前项目暂无图片素材。先在素材库上传或从上游节点生成一张图。</span>';
      panel.querySelectorAll('input[name="s2-reference-asset"]').forEach(function (input) { input.addEventListener('change', sync); });
    }
    function renderSpecs() {
      var current = currentChannel(); var resolutions = current && Array.isArray(current.resolutions) ? current.resolutions : []; var ratios = current && Array.isArray(current.aspectRatios) ? current.aspectRatios : []; var previousResolution = resolutionEl.value; var previousRatio = ratioEl.value;
      resolutionEl.innerHTML = resolutions.map(function (item) { return '<option value="' + escapeHtml(item) + '">' + escapeHtml(item.toUpperCase()) + '</option>'; }).join(''); ratioEl.innerHTML = ratios.map(function (item) { return '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + '</option>'; }).join('');
      if (resolutions.indexOf(previousResolution) >= 0) resolutionEl.value = previousResolution; if (ratios.indexOf(previousRatio) >= 0) ratioEl.value = previousRatio;
      var size = current && current.outputSizes ? current.outputSizes[resolutionEl.value] : ''; specEl.innerHTML = '<strong>输出规格</strong><span>' + escapeHtml(resolutionEl.value ? resolutionEl.value.toUpperCase() : '—') + '</span><span>' + escapeHtml(ratioEl.value || '—') + '</span><span>' + escapeHtml(size || '由当前比例决定') + '</span>'; resolutionEl.disabled = !resolutions.length; ratioEl.disabled = !ratios.length; sync();
    }
    function renderChannels() { channelEl.innerHTML = channels.length ? channels.map(function (item) { return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.label) + '</option>'; }).join('') : '<option value="">暂无可用图像档位</option>'; channelEl.disabled = !channels.length; renderSpecs(); }
    function renderHistory(jobs) {
      var items = (Array.isArray(jobs) ? jobs : []).filter(function (job) { return job.nodeType === 'image'; }).slice(0, 5);
      historyEl.innerHTML = items.length ? items.map(function (job) { var outputId = Array.isArray(job.outputAssetIds) && job.outputAssetIds[0]; var image = outputId ? '<img class="s2-output" src="/api/projects/' + encodeURIComponent(projectId()) + '/assets/' + encodeURIComponent(outputId) + '/download" alt="已生成的关键帧图像">' : ''; return '<article class="s2-job"><div class="s2-job-title"><span>' + escapeHtml(job.imageChannelLabel || '关键帧图像') + '</span><small>' + escapeHtml(job.status || 'draft') + '</small></div><small>' + escapeHtml((job.resolution || '—').toUpperCase() + ' · ' + (job.aspectRatio || '—') + ' · ' + (job.outputSize || '规格待确认')) + '</small>' + image + '</article>'; }).join('') : '暂无图像候选。';
    }
    async function load() {
      var project = projectId(); launcher.hidden = !project; if (!project) { panel.hidden = true; return; }
      try {
        var results = await Promise.all([api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(project)), api('/api/projects/' + encodeURIComponent(project) + '/assets', {headers: {'x-niannian-project-kind': projectKind()}}), api('/api/canvas/provider-status'), api('/api/projects/' + encodeURIComponent(project) + '/canvas/jobs?projectKind=' + encodeURIComponent(projectKind()))]);
        documentState = results[0].body.document || {version: 1, nodes: [], edges: [], viewport: {x: 0, y: 0, zoom: 1}}; revision = Number(results[0].body.revision || 0); assets = Array.isArray(results[1].body.assets) ? results[1].body.assets : []; var providerStatus = results[2].body.providerStatus || {}; channels = (Array.isArray(providerStatus.imageChannels) ? providerStatus.imageChannels : []).filter(function (item) { return item.submitEnabled === true; });
        renderAssets(); renderChannels(); renderHistory(results[3].body.jobs || []); setStatus(channels.length ? '输入、规格和候选都只属于当前项目。建立候选不会提交生成。' : '当前服务器尚未启用图像档位。候选无法建立；请由部署负责人完成环境配置。');
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '读取项目状态失败'), true); }
    }
    async function saveDocument(document) {
      var result = await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(projectId()), {method: 'PUT', headers: {'content-type': 'application/json', 'if-match': '"canvas-rev-' + revision + '"'}, body: JSON.stringify({document: document})}); documentState = result.body.document; revision = Number(result.body.revision || revision);
    }
    async function createCandidate() {
      var selectedChannel = currentChannel(); var assetId = selectedAssetId(); if (!selectedChannel || !assetId || !promptEl.value.trim()) return; createEl.disabled = true; setStatus('正在保存节点并建立不提交的图像候选...'); var nodeId = makeId('s2-image2'); var parameters = {modelKey: selectedChannel.id, resolution: resolutionEl.value, aspectRatio: ratioEl.value, outputSize: (selectedChannel.outputSizes || {})[resolutionEl.value] || null};
      var node = {id: nodeId, type: 'image', kind: 'image', skillKey: 'image2-storyboard-video', skillVersion: '1.0.0', description: '根据当前项目参考图生成关键帧图像；候选建立后仍需在生成检查器明确确认提交。', inputPorts: [{id: 'prompt', type: 'prompt', required: true}, {id: 'reference_asset', type: 'reference_asset', required: true}], outputPorts: [{id: 'image_asset', type: 'image_asset', required: false}], parameters: parameters, assetRefs: [{assetId: assetId, projectId: projectId(), role: 'reference_asset'}], taskRef: null, status: 'draft', preview: null, recovery: {actions: ['repair_input', 'reselect_asset', 'retry'], lastAction: 'create_candidate'}, data: {title: '关键帧图像', prompt: promptEl.value.trim(), modelKey: selectedChannel.id, resolution: resolutionEl.value, aspectRatio: ratioEl.value, outputSize: parameters.outputSize, assetIds: [assetId], status: 'draft'}};
      try {
        await saveDocument(Object.assign({}, documentState || {}, {nodes: (documentState && documentState.nodes || []).concat([node])}));
        var created = await api('/api/projects/' + encodeURIComponent(projectId()) + '/canvas/jobs', {method: 'POST', headers: {'content-type': 'application/json', 'idempotency-key': makeId('s2-image2-candidate')}, body: JSON.stringify({projectKind: projectKind(), nodeId: nodeId, model: selectedChannel.id, prompt: promptEl.value.trim(), inputAssetIds: [assetId], resolution: resolutionEl.value, aspectRatio: ratioEl.value})});
        var nodeStatus = created.body.job.status === 'awaiting_authorization' ? 'queued' : created.body.job.status;
        var updatedNodes = (documentState.nodes || []).map(function (item) { if (item.id !== nodeId) return item; return Object.assign({}, item, {status: nodeStatus, taskRef: {id: created.body.job.id, status: created.body.job.status}, data: Object.assign({}, item.data, {status: nodeStatus, taskRef: {id: created.body.job.id, status: created.body.job.status}})}); });
        await saveDocument(Object.assign({}, documentState, {nodes: updatedNodes}));
        var dryRun = await api('/api/projects/' + encodeURIComponent(projectId()) + '/canvas/jobs/' + encodeURIComponent(created.body.job.id) + '/dry-run', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({projectKind: projectKind()})});
        if (dryRun.body.dryRun && dryRun.body.dryRun.spendRequested === true) throw new Error('候选预检请求了消费');
        var candidateMessage = '候选已保存：' + (created.body.job.outputSize || parameters.outputSize || '输出规格待确认') + '。当前未提交生成、未消费额度；请在生成检查器确认后再提交。'; await load(); setStatus(candidateMessage);
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '建立候选失败') + '。已保留输入，可修复后重试。', true); sync(); }
    }
    function setS1Visibility(visible) { var s1 = document.getElementById('s1-chain-panel'); if (s1) s1.hidden = !visible; }
    launcher.addEventListener('click', function () { panel.hidden = false; launcher.hidden = true; setS1Visibility(false); load(); }); panel.querySelector('[data-s2-close]').addEventListener('click', function () { panel.hidden = true; launcher.hidden = false; setS1Visibility(true); launcher.focus(); }); panel.querySelector('[data-s2-refresh]').addEventListener('click', load); channelEl.addEventListener('change', renderSpecs); resolutionEl.addEventListener('change', renderSpecs); ratioEl.addEventListener('change', sync); promptEl.addEventListener('input', sync); createEl.addEventListener('click', createCandidate); load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();
}());
