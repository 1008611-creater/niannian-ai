import { describe, expect, it } from 'vitest'
import { classifyGenerationError } from './generationRunController'

describe('classifyGenerationError — 已知分类', () => {
  it('API Key 无效', () => {
    const r = classifyGenerationError('Error: 401 Unauthorized — invalid api key')
    expect(r.reason).toBe('API Key 无效')
    expect(r.hint).toMatch(/API Key/)
  })

  it('配额或限流', () => {
    const r = classifyGenerationError('429 Too Many Requests: rate limit exceeded')
    expect(r.reason).toBe('配额或限流')
  })

  it('网络超时', () => {
    const r = classifyGenerationError('request failed: ETIMEDOUT')
    expect(r.reason).toBe('网络超时')
  })

  it('余额不足（中文）与限流区分开', () => {
    const r = classifyGenerationError('Provider request failed (code 402) at kie: 余额不足，请充值')
    expect(r.reason).toBe('余额不足')
    expect(r.hint).toMatch(/充值/)
  })

  it('余额不足（英文 balance）', () => {
    const r = classifyGenerationError('insufficient balance to perform this request')
    expect(r.reason).toBe('余额不足')
  })

  it('OpenAI insufficient_quota 仍归配额（不误判余额）', () => {
    const r = classifyGenerationError('You exceeded your current quota: insufficient_quota')
    expect(r.reason).toBe('配额或限流')
  })

  it('轮询超时归「生成超时」而非「网络超时」', () => {
    const r = classifyGenerationError('模型任务轮询超时: task-abc123')
    expect(r.reason).toBe('生成超时')
    expect(r.hint).not.toMatch(/网络/)
  })

  it('输出截断(agent length 签名)不落 unknown 的「稍等重试」误导(2026-07-15 拆镜头事故)', () => {
    const r = classifyGenerationError('模型「Mimo v2.5」这一轮达到了输出长度上限，内容被截断，没能完整返回。')
    expect(r.reason).toBe('输出超长被截断')
    expect(r.hint).toMatch(/分段|减少镜头|输出上限/)
    expect(r.hint).not.toMatch(/临时故障|稍等重试/)
  })

  it('模型未开通(火山 404,真实 structured IPC 形态):不当成「服务商临时故障」,指向控制台开通', () => {
    const upstreamMsg =
      'Your account 2126482930 has not activated the model doubao-seedream-4-5-251128. Please activate the model service in the Ark Console.'
    const message =
      "Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: 'unknown', httpStatus: 404, upstreamMsg, vendorKey: 'volcengine' }), 'utf8').toString('base64') +
      ":: Provider request failed (HTTP 404) at volcengine POST https://ark.cn-beijing.volces.com/api/v3/images/generations: " + upstreamMsg
    const r = classifyGenerationError(message)
    expect(r.reason).toBe('模型未开通')
    expect(r.hint).toMatch(/开通/)
    expect(r.hint).not.toMatch(/临时故障/)
    expect(r.providerMessage).toMatch(/has not activated/)
  })

  it('模型未开通(无 structured 的纯文本兜底)也能识别 reason', () => {
    const r = classifyGenerationError(
      'Provider request failed (HTTP 404) at volcengine POST https://x: 该模型未开通,请到 Ark 控制台开通管理激活',
    )
    expect(r.reason).toBe('模型未开通')
  })

  it('模型未开通即便上游标 403(被状态码派生成 auth):文本判定压过,不误导查密钥', () => {
    const raw = classifyGenerationError(
      "NOMI_VENDOR_ERR_B64::" +
        Buffer.from(JSON.stringify({ category: 'auth', upstreamMsg: '该模型未开通,请到控制台开通管理激活该模型' }), 'utf8').toString('base64') +
        ":: Provider request failed (HTTP 403) at volcengine POST https://x: 该模型未开通,请到控制台开通管理激活该模型",
    )
    expect(raw.reason).toBe('模型未开通')
    expect(raw.hint).not.toMatch(/API Key/)
  })

  it('账号档位闸·即梦非会员 → 账号权限不足(不吞进 unknown「生成失败」)', () => {
    const r = classifyGenerationError('当前即梦账号不是高级会员，无法生成。即梦免费试用已于 2026-05-01 结束——请在即梦开通会员后重试。')
    expect(r.reason).toBe('账号权限不足')
    expect(r.hint).toMatch(/会员|企业|授权/)
  })

  it('账号档位闸·RunningHub 1014 企业共享 Key → 账号权限不足(不误导成「参数不被接受」)', () => {
    const message =
      "NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: 'input', upstreamMsg: '标准模型API仅限企业级-共享API Key调用|Access Denied: Standard Model API is restricted to Enterprise-Shared API Keys only.', vendorKey: 'runninghub' }), 'utf8').toString('base64') +
      ":: Provider request failed (code 1014) at runninghub POST https://x: 标准模型API仅限企业级-共享API Key调用"
    const r = classifyGenerationError(message)
    expect(r.reason).toBe('账号权限不足')
    expect(r.reason).not.toBe('参数不被接受')
    expect(r.providerMessage).toMatch(/企业级|Enterprise/)
  })

  it('账号档位闸·即梦首次需网页端授权 → 账号权限不足', () => {
    const r = classifyGenerationError('即梦该模型首次使用需先在网页端完成一次性内容安全授权。请打开 jimeng.jianying.com 完成授权后重试。')
    expect(r.reason).toBe('账号权限不足')
  })

  it('普通参数错不被误判成账号档位闸', () => {
    const r = classifyGenerationError('invalid param: duration out of range')
    expect(r.reason).not.toBe('账号权限不足')
  })

  it('RunningHub 605/1620 余额错误 → 余额不足(不误导成「服务商故障/参数错」)', () => {
    const mk = (code: number, msg: string, cat: string) =>
      "NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: cat, upstreamMsg: msg, vendorKey: 'runninghub' }), 'utf8').toString('base64') +
      `:: Provider request failed (code ${code}) at runninghub POST https://x: ${msg}`
    const r605 = classifyGenerationError(mk(605, '您的账户余额不足，请充值。', 'server'))
    expect(r605.reason).toBe('余额不足')
    const r1620 = classifyGenerationError(mk(1620, '当前钱包剩余金额仅为活动会员下发金额，该类型金额不支持 API 调用，请充值。', 'input'))
    expect(r1620.reason).toBe('余额不足')
  })

  it('剪贴板网页媒体下载失败时优先提示下载到本地', () => {
    const r = classifyGenerationError('网页媒体下载失败：该站点可能禁止跨域请求或开启防盗链。请先下载到本地，再复制或拖入画布。')
    expect(r.reason).toBe('网页媒体下载失败')
    expect(r.hint).toMatch(/下载到本地/)
    expect(r.hint).toMatch(/防盗链/)
  })
})

