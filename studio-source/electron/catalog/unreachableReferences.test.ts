// L3 第三闸：这条 wire 的 body 到底读不读得到本次携带的参考素材。
// 判据 derive 自 body 引用的 {{request.params.X}}，不 hardcode 任何 vendor 键名。
import { describe, expect, it } from "vitest";
import { unreachableReferenceLabels } from "./taskParams";
import { NEWAPI_VIDEO_CREATE_OP } from "./newapiTransport";
import { VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";

const FIRST = "https://cdn.example.com/first.png";
const LAST = "https://cdn.example.com/last.png";
const ROLE = "https://cdn.example.com/role-1.png";
const VIDEO = "https://cdn.example.com/move.mp4";

const nativeI2vBody = VOLCENGINE_VIDEO_MODELS[0].mappings.find((m) => m.taskKind === "image_to_video")?.create.body;

describe("unreachableReferenceLabels", () => {
  it("通用中转最小模板：首帧发得出，尾帧/角色图/参考视频发不出（此前是静默丢）", () => {
    const labels = unreachableReferenceLabels(
      {
        extras: {
          firstFrameUrl: FIRST,
          lastFrameUrl: LAST,
          referenceImageUrls: [ROLE],
          referenceVideoUrls: [VIDEO],
        },
      },
      NEWAPI_VIDEO_CREATE_OP.body,
    );
    expect(labels).not.toContain("首帧");
    expect(labels.sort()).toEqual(["参考视频", "尾帧", "角色参考图"].sort());
  });

  it("火山原生报文：首/尾帧、角色图、参考视频全都发得出 → 零拦截", () => {
    const labels = unreachableReferenceLabels(
      {
        extras: {
          firstFrameUrl: FIRST,
          lastFrameUrl: LAST,
          referenceImageUrls: [ROLE],
          referenceVideoUrls: [VIDEO],
          // 档案投影：渲染层把当前模式的 snake input 打好放这里，原生 body 读的就是这些键。
          archetypeInput: {
            volcengine_first_role_image_content: { type: "image_url", image_url: { url: FIRST }, role: "first_frame" },
            volcengine_last_role_image_content: { type: "image_url", image_url: { url: LAST }, role: "last_frame" },
            volcengine_image_contents: [{ type: "image_url", image_url: { url: ROLE }, role: "reference_image" }],
            volcengine_video_contents: [{ type: "video_url", video_url: { url: VIDEO }, role: "reference_video" }],
          },
        },
      },
      nativeI2vBody,
    );
    expect(labels).toEqual([]);
  });

  it("没带任何参考 → 不拦（纯文生正常放行）", () => {
    expect(unreachableReferenceLabels({ extras: { duration: 5 } }, NEWAPI_VIDEO_CREATE_OP.body)).toEqual([]);
  });

  it("body 不引用任何参数（如纯静态 body）→ 不误伤", () => {
    expect(unreachableReferenceLabels({ extras: { lastFrameUrl: LAST } }, { model: "x" })).toEqual([]);
  });

  it("只带首帧走通用模板 → 放行（刚修好的那条路必须不被自己拦住）", () => {
    expect(unreachableReferenceLabels({ extras: { firstFrameUrl: FIRST } }, NEWAPI_VIDEO_CREATE_OP.body)).toEqual([]);
  });
});
