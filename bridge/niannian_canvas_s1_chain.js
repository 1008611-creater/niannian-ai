'use strict';

// S1 canvas chain: source intake -> Step01 evidence -> Step02 timeline.
// This module only creates inspectable nodes; it never starts a provider task.

const SOURCE_NODE_ID = 's1-source-input';
const STEP01_NODE_ID = 's1-step01-analysis';
const STEP02_NODE_ID = 's1-step02-timeline';
const CHAIN_NODE_IDS = Object.freeze([SOURCE_NODE_ID, STEP01_NODE_ID, STEP02_NODE_ID]);

function text(value, limit = 200) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').trim().slice(0, limit);
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => text(value, 120)).filter(value => /^[A-Za-z0-9_.:-]{2,120}$/.test(value)))].slice(0, 8);
}

function edge(id, source, target) { return {id, source, target, kind:'depends_on'}; }

function sourceBindingValue(value) {
  if (!value || typeof value !== 'object') return null;
  const assetId = text(value.assetId, 120);
  const sourceSha256 = text(value.sourceSha256, 64).toLowerCase();
  const preflightStatus = text(value.preflightStatus, 40);
  if (!assetId || !/^[A-Za-z0-9_.:-]{2,120}$/.test(assetId) || !/^[a-f0-9]{64}$/.test(sourceSha256)) return null;
  return {
    assetId,
    sourceSha256,
    sourceBytes:Number.isSafeInteger(Number(value.sourceBytes)) && Number(value.sourceBytes) > 0 ? Number(value.sourceBytes) : null,
    rightsEventId:text(value.rightsEventId, 80) || null,
    preflightStatus:preflightStatus === 'passed' ? 'passed' : 'blocked',
    boundAt:text(value.boundAt, 80) || null
  };
}

function projectState(value) {
  const project = value && typeof value === 'object' ? value : {};
  const analysisStatus = text(project.analysis?.status, 80) || 'awaiting_source_binding';
  const step02Status = text(project.step02?.status, 80) || null;
  return {analysisStatus,step02Status};
}

function step01Projection({sourceReady, analysisStatus, runtime = null}) {
  const active = ['queued','capability_preflight','codex_dispatched','codex_running','return_received','reducer_verifying','running','prepared'].includes(analysisStatus);
  if (analysisStatus === 'evidence_ready') return {status:'succeeded',note:'Step01 证据已验证完成；Step02 只能消费当前源片的不可变 evidence manifest。',parameters:{gateState:'step01_evidence_ready',blocker:null}};
  if (active) return {status:'running',note:'Step01 正在运行或等待服务端回读；刷新后会读取同一次任务状态，不会重复提交。',parameters:{gateState:'step01_active',blocker:null}};
  if (!sourceReady) return {status:'blocked',note:'先完成原片输入、权利确认和媒体预检。',parameters:{gateState:'source_input_incomplete',blocker:'SOURCE_INPUT_INCOMPLETE'}};
  if (runtime && runtime.ready === false) return {status:'blocked',note:'源片已锁定，但服务器分析环境尚未就绪；不会创建分析任务。',parameters:{gateState:'step01_runtime_blocked',blocker:text(runtime.blocker, 120) || 'STEP01_HQ_RUNTIME_NOT_CONFIGURED'}};
  return {status:'blocked',note:'已锁定当前源片 SHA；等待用户启动 Haika hq_full 完整证据链，不读取旧证据。',parameters:{gateState:'step01_awaiting_user_start',blocker:'STEP01_USER_START_REQUIRED'}};
}

function step02Projection({analysisStatus, step02Status}) {
  if (step02Status === 'step02_accepted') return {status:'succeeded',note:'Step02 时间线已由服务端 reducer 接受，可以进入后续改编与资产阶段。',parameters:{gateState:'step02_accepted',blocker:null}};
  if (step02Status === 'candidate_return_ready') return {status:'needs_review',note:'Step02 候选已回读，等待项目 owner 审阅和接受。',parameters:{gateState:'step02_candidate_review',blocker:null}};
  if (['prepared','dispatch_prepared','carrier_running','running_step02','step02_return_ready'].includes(step02Status)) return {status:'running',note:'Step02 事务已准备或正在回读；不会把候选当作已接受时间线。',parameters:{gateState:'step02_transaction_active',blocker:null}};
  if (analysisStatus === 'evidence_ready') return {status:'ready',note:'Step01 证据已验证。可由用户准备 Step02 时间线事务；准备本身不调用媒体 Provider。',parameters:{gateState:'step02_prepare_available',blocker:null}};
  return {status:'blocked',note:'Step01 证据通过后自动解锁；不使用旧镜头或目录扫描。',parameters:{gateState:'step01_evidence_required',blocker:'STEP01_EVIDENCE_REQUIRED'}};
}