describe('classifyGenerationError — 未识别兜底（方案 B 改进）', () => {
  it('从 JSON error.message 抠可读首行当 reason，并给兜底 hint', () => {
    const raw = JSON.stringify({ error: { message: 'model is overloaded, try again' } })
    const r = classifyGenerationError(raw)
    expect(r.reason).toBe('model is overloaded, try again')
    expect(r.hint).not.toBe('')
    expect(r.raw).toBe(raw)
  })

  it('从顶层 message 抠', () => {
    const r = classifyGenerationError(JSON.stringify({ message: 'something odd happened' }))
    expect(r.reason).toBe('something odd happened')
  })

  it('纯文本取第一行非空并截断', () => {
    const r = classifyGenerationError('\n  weird provider failure line one  \nstack frame 2\nstack frame 3')
    expect(r.reason).toBe('weird provider failure line one')
  })

  it('超长首行截断到 100 字带省略号', () => {
    const long = 'x'.repeat(300)
    const r = classifyGenerationError(long)
    expect(r.reason.length).toBeLessThanOrEqual(100)
    expect(r.reason.endsWith('…')).toBe(true)
  })

  it('空 raw 退回「生成失败」但仍带兜底 hint', () => {
    const r = classifyGenerationError('')
    expect(r.reason).toBe('生成失败')
    expect(r.hint).not.toBe('')
  })
})

