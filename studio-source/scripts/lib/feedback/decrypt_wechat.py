#!/usr/bin/env python3
"""
per-db key 解密微信 SQLCipher4 库 + 读指定群消息（绕过 WeLive 单 key 限制）。

为什么自己解密：微信 4.x 是 per-db key（每库不同 key），WeLive 单 db_key 模型只能解 session.db。
hook 取钥（dump_wechat_key.py 的 hook_wechat_key）把所有库 key 写进 ~/welive/wechat_keys.json；
本脚本用 cryptography 手动实现 SQLCipher4 解密（AES-256-CBC，每页独立 IV，reserve=80），逐库解密后读消息。

安全：key 从 600 文件读、不经命令行；解密的明文 db 放 /tmp 临时目录、读完即删，绝不落 git。
输出：命中群消息 → 打 JSONL（喂 feedback-radar wechat adapter）；读不到 → 打真实 schema 诊断（供调）。

用法：
  python3 decrypt_wechat.py --group "画布"           读群名含「画布」的群消息
  python3 decrypt_wechat.py --group "画布" --explore  额外打印表结构/样例（首次探 schema）
"""
import glob
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from compression import zstd  # py3.14 内置；微信 4.x 消息体是 zstd 帧

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PAGE_SZ, RESERVE, SALT_SZ, IV_SZ = 4096, 80, 16, 16
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"  # zstd 帧头，对应 bytes 的 b"(\xb5/\xfd"
KEYS_PATH = os.environ.get("WECHAT_KEYS_PATH") or os.path.expanduser("~/welive/wechat_keys.json")
XWECHAT = os.path.expanduser("~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files")


def _log(m):
    print(f"[decrypt] {m}", file=sys.stderr)


def _md5_hex(s):
    """MD5(hex) —— 走 cryptography 而非 stdlib hashlib。

    微信 4.x 的 Msg 表名是 Msg_<md5(chatroom)>，必须算 md5 才能定位表。
    为什么不用 hashlib：Homebrew py3.14 的 stdlib hashlib 在部分机器上整个失效
    （`hashlib.md5` 报 AttributeError / unsupported hash type，C 扩展没加载成功）。
    但本脚本已依赖的 cryptography（自带可用 OpenSSL）能算 md5——复用它，摆脱脆弱 stdlib，
    零新依赖。（与 openssl CLI 逐字节核对过一致。）
    """
    h = hashes.Hash(hashes.MD5())
    h.update(s.encode() if isinstance(s, str) else s)
    return h.finalize().hex()


def decode_content(val):
    """还原 message_content 为可读文本（唯一解码点）。

    微信 4.x 把较长/系统消息体存成 zstd 帧的 BLOB（magic 28 b5 2f fd）；短文本仍是 TEXT。
    过去这里只 str(bytes) → 落成 `b'(\\xb5/\\xfd...` 残片，分诊时只能整条丢弃（每轮约 30%
    微信信号静默蒸发）。现在：BLOB 先按 zstd 解压再 utf-8 解码；解不开的按 utf-8/replace
    兜底不丢字节；本就是 str 的 TEXT 原样透传。（解压后是 `发言人wxid:\\n正文`，前缀沿用旧
    口径不动——140 条未压缩消息也带同样前缀，保持一致，交给下游统一处理。）
    """
    if val is None:
        return ""
    if isinstance(val, (bytes, bytearray)):
        b = bytes(val)
        if b[:4] == ZSTD_MAGIC:
            try:
                b = zstd.decompress(b)
            except Exception:  # noqa: BLE001 解不开退回原字节，交给下面 utf-8/replace 兜底
                pass
        return b.decode("utf-8", "replace")
    return str(val)


def decrypt_db(src, key_hex, dst):
    """SQLCipher4 手动解密：每页 AES-256-CBC（IV=页内 reserve 区前 16 字节），拼成标准 sqlite。"""
    key = bytes.fromhex(key_hex)
    with open(src, "rb") as f:
        data = f.read()
    if len(data) < PAGE_SZ:
        return False
    n = len(data) // PAGE_SZ
    with open(dst, "wb") as out:
        for i in range(n):
            page = data[i * PAGE_SZ:(i + 1) * PAGE_SZ]
            off = SALT_SZ if i == 0 else 0
            ct = page[off:PAGE_SZ - RESERVE]
            iv = page[PAGE_SZ - RESERVE:PAGE_SZ - RESERVE + IV_SZ]
            if len(ct) % 16 or len(iv) != 16:
                return False
            try:
                dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
                pt = dec.update(ct) + dec.finalize()
            except Exception:  # noqa: BLE001
                return False
            out.write((b"SQLite format 3\x00" if i == 0 else b"") + pt + page[PAGE_SZ - RESERVE:])
    return True


def _open(plain):
    con = sqlite3.connect(plain)
    con.row_factory = sqlite3.Row
    return con


def _tables(con):
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]


def _cols(con, t):
    try:
        return [r[1] for r in con.execute(f'PRAGMA table_info("{t}")')]
    except sqlite3.Error:
        return []


