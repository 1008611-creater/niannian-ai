import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// MiniMax H3（经 RunningHub）。服务端按参考图数量自动选择模式：
// 0 图=文生视频，1=one-image，2=first-last，3=multi-image，4=four-image。
// 此前 minimax-h3 无内置档案 → Web 端只兜底显示首/尾帧单槽，多图参考不可用。
// 此档案开放：文生 / 首帧+尾帧 / 参考图数组（最多 4 张）。

const toOptions = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const H3_PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: toOptions(["2k"]), defaultValue: "2k" },
  { key: "duration", label: "时长", type: "select", options: toOptions(["4", "5", "6", "8", "10", "12"]), defaultValue: "5" },
  { key: "ratio", label: "比例", type: "select", options: toOptions(["9:16", "16:9", "1:1", "4:3", "3:4"]), defaultValue: "9:16" },
];

export const H3_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3",
  family: "h3",
  label: "H3 生视频",
  kind: "video",
  defaultModeId: "text",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["minimax-h3"],
  modes: [
    {
      id: "text",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "文字描述生成视频",
      promptRequired: true,
      slots: [],
      params: H3_PARAMS,
      transportTaskKind: "text_to_video",
    },
    {
      id: "ref",
      intent: "firstlast",
      vendorTerm: "图生视频",
      hint: "首帧/尾帧 + 参考图（最多 4 张）生成视频",
      promptRequired: false,
      slots: [
        { kind: "first_frame", label: "首帧", min: 0, max: 1, inputKey: "firstFrameUrl" },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "lastFrameUrl" },
        { kind: "image_ref", label: "参考图", min: 0, max: 4, inputKey: "referenceImages" },
      ],
      params: H3_PARAMS,
      transportTaskKind: "image_to_video",
    },
  ],
};
