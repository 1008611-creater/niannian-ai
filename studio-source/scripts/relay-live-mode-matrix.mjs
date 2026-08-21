// 真机实测：对一家真实 new-api 中转打 Seedance 2.0 全模式矩阵（花真额度！）。
//
// 目的：回答「这家中转真的通吗、这几个模型真的能用吗、所有模式都行吗」。发的 body 与 Nomi
// 现在真实发出的**方舟原生报文**同形状（walkthrough A 已捕获比对过），所以这里通 = App 里通。
//
// 模式矩阵（尽量省额度：480p、4-5s、fast 变体承担多数用例）：
//   M1 文生视频      · 标准 260128 · generate_audio=true（顺带验声音开关被接受）
//   M2 首帧图生视频   · fast       · role=first_frame
//   M3 首尾帧        · fast       · first_frame + last_frame
//   M4 全能参考(omni) · fast       · reference_image + reference_video + reference_audio
//        （若 M4 创建即 400（未建任务=未计费），自动去掉音频重试一次 M4b 以隔离原因；
//          若已建任务后失败，**绝不自动重发**——重试绝不包住付费提交。）
//   M5 文生视频      · mini 260615 · 验第三个模型 id 被接受
//
// 用法：NOMI_RELAY_KEY=sk-xxx node scripts/relay-live-mode-matrix.mjs [baseUrl]
//   参考素材缺省用 24h 时效的 litterbox 直链（跑当天有效）；可用 REF_FIRST/REF_LAST/REF_IMAGE/
//   REF_VIDEO/REF_AUDIO 环境变量替换成自己的公网 HTTPS 直链。
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const KEY = process.env.NOMI_RELAY_KEY || ''
if (!KEY) { console.error('缺 NOMI_RELAY_KEY（不落盘、不回显）'); process.exit(1) }
const BASE = (process.argv[2] || 'https://sd.dawnloadai.com:8443').replace(/\/+$/, '').replace(/\/v\d+$/i, '')
const AUTH = { Authorization: `Bearer ${KEY}` }
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' }

const REFS = {
  first: process.env.REF_FIRST || 'https://litter.catbox.moe/s8stdp.png',
  last: process.env.REF_LAST || 'https://litter.catbox.moe/4kivp6.png',
  image: process.env.REF_IMAGE || 'https://litter.catbox.moe/fd6g6t.png',
  video: process.env.REF_VIDEO || 'https://litter.catbox.moe/hl1kvm.mp4',
  audio: process.env.REF_AUDIO || 'https://litter.catbox.moe/gbms47.mp3',
}

const img = (url, role) => ({ type: 'image_url', image_url: { url }, ...(role ? { role } : {}) })
const vid = (url, role) => ({ type: 'video_url', video_url: { url }, ...(role ? { role } : {}) })
const aud = (url, role) => ({ type: 'audio_url', audio_url: { url }, ...(role ? { role } : {}) })
const text = (t) => ({ type: 'text', text: t })

const CASES = [
  { id: 'M1 文生视频·标准', model: 'doubao-seedance-2-0-260128', body: { content: [text('镜头缓慢推近，一间温暖的木质咖啡店内景，阳光透过窗户')], resolution: '480p', ratio: '16:9', duration: 5, generate_audio: true, watermark: false } },
  { id: 'M2 首帧·fast', model: 'doubao-seedance-2-0-fast-260128', body: { content: [text('画面从这张图开始，镜头缓慢拉远'), img(REFS.first, 'first_frame')], resolution: '480p', ratio: '16:9', duration: 5, generate_audio: false, watermark: false } },
  { id: 'M3 首尾帧·fast', model: 'doubao-seedance-2-0-fast-260128', body: { content: [text('从第一张图平滑过渡到第二张图'), img(REFS.first, 'first_frame'), img(REFS.last, 'last_frame')], resolution: '480p', ratio: '16:9', duration: 5, generate_audio: false, watermark: false } },
  { id: 'M4 全能参考·fast', model: 'doubao-seedance-2-0-fast-260128', body: { content: [text('参考图中的画面风格与参考视频的运镜方式，生成一段产品展示'), img(REFS.image, 'reference_image'), vid(REFS.video, 'reference_video'), aud(REFS.audio, 'reference_audio')], resolution: '480p', ratio: '16:9', duration: 5, generate_audio: false, watermark: false }, fallbackWithoutAudio: true },
  { id: 'M5 文生视频·mini', model: 'doubao-seedance-2-0-mini-260615', body: { content: [text('一只橘猫在窗台晒太阳，微风吹动窗帘')], resolution: '480p', ratio: '16:9', duration: 4, generate_audio: false, watermark: false } },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function createTask(model, body) {
  const res = await fetch(`${BASE}/api/v3/contents/generations/tasks`, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ model, ...body }),
  })
  const textBody = await res.text()
  let json = null
  try { json = JSON.parse(textBody) } catch { /* keep raw */ }
  return { status: res.status, json, raw: textBody.slice(0, 400) }
}