def _first(cols, *cands):
    """在实际列名里挑第一个匹配的候选（容错 WCDB 列名跨版本差异）。"""
    low = {c.lower(): c for c in cols}
    for cand in cands:
        if cand.lower() in low:
            return low[cand.lower()]
    return None


def main():
    args = sys.argv[1:]
    explore = "--explore" in args
    group_frag = args[args.index("--group") + 1] if "--group" in args else "画布"

    if not os.path.exists(KEYS_PATH):
        _log(f"没有 {KEYS_PATH}——先跑 hook_wechat_key 取钥")
        print(json.dumps({"status": "error", "message": "缺 wechat_keys.json"}))
        return
    with open(KEYS_PATH) as f:
        kd = json.load(f)
    keys = kd.get("keys", {})
    _log(f"读到 {len(keys)} 个库 key")

    tmp = tempfile.mkdtemp(prefix="wxdec_")
    try:
        # ── 1. 找目标群：contact.db（有群名/昵称）优先，session.db 辅助 ──
        chatroom, gname = None, None
        for frag in ("contact.db", "session/session.db"):
            dbp = next((d for d in keys if frag in d and "fts" not in d), None)
            if not dbp:
                continue
            pp = os.path.join(tmp, os.path.basename(dbp))
            if not decrypt_db(dbp, keys[dbp], pp):
                _log(f"{os.path.basename(dbp)} 解密失败")
                continue
            con = _open(pp)
            if explore:
                _log(f"{os.path.basename(dbp)} 表: {_tables(con)}")
            for t in _tables(con):
                cols = _cols(con, t)
                uc = _first(cols, "username", "user_name", "strUsrName", "m_nsUsrName")
                nc = _first(cols, "nick_name", "nickname", "remark", "group_name",
                            "session_title", "strNickName", "m_nsRemark")
                if explore and uc:
                    _log(f"  {t} 列: {cols}")
                if not uc or not nc:
                    continue
                try:
                    for r in con.execute(f'SELECT "{uc}" u, "{nc}" n FROM "{t}"'):
                        if r["n"] and group_frag in str(r["n"]) and "@chatroom" in str(r["u"]):
                            chatroom, gname = r["u"], r["n"]
                            break
                except sqlite3.Error:
                    continue
                if chatroom:
                    _log(f"找到群「{gname}」→ {chatroom}（{os.path.basename(dbp)}.{t}）")
                    break
            con.close()
            if chatroom:
                break
        if not chatroom:
            print(json.dumps({"status": "no_group",
                              "message": f"contact/session 里没找到群名含「{group_frag}」的群（--explore 看 schema）"},
                             ensure_ascii=False))
            return

        # ── 2. 扫 message_*.db，找该群的 Msg 表读消息 ──
        md5 = _md5_hex(chatroom)
        wanted_tabs = {f"Msg_{md5}", f"Chat_{md5}", f"Msg_{md5}".upper()}
        msgs = []
        msg_dbs = [d for d in keys if "/message/" in d and d.endswith(".db") and "fts" not in d]
        found_tab = None
        for mdb in msg_dbs:
            mp = os.path.join(tmp, os.path.basename(mdb))
            if not decrypt_db(mdb, keys[mdb], mp):
                continue
            mc = _open(mp)
            mtabs = _tables(mc)
            hit = next((t for t in mtabs if t in wanted_tabs or md5 in t), None)
            if explore and not hit:
                _log(f"{os.path.basename(mdb)} 的 Msg 表: {[t for t in mtabs if t.startswith(('Msg','Chat'))][:5]}")
            if not hit:
                mc.close()
                continue
            found_tab = hit
            cols = _cols(mc, hit)
            cc = _first(cols, "message_content", "content", "StrContent", "m_nsContent")
            tc = _first(cols, "create_time", "createTime", "CreateTime", "m_uiCreateTime")
            sc = _first(cols, "sender_username", "sender", "talker", "m_nsFromUsr", "strTalker")
            if explore:
                _log(f"命中表 {hit}，列: {cols}")
            for r in mc.execute(f'SELECT * FROM "{hit}" ORDER BY "{tc}" DESC LIMIT 200' if tc else f'SELECT * FROM "{hit}" LIMIT 200'):
                d = dict(r)
                txt = decode_content(d.get(cc)) if cc else ""
                if not txt.strip():
                    continue
                msgs.append({"local_id": d.get("local_id", ""), "sender": d.get(sc, "") if sc else "",
                             "text": txt, "create_time": d.get(tc, "") if tc else ""})
            mc.close()
            break

        if not msgs:
            print(json.dumps({"status": "explore",
                              "message": f"找到群但没读到消息（Msg 表 {found_tab or '未命中'}）",
                              "chatroom": chatroom, "md5_table": f"Msg_{md5}",
                              "msg_dbs": [os.path.basename(d) for d in msg_dbs]}, ensure_ascii=False))
            return
        print(json.dumps({"status": "ok", "group": gname, "chatroom": chatroom,
                          "table": found_tab, "count": len(msgs), "messages": msgs},
                         ensure_ascii=False))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)  # 明文 db 读完即删，不落盘


if __name__ == "__main__":
    main()
