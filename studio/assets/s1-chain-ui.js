(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function projectId() {
    var sources = [window.location.search, String(window.location.hash || '').split('?')[1] || ''];
    for (var i = 0; i < sources.length; i += 1) {
      var value = new URLSearchParams(sources[i]).get('projectId');
      if (value) return value.trim();
    }
    return '';
  }

  function projectKind() {
    var sources = [window.location.search, String(window.location.hash || '').split('?')[1] || ''];
    for (var i = 0; i < sources.length; i += 1) {
      var value = new URLSearchParams(sources[i]).get('projectKind');
      if (value === 'script' || value === 'redraw') return value;
    }
    return 'redraw';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }

  async function api(path, init) {
    var response = await fetch(path, Object.assign({credentials: 'same-origin'}, init || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.error || '请求失败');
      error.status = response.status;
      error.code = body.code;
      throw error;
    }
    return {body: body, headers: response.headers};
  }

  function installStyles() {
    if (document.getElementById('s1-chain-ui-styles')) return;
    var style = document.createElement('style');
    style.id = 's1-chain-ui-styles';
    style.textContent = [
      '#s1-chain-panel{position:fixed;left:18px;top:72px;z-index:120;width:min(360px,calc(100vw - 36px));max-height:calc(100vh - 96px);overflow:auto;padding:16px;color:#2a2118;background:rgba(255,252,246,.96);border:1px solid rgba(90,64,42,.18);border-radius:12px;box-shadow:0 18px 50px rgba(42,33,24,.16);font:13px/1.45 Inter,system-ui,sans-serif;backdrop-filter:blur(14px)}',
      '#s1-chain-panel[hidden]{display:none}#s1-chain-panel h2{margin:0;font-size:16px;font-weight:700}#s1-chain-panel p{margin:5px 0 12px;color:#786958}#s1-chain-panel .s1-eyebrow{font-size:10px;letter-spacing:.12em;color:#9a6a3c;font-weight:700}#s1-chain-panel .s1-assets{display:grid;gap:6px;margin:10px 0 12px}',
      '#s1-chain-panel label.s1-asset{display:flex;gap:8px;align-items:center;padding:8px;border:1px solid rgba(90,64,42,.12);border-radius:8px;background:#fffaf3;cursor:pointer}#s1-chain-panel label.s1-asset:hover{border-color:#b78455}#s1-chain-panel .s1-asset-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#s1-chain-panel .s1-row{display:flex;gap:8px;align-items:center;margin:8px 0}#s1-chain-panel select{flex:1;padding:7px;border:1px solid rgba(90,64,42,.2);border-radius:7px;background:#fff}#s1-chain-panel button{border:0;border-radius:7px;padding:8px 11px;background:#2a2118;color:#fff;cursor:pointer;font-weight:600}#s1-chain-panel button[disabled]{opacity:.45;cursor:default}#s1-chain-panel .s1-secondary{background:#efe5d8;color:#4c3828}#s1-chain-panel .s1-status{margin-top:10px;padding:9px;border-radius:8px;background:#f4eee6;color:#5d4d3d;white-space:pre-wrap}#s1-chain-panel .s1-status.error{background:#fff0ee;color:#a33b2d}#s1-chain-panel .s1-nodes{display:grid;gap:5px;margin-top:10px}#s1-chain-panel .s1-node{display:flex;justify-content:space-between;gap:8px;padding:7px 8px;background:#faf5ef;border-radius:7px}#s1-chain-panel .s1-node small{color:#8b7764}#s1-chain-panel .s1-readiness{margin-top:10px;padding:9px;border:1px solid rgba(90,64,42,.12);border-radius:8px;background:#fffaf3;color:#5d4d3d}#s1-chain-panel .s1-readiness strong{display:block;color:#2a2118;margin-bottom:3px}#s1-chain-panel .s1-readiness[data-state="ready"]{border-color:#6f9b72;background:#f1f8f0}#s1-chain-panel .s1-readiness[data-state="blocked"]{border-color:#d7b6a8;background:#fff5f1}',
      '@media (max-width:600px){#s1-chain-panel{left:10px;top:58px;width:calc(100vw - 20px);max-height:calc(100vh - 70px)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function mount() {
    if (document.getElementById('s1-chain-panel')) return;
    var panel = document.createElement('section');
    panel.id = 's1-chain-panel';
    panel.setAttribute('aria-label', 'S1 原片到时间线');
    panel.hidden = true;
    panel.innerHTML = '<div class="s1-eyebrow">S1 CANVAS CHAIN</div><h2>原片到 Step02 时间线</h2><p>选择一份当前项目原片并确认权利。服务器会复制同一文件、校验 SHA 并执行媒体预检。</p><div class="s1-assets" data-s1-assets><span>正在读取项目素材...</span></div><label class="s1-row"><input type="checkbox" data-s1-rights> 我确认拥有该原片的使用与改编权限</label><div class="s1-row"><button type="button" data-s1-refresh class="s1-secondary">刷新素材</button><button type="button" data-s1-create disabled>绑定原片并创建节点</button></div><div class="s1-readiness" data-s1-readiness data-state="blocked"><strong>Step01 运行状态</strong>完成原片绑定后检查服务器分析环境。</div><div class="s1-row"><button type="button" data-s1-start disabled>开始 Step01 服务器分析</button><button type="button" data-s1-step02-prepare class="s1-secondary" disabled>准备 Step02 时间线</button></div><div class="s1-status" data-s1-status>等待选择一份视频素材。</div><div class="s1-nodes" data-s1-nodes hidden></div>';
    document.body.appendChild(panel);
    installStyles();
    var assetsEl = panel.querySelector('[data-s1-assets]');
    var statusEl = panel.querySelector('[data-s1-status]');
    var nodesEl = panel.querySelector('[data-s1-nodes]');
    var createBtn = panel.querySelector('[data-s1-create]');
    var startBtn = panel.querySelector('[data-s1-start]');
    var prepareStep02Btn = panel.querySelector('[data-s1-step02-prepare]');
    var rightsEl = panel.querySelector('[data-s1-rights]');
    var revision = 0;
    var assets = [];

    function setStatus(message, error) { statusEl.textContent = message; statusEl.classList.toggle('error', Boolean(error)); }
    function renderNodes(nodes) {
      var items = Array.isArray(nodes) ? nodes.filter(function (node) { return /^s1-/.test(node && node.id); }) : [];
      nodesEl.hidden = items.length === 0;
      nodesEl.innerHTML = items.map(function (node) { return '<div class="s1-node"><span>' + escapeHtml(node.data && node.data.title || node.id) + '</span><small>' + escapeHtml(node.status || 'draft') + '</small></div>'; }).join('');
    }
    function renderReadiness(readiness) {
      var el = panel.querySelector('[data-s1-readiness]');
      if (!readiness) {
        el.dataset.state = 'blocked';
        el.innerHTML = '<strong>Step01 运行状态</strong>完成原片绑定后检查服务器分析环境。';
        startBtn.disabled = true;
        prepareStep02Btn.disabled = true;
        renderNodes([]);
        return;
      }
      var source = readiness.source || {};
      var execution = readiness.execution || {};
      var lines = [source.status === 'ready' ? '原片：已通过服务器预检' : '原片：尚未完成预检', execution.ready ? '服务器分析环境：已配置' : '服务器分析环境：尚未就绪', readiness.nextAction || '等待状态更新。'];
      el.dataset.state = readiness.startAllowed || readiness.analysis && readiness.analysis.ready ? 'ready' : 'blocked';
      el.innerHTML = '<strong>Step01 运行状态</strong>' + lines.map(function (line) { return '<div>' + escapeHtml(line) + '</div>'; }).join('');
      startBtn.disabled = readiness.startAllowed !== true;
      prepareStep02Btn.disabled = !Array.isArray(readiness.nodes) || !readiness.nodes.some(function (node) { return node.id === 's1-step02-timeline' && node.status === 'ready'; });
      renderNodes(readiness.nodes);
    }
    function selectedIds() { return Array.prototype.slice.call(panel.querySelectorAll('input[data-s1-asset]:checked')).map(function (input) { return input.value; }); }
    function syncButton() { createBtn.disabled = selectedIds().length !== 1 || !rightsEl.checked; }
    function renderAssets() {
      var videos = assets.filter(function (asset) { return String(asset.mimeType || '').startsWith('video/'); });
      assetsEl.innerHTML = videos.length ? videos.map(function (asset) { return '<label class="s1-asset"><input type="radio" name="s1-source-asset" data-s1-asset value="' + escapeHtml(asset.id) + '"><span class="s1-asset-name">' + escapeHtml(asset.originalName || asset.id) + '</span></label>'; }).join('') : '<span>当前项目暂无视频素材，请先在素材库上传原片。</span>';
      panel.querySelectorAll('input[data-s1-asset]').forEach(function (input) { input.addEventListener('change', syncButton); });
      syncButton();
    }
    async function load() {
      var id = projectId();
      if (!id) { panel.hidden = true; return; }
      panel.hidden = false;
      try {
        var doc = await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(id));
        revision = Number(doc.body.revision || 0);
        var listed = await api('/api/projects/' + encodeURIComponent(id) + '/assets', {headers: {'x-niannian-project-kind': projectKind()}});
        var readiness = await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(id) + '/s1-readiness');
        assets = Array.isArray(listed.body.assets) ? listed.body.assets : [];
        renderAssets();
        renderReadiness(readiness.body.readiness);
        setStatus(doc.body.document && doc.body.document.nodes && doc.body.document.nodes.some(function (node) { return node.id === 's1-source-input'; }) ? 'S1 节点链已存在，可继续在画布中编辑。' : '等待选择视频素材。');
      } catch (error) { renderReadiness(null); setStatus(error.message || '读取项目状态失败', true); }
    }
    async function create() {
      createBtn.disabled = true;
      setStatus('正在绑定原片并执行服务器媒体预检...');
      try {
        var id = projectId();
        var selected = selectedIds();
        var binding = await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(id) + '/s1-source-binding', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({sourceAssetId: selected[0], rightsConfirmed: rightsEl.checked})});
        var passed = binding.body && binding.body.preflight && binding.body.preflight.status === 'passed';
        var result = await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(id) + '/s1-chain', {method: 'POST', headers: {'content-type': 'application/json', 'if-match': '"canvas-rev-' + revision + '"'}, body: JSON.stringify({sourceAssetIds: selected, rightsConfirmed: rightsEl.checked, preflightStatus: passed ? 'passed' : 'blocked'})});
        revision = Number(result.body.revision || revision);
        renderNodes(result.body.document && result.body.document.nodes || []);
        var bindingMessage = passed ? '原片已绑定、SHA 已校验、媒体预检已通过。已创建 3 个节点和 2 条依赖边；可在运行状态卡确认是否能开始 Step01。' : '原片已绑定，但服务器媒体预检未通过。节点已保留，请修复该视频后在新项目重新绑定。';
        setStatus(bindingMessage);
        await load();
        setStatus(bindingMessage);
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '创建失败'), true); syncButton(); }
    }
    async function start() {
      startBtn.disabled = true;
      setStatus('正在创建当前源片的 Step01 分析任务...');
      try {
        var id = projectId();
        var result = await api('/api/projects/' + encodeURIComponent(id) + '/step01-analysis', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
        setStatus(result.body.code === 'STEP01_EVIDENCE_ALREADY_READY' ? 'Step01 证据已就绪，可进入 Step02。' : 'Step01 分析任务已创建。离开页面后仍会继续；刷新可查看状态。');
        await load();
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '启动 Step01 失败'), true); await load(); }
    }
    async function prepareStep02() {
      prepareStep02Btn.disabled = true;
      setStatus('正在准备 Step02 时间线事务...');
      try {
        var id = projectId();
        await api('/api/canvas/documents/' + encodeURIComponent(projectKind()) + '/' + encodeURIComponent(id) + '/s1-step02-prepare', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
        setStatus('Step02 时间线事务已准备。后续回读和接受仍需明确用户动作；本次未调用媒体 Provider。');
        await load();
      } catch (error) { setStatus((error.code ? error.code + ': ' : '') + (error.message || '准备 Step02 失败'), true); await load(); }
    }
    panel.querySelector('[data-s1-refresh]').addEventListener('click', load);
    rightsEl.addEventListener('change', syncButton); createBtn.addEventListener('click', create); startBtn.addEventListener('click', start); prepareStep02Btn.addEventListener('click', prepareStep02);
    load();
    window.addEventListener('hashchange', load);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();
}());