async function pollTask(taskId, { timeoutMs = 8 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    await sleep(5000) // 文档建议 3-5s+
    const res = await fetch(`${BASE}/api/v3/contents/generations/tasks/${taskId}`, { headers: AUTH })
    const body = await res.text()
    try { last = JSON.parse(body) } catch { last = { parseError: body.slice(0, 200) } }
    const st = last?.status
    if (st === 'succeeded' || st === 'failed' || st === 'cancelled' || st === 'expired') return last
    process.stdout.write(`\r    …${st || res.status} (upstream=${last?.upstream_task_id || '-'})   `)
  }
  return { status: 'poll_timeout', last }
}

async function probeVideo(url, name) {
  try {
    const res = await fetch(url)
    const buf = Buffer.from(await res.arrayBuffer())
    const path = `/tmp/relay-matrix-assets/out-${name}.mp4`
    writeFileSync(path, buf)
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height', '-of', 'csv=p=0', path]).toString().trim().split('\n').join(' | ')
    return `已下载 ${Math.round(buf.length / 1024)}KB → ${probe}`
  } catch (e) {
    return `下载/探测失败：${String(e).slice(0, 120)}`
  }
}

const results = []
for (const c of CASES) {
  console.log(`\n▶ ${c.id}（model=${c.model}）`)
  let created = await createTask(c.model, c.body)
  if (created.status !== 200 && created.json?.error && c.fallbackWithoutAudio) {
    // 创建即拒 = 未建任务未计费，允许去掉音频参考隔离一次（这不是对已计费提交的重试）。
    console.log(`  创建被拒（HTTP ${created.status}）：${created.raw}`)
    console.log('  ↳ 去掉参考音频重试一次（隔离音频是否为拒因）…')
    const body2 = { ...c.body, content: c.body.content.filter((x) => x.type !== 'audio_url') }
    created = await createTask(c.model, body2)
    c.note = '（参考音频被上游拒，已剔除后重试）'
  }
  if (created.status !== 200 || !created.json?.id) {
    console.log(`  ✗ 创建失败：HTTP ${created.status} ${created.raw}`)
    results.push({ id: c.id, ok: false, stage: 'create', detail: `HTTP ${created.status} ${created.raw.slice(0, 160)}` })
    continue
  }
  console.log(`  任务已受理 id=${created.json.id} upstream=${created.json.upstream_task_id ?? '(尚未回填)'}`)
  const final = await pollTask(created.json.id)
  console.log('')
  if (final?.status === 'succeeded' && final?.content?.video_url) {
    const proof = await probeVideo(final.content.video_url, c.id.slice(0, 2))
    console.log(`  ✓ 成功${c.note || ''} · seed=${final.seed} · ${final.resolution}/${final.ratio}/${final.duration}s · usage=${JSON.stringify(final.usage)}`)
    console.log(`    ${proof}`)
    results.push({ id: c.id, ok: true, usage: final.usage, note: c.note, proof })
  } else {
    console.log(`  ✗ 终态：${final?.status} error=${JSON.stringify(final?.error) ?? '-'}`)
    results.push({ id: c.id, ok: false, stage: 'poll', detail: `${final?.status} ${JSON.stringify(final?.error || final?.last || {}).slice(0, 200)}` })
  }
}

console.log('\n===== 结论 =====')
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id}${r.note || ''}${r.ok ? ` usage=${JSON.stringify(r.usage)}` : ` ← ${r.stage}: ${r.detail}`}`)
