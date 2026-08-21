#!/usr/bin/env python3
"""decode_content 单测——微信 zstd 消息体解码红→绿。

为什么单独一个 python 测试：微信消息体的解码在 python 侧（原始字节只在这里活着，
过了 stdout 就被 str() 掉了），vitest 够不到。gates 只保 JS 侧不回归；这条测 python 解码。
跑：python3 scripts/lib/feedback/decrypt_wechat.test.py

样本是**合成**的（自己 zstd 压出来的假数据，不含任何真实 wxid / 真实群消息 / 真实 URL——
真实群消息绝不入 git，见 scripts/check-no-secrets.mjs）。合成内容刻意复刻真实形状：
一条被 zstd 压成 BLOB 的真人反馈 + 一条系统撤回 xml，覆盖「解压 + utf-8 解码 + startsWith('<') 过滤」。
"""
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decrypt_wechat import decode_content  # noqa: E402

# 合成残片一：一条真人反馈（较长，故被 zstd 压成 BLOB）——正是过去被静默丢弃那类信号
REAL = base64.b64decode(
    "KLUv/SBPeQIA6Zi/5piOOgrmnInmsqHmnInmibnph4/lr7zlh7ogbXA0IOeahOWKn+iDve+8n+i/meS4quWvueaIkeWkqumHjeimgeS6hu+8jOaxguWKoA=="
)
# 合成残片二：一条系统消息（revokemsg，zstd 帧内是 xml）——解出来后走 startsWith("<") 过滤
SYS = base64.b64decode(
    "KLUv/SBwpQIAooQQGJC1bQAXQYdavjSZff0fLPcC84qiZoBxAajfr5/PVs4DHqTfszKQo0ibBwEJ/XmbFbQVNPrNJA1SYIgMLCXo9+sOBQBDMIRlTqgAsEkGUcw8"
)

# zstd 帧头（28 b5 2f fd = "(\xb5/\xfd"）——用来断言"输入确实是残片"
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


def _check(name, cond):
    print(("  ✓ " if cond else "  ✗ ") + name)
    if not cond:
        _check.failed += 1


_check.failed = 0


def main():
    # 前提：样本确实是 zstd 残片（若哪天样本被改成非压缩，测试该显式失败提醒）
    _check("REAL 样本是 zstd 帧", REAL[:4] == ZSTD_MAGIC)
    _check("SYS 样本是 zstd 帧", SYS[:4] == ZSTD_MAGIC)

    real = decode_content(REAL)
    _check("REAL 解出真人反馈文本", "有没有批量导出 mp4 的功能" in real)
    _check("REAL 不再是 b'... 字节残片", not real.startswith("b'"))
    _check("REAL 不含 zstd 魔数残留", "�" not in real and "µ/ý" not in real)

    sysmsg = decode_content(SYS)
    _check("SYS 解出可读 xml", "<sysmsg" in sysmsg and "revokemsg" in sysmsg)

    # 普通 TEXT 列（已是 str）原样透传，不误伤
    plain = decode_content("阿明:\n有新版本链接吗")
    _check("普通 str 原样透传", plain == "阿明:\n有新版本链接吗")
    _check("None 归一为空串", decode_content(None) == "")

    if _check.failed:
        print(f"\n  {_check.failed} 条失败\n")
        sys.exit(1)
    print("\n  全部通过\n")


if __name__ == "__main__":
    main()