describe('structured 路径(S4-2:VendorRequestError 经 IPC 标记穿透)', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (code 402) at kie POST https://x: 余额不足') =>
    `Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it('balance 类别直读 structured,不靠正则;raw 剥掉标记段', () => {
    const r = classifyGenerationError(encode({ category: 'balance', upstreamMsg: '余额不足', vendorKey: 'kie' }))
    expect(r.reason).toBe('余额不足')
    expect(r.raw).not.toContain('NOMI_VENDOR_ERR_B64')
    expect(r.raw).toContain('余额不足')
  })

  it('中文 upstreamMsg 的 base64 roundtrip 不乱码', () => {
    // tail 不能用默认（默认含「余额不足」会触发 balance 文案判定）——本例测 quota，给 quota 语义的 tail。
    const r = classifyGenerationError(encode({ category: 'quota', upstreamMsg: '触发限流·稍后再试' }, 'Provider request failed (code 429) at kie POST https://x: rate limited'))
    expect(r.reason).toBe('配额或限流')
  })

  it('未知类别退回 legacy 正则路径', () => {
    const r = classifyGenerationError(encode({ category: 'weird-new-thing' }, 'something 401 unauthorized'))
    expect(r.reason).toBe('API Key 无效')
  })
})

describe('providerMessage —— 服务商真实原话提到可见区（别埋进折叠的技术详情）', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (code 429) at dm-fox: x') =>
    `Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it('structured: 分类标题通用，但服务商原话单独可见', () => {
    const r = classifyGenerationError(encode({ category: 'quota', upstreamMsg: '官方算力限制，请等待一段时间后再进行使用' }))
    expect(r.reason).toBe('配额或限流') // 标题仍是"哪一类"
    expect(r.providerMessage).toBe('官方算力限制，请等待一段时间后再进行使用') // 真实原因可见
  })

  it('structured: 原话与分类标题重复时不冗余显示', () => {
    const r = classifyGenerationError(encode({ category: 'balance', upstreamMsg: '余额不足' }))
    expect(r.reason).toBe('余额不足')
    expect(r.providerMessage).toBeUndefined()
  })

  it('structured: 占位「(no detail from provider)」不显示', () => {
    const r = classifyGenerationError(encode({ category: 'server', upstreamMsg: '(no detail from provider)' }))
    expect(r.providerMessage).toBeUndefined()
  })

  it('legacy: 从 raw 抠出的可读原话也提到可见区', () => {
    const r = classifyGenerationError('429 rate limit: 当前模型排队人数过多，请稍后再试')
    expect(r.reason).toBe('配额或限流')
    expect(r.providerMessage).toMatch(/排队人数过多/)
  })

  it('unknown 兜底: reason 本身就是原话，不重复给 providerMessage', () => {
    const r = classifyGenerationError(JSON.stringify({ message: 'something odd happened' }))
    expect(r.reason).toBe('something odd happened')
    expect(r.providerMessage).toBeUndefined()
  })
})

describe('即梦 CLI 错误不被误吞成「模型未开通/火山 Ark 指引」（2026-07-06 真机走查抓出）', () => {
  it('即梦静默兜底文案（含「开通即梦会员」「该模型首次使用」）→ 账号权限不足，非模型未开通', () => {
    const msg = '即梦生成被拒，但 CLI 未返回任何原因（exit=1）。常见原因：① 当前即梦账号不是高级会员（免费试用 2026-05-01 已结束，需开通即梦会员）；② model_version / resolution 等参数组合不被当前模型支持；③ 该模型首次使用需先在 jimeng.jianying.com 网页端授权一次；④ 即梦服务端临时异常。'
    const report = classifyGenerationError(msg)
    expect(report.reason).toBe('账号权限不足')
    expect(report.reason).not.toBe('模型未开通')
  })
  it('火山方舟真·未开通文案仍归「模型未开通」（不被调序误伤）', () => {
    const report = classifyGenerationError('The account has not activated the model service: doubao-seedream')
    expect(report.reason).toBe('模型未开通')
  })
  it('即梦登录态失效文案 → 账号权限不足桶（原话可见）', () => {
    const report = classifyGenerationError('即梦登录态失效或未登录：请到「模型接入 · 即梦会员」卡重新登录（或终端运行 dreamina login），完成后重试。')
    expect(report.reason).not.toBe('模型未开通')
  })
})