function createChain({projectId, sourceAssetIds = [], rightsConfirmed = false, preflightStatus = null, sourceBinding = null, existingNodes = [], step01Project = null, runtime = null} = {}) {
  const assets = uniqueIds(sourceAssetIds);
  const preflight = text(preflightStatus, 40) === 'passed' ? 'passed' : null;
  const binding = sourceBindingValue(sourceBinding);
  const sourceReady = Boolean(binding && assets.length === 1 && assets[0] === binding.assetId && binding.preflightStatus === 'passed');
  const state = projectState(step01Project);
  const step01 = step01Projection({sourceReady,analysisStatus:state.analysisStatus,runtime});
  const step02 = step02Projection({analysisStatus:state.analysisStatus,step02Status:state.step02Status});
  const priorById = new Map((Array.isArray(existingNodes) ? existingNodes : []).filter(node => node && CHAIN_NODE_IDS.includes(node.id)).map(node => [node.id, node]));
  const position = (id, fallback) => priorById.get(id)?.position || fallback;
  const sourceNode = {
    id:SOURCE_NODE_ID,
    type:'source_input',
    kind:'source_input',
    skillKey:'mx-shortdrama-00-router',
    description:'上传有权使用的原片，完成权利声明与媒体预检后进入 Step01。',
    parameters:{rightsConfirmed:binding ? true : rightsConfirmed === true, preflightStatus:binding?.preflightStatus || preflight, sourceBinding:binding, gateState:sourceReady ? 'source_ready' : 'source_input_incomplete'},
    assetRefs:assets.map(assetId => ({assetId, projectId, role:'source_video'})),
    status:sourceReady ? 'ready' : 'draft',
    recovery:{actions:['repair_input','reselect_asset'],lastAction:null},
    position:position(SOURCE_NODE_ID, {x:120,y:160}),
    data:{title:'原片输入与权利确认',note:sourceReady ? '已绑定当前项目源片并通过服务器媒体预检。' : '先上传原片并完成权利确认、媒体预检。',assetIds:assets,inputAssetIds:[],status:sourceReady ? 'ready' : 'draft',skillKey:'mx-shortdrama-00-router',description:'上传有权使用的原片，完成权利声明与媒体预检后进入 Step01。',parameters:{rightsConfirmed:binding ? true : rightsConfirmed === true,preflightStatus:binding?.preflightStatus || preflight,sourceBinding:binding,gateState:sourceReady ? 'source_ready' : 'source_input_incomplete'},assetRefs:assets.map(assetId => ({assetId,projectId,role:'source_video'})),recovery:{actions:['repair_input','reselect_asset'],lastAction:null}}
  };
  const step01Node = {
    id:STEP01_NODE_ID,
    type:'analysis',
    kind:'analysis',
    skillKey:'mx-shortdrama-01-frame-extract',
    description:'提取原片镜头、关键帧、对白、OCR 与证据清单；没有完整服务器证据时保持阻塞。',
    parameters:{profile:'hq_full',providerSubmitRequested:false,sourceSha256:binding?.sourceSha256 || null,...step01.parameters},
    status:step01.status,
    recovery:{actions:['repair_input','reconcile_task'],lastAction:null},
    position:position(STEP01_NODE_ID, {x:480,y:160}),
    data:{title:'Step01 源片分析',note:step01.note,assetIds:[],inputAssetIds:assets,status:step01.status,skillKey:'mx-shortdrama-01-frame-extract',description:'提取原片镜头、关键帧、对白、OCR 与证据清单；没有完整服务器证据时保持阻塞。',parameters:{profile:'hq_full',providerSubmitRequested:false,sourceSha256:binding?.sourceSha256 || null,...step01.parameters},recovery:{actions:['repair_input','reconcile_task'],lastAction:null}}
  };
  const step02Node = {
    id:STEP02_NODE_ID,
    type:'timeline',
    kind:'timeline',
    skillKey:'mx-shortdrama-02-source-timeline',
    description:'只消费已验证的 Step01 证据，生成可确认的源片事实时间线。',
    parameters:step02.parameters,
    status:step02.status,
    recovery:{actions:['reconcile_task','rollback'],lastAction:null},
    position:position(STEP02_NODE_ID, {x:840,y:160}),
    data:{title:'Step02 源片时间线',note:step02.note,assetIds:[],inputAssetIds:[],status:step02.status,skillKey:'mx-shortdrama-02-source-timeline',description:'只消费已验证的 Step01 证据，生成可确认的源片事实时间线。',parameters:step02.parameters,recovery:{actions:['reconcile_task','rollback'],lastAction:null}}
  };
  return {nodes:[sourceNode, step01Node, step02Node],edges:[edge('s1-edge-source-step01', SOURCE_NODE_ID, STEP01_NODE_ID),edge('s1-edge-step01-step02', STEP01_NODE_ID, STEP02_NODE_ID)],sourceReady};
}

function mergeChain(document, chain) {
  const current = document && typeof document === 'object' ? document : {};
  const existingNodes = Array.isArray(current.nodes) ? current.nodes : [];
  const existingEdges = Array.isArray(current.edges) ? current.edges : [];
  const chainIds = new Set(CHAIN_NODE_IDS);
  const chainEdgeIds = new Set(chain.edges.map(item => item.id));
  return {
    ...current,
    nodes:[...existingNodes.filter(node => !chainIds.has(node?.id)), ...chain.nodes],
    edges:[...existingEdges.filter(item => !chainEdgeIds.has(item?.id) && !chainIds.has(item?.source) && !chainIds.has(item?.target)), ...chain.edges]
  };
}

module.exports = {CHAIN_NODE_IDS,SOURCE_NODE_ID,STEP01_NODE_ID,STEP02_NODE_ID,createChain,mergeChain,projectState,step01Projection,step02Projection,uniqueIds,sourceBindingValue};
