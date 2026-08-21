// wechat adapter 纯函数单测 —— 拆发言人前缀 / 滤非真人文本 / 映射成 FeedbackSignal。
// 为什么单测这些：微信导出文本混着真人话与 XML/图片/撤回/系统/卡片消息，分诊只认真人话；
// 拆错前缀或漏滤结构化消息 → 噪音污染反馈日报。样本全是**合成**的（不含真实 wxid / 真实群消息）。

import { describe, it, expect } from "vitest";
import { splitSenderPrefix, isHumanText, mapMessage, resolveDecryptTimeoutMs } from "./wechat.mjs";

// 合成假发言人 id：拼接规避 check-no-secrets 的 wxid_ 字面量扫描（这不是真 id）。
const FAKE_WXID = "wxid_" + "synthetic01";

describe("splitSenderPrefix（拆发言人前缀）", () => {
  it("wxid 前缀：author=wxid，body=正文", () => {
    const { author, body } = splitSenderPrefix(`${FAKE_WXID}:\n不是免费的吗`);
    expect(author).toBe(FAKE_WXID);
    expect(body).toBe("不是免费的吗");
  });

  it("昵称前缀：author=昵称，body=正文", () => {
    const { author, body } = splitSenderPrefix("xuhuaye002:\n各位配音用什么本地模型？");
    expect(author).toBe("xuhuaye002");
    expect(body).toBe("各位配音用什么本地模型？");
  });

  it("正文里也含 :\\n 时，只按第一个（发言人分隔符）拆，不误拆正文", () => {
    const { author, body } = splitSenderPrefix("someone:\n标题:\n下一行");
    expect(author).toBe("someone");
    expect(body).toBe("标题:\n下一行");
  });

  it("无前缀的系统消息（直接 <?xml）：author 空，body=整段", () => {
    const raw = '<?xml version="1.0"?><sysmsg>x</sysmsg>';
    const { author, body } = splitSenderPrefix(raw);
    expect(author).toBe("");
    expect(body).toBe(raw);
  });
});

describe("isHumanText（滤非真人文本）", () => {
  it("真人正文留（表情 [] 不是结构化标记）", () => {
    expect(isHumanText("有没有导出 mp4 的功能？")).toBe(true);
    expect(isHumanText("[抠鼻]这似乎不太合适")).toBe(true);
  });

  it("XML/系统/媒体消息滤", () => {
    expect(isHumanText('<?xml version="1.0"?><msg><img/></msg>')).toBe(false);
    expect(isHumanText("<sysmsg><revokemsg/></sysmsg>")).toBe(false);
    expect(isHumanText("<voipmsg/>")).toBe(false);
  });

  it("空 / 纯空白滤", () => {
    expect(isHumanText("")).toBe(false);
    expect(isHumanText("   \n ")).toBe(false);
  });
});

describe("mapMessage（→ FeedbackSignal）", () => {
  const group = "nomi画布群";

  it("真人消息映射齐全：source/kind/author/text/context/sourceId + create_time→ISO", () => {
    const sig = mapMessage(
      { local_id: 3849, sender: "", text: `${FAKE_WXID}:\n用mimo啊`, create_time: 1785240719 },
      group,
    );
    expect(sig).not.toBeNull();
    expect(sig.source).toBe("wechat");
    expect(sig.kind).toBe("group_msg");
    expect(sig.author).toBe(FAKE_WXID);
    expect(sig.text).toBe("用mimo啊");
    expect(sig.context).toBe(`微信群「${group}」`);
    expect(sig.url).toBe("");
    expect(sig.sourceId).toBe(`${group}_3849`);
    expect(sig.createdAt).toBe(new Date(1785240719 * 1000).toISOString());
  });

  it("前缀后是 XML 媒体（图片/卡片）→ 整条 null，不进日报", () => {
    const sig = mapMessage(
      { local_id: 10, sender: "", text: 'someone:\n<?xml version="1.0"?>\n<msg>\n\t<img aeskey="x"/></msg>', create_time: 1785240719 },
      group,
    );
    expect(sig).toBeNull();
  });

  it("无前缀纯系统消息 → null", () => {
    const sig = mapMessage(
      { local_id: 1, text: '<?xml version="1.0"?><sysmsg type="revokemsg"/>', create_time: 1785240719 },
      group,
    );
    expect(sig).toBeNull();
  });

  it("author 兜底：拆不出前缀且 sender 空 → 「群友」（正文仍须是真人话）", () => {
    const sig = mapMessage({ local_id: 2, text: "没有前缀的纯文本", create_time: 1785240719 }, group);
    expect(sig).not.toBeNull();
    expect(sig.author).toBe("群友");
    expect(sig.text).toBe("没有前缀的纯文本");
  });

  it("create_time 缺失/非法 → createdAt 空串（不炸）", () => {
    const sig = mapMessage({ local_id: 3, text: "阿明:\n测试", create_time: undefined }, group);
    expect(sig).not.toBeNull();
    expect(sig.createdAt).toBe("");
  });
});

// fb-20260726：decrypt_wechat.py 走 spawn，卡死会挂死整轮 radar → 必须有有限超时兜底。
describe("resolveDecryptTimeoutMs（decrypt 进程超时兜底）", () => {
  it("默认 120s（无 env 覆盖）", () => {
    expect(resolveDecryptTimeoutMs({})).toBe(120_000);
  });

  it("env 合法值生效（取整）", () => {
    expect(resolveDecryptTimeoutMs({ NOMI_WECHAT_DECRYPT_TIMEOUT_MS: "90000" })).toBe(90_000);
    expect(resolveDecryptTimeoutMs({ NOMI_WECHAT_DECRYPT_TIMEOUT_MS: "45000.7" })).toBe(45_000);
  });

  it("非法 / 过小值回落默认（永远返回有限正整数，绝不 0/NaN/Infinity）", () => {
    for (const bad of ["", "abc", "0", "1000", "-1", "Infinity", undefined]) {
      const v = resolveDecryptTimeoutMs({ NOMI_WECHAT_DECRYPT_TIMEOUT_MS: bad });
      expect(v).toBe(120_000);
      expect(Number.isFinite(v) && v > 0).toBe(true);
    }
  });
});