describe('上游「模型不存在」不再退化成一句 taskId（2026-07-30 用户真机 Imagen 4 报错）', () => {
  // 用户看到的整条：「模型任务执行失败 (taskId=task_01KYQJG…, kind=text_to_image)」——上游真原因
  // （Google 404 Requested entity was not found）被 profile 声明却无人读的 error_message 吞了。
  // 修复后 describeTaskFailure 拿到的是真原话；这里锁的是拿到之后的分类不能再误导。
  const REAL_UPSTREAM = 'Requested entity was not found. (taskId=task_01KYRKKK35KCAASMFC7ND2PR6P, kind=text_to_image)'

  it('主动作 = 换个模型（不是重试）——重试必再撞同一堵墙', () => {
    const report = classifyGenerationError(REAL_UPSTREAM)
    expect(report.reason).toBe('这个模型服务商这边取不到')
    expect(report.primary).toBe('switch-model')
    // 重试降为次动作：不堵死用户，但也不许在建议文案里假装它有用。
    expect(report.secondary).toBe('retry')
    expect(report.hint).not.toMatch(/稍等|稍后再试/)
  })

  it('不误判成「模型未配置」（本地没配）或「模型未开通」（去控制台开）——动作完全不同', () => {
    const report = classifyGenerationError(REAL_UPSTREAM)
    expect(report.reason).not.toBe('模型未配置')
    expect(report.reason).not.toBe('模型未开通')
  })

  it('短语取窄：素材/项目一类的 404 不被误吞', () => {
    expect(classifyGenerationError('下载素材失败：404 Not Found').reason).not.toBe('这个模型服务商这边取不到')
    expect(classifyGenerationError('项目不存在或已被删除').reason).not.toBe('这个模型服务商这边取不到')
  })
})

describe('每类错误都说得出「该干嘛」（2026-07-30 拍板：主按钮按错误类型走）', () => {
  it('确定性失败不给重试当主按钮——那是骗用户', () => {
    // 上游没这个模型 / 已下线 → 换模型；密钥·开通·分组·档位 → 去模型接入。
    expect(classifyGenerationError('Model is retired: imagen-4.0-apimart').primary).toBe('switch-model')
    expect(classifyGenerationError('401 unauthorized: bad api key').primary).toBe('open-model-access')
    expect(classifyGenerationError('The account has not activated the model service: x').primary).toBe(
      'open-model-access',
    )
    expect(classifyGenerationError('Image generation is not enabled for this group').primary).toBe('open-model-access')
    expect(classifyGenerationError('账户余额不足，请充值').primary).toBe('open-model-access')
  })

  it('偶发失败仍给重试当主按钮（不是一刀切换模型）', () => {
    expect(classifyGenerationError('ETIMEDOUT while connecting').primary).toBe('retry')
    expect(classifyGenerationError('429 rate limit').primary).toBe('retry')
    expect(classifyGenerationError('某种没见过的报错').primary).toBe('retry')
  })

  it('次动作恒为「另一个可能有用的」，且不与主动作重复', () => {
    for (const message of ['Model is retired: x', '401 unauthorized', 'ETIMEDOUT', '没见过的错']) {
      const report = classifyGenerationError(message)
      expect(report.secondary).not.toBe(report.primary)
    }
    // 主 = 重试 → 次给换模型（等不及就换一家）。
    expect(classifyGenerationError('ETIMEDOUT').secondary).toBe('switch-model')
  })
})

describe('模型已下线 ≠ 模型被停用（删模型不能变成坑换坑）', () => {
  it('退役签名 → 中文人话 + 换个模型，不是英文技术原话', () => {
    const report = classifyGenerationError('Model is retired: imagen-4.0-apimart')
    expect(report.reason).toBe('这个模型已经下线了')
    expect(report.primary).toBe('switch-model')
    expect(report.hint).not.toMatch(/稍等|稍后再试/)
  })

  it('「被停用」仍归模型未配置 → 去模型接入（记录还在，那儿能开回来）', () => {
    const report = classifyGenerationError('Model is not enabled: some-model')
    expect(report.reason).not.toBe('这个模型已经下线了')
    expect(report.primary).toBe('open-model-access')
  })
})
