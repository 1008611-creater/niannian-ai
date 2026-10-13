#!/usr/bin/env python3
"""
微信 4.x db_key 内存扫描取钥器（lldb Python 命令脚本）。

原理（实查 2026-07-15，参考 ylytdeng/wechat-decrypt 的 SQLCipher4 验证参数）：
  微信 4.x 用 WCDB(SQLCipher4) 加密本地库。派生的 32 字节 enc_key 缓存在进程内存里——
  旧版(≤4.1.2)是 ASCII 字符串 `x'<64hex key><32hex salt>'`，新版内存布局可能变。所以本脚本**两路都试**：
    ① ASCII：搜 `x'<96hex>'`，前 64 hex = enc_key
    ② binary：搜 db 文件的 16 字节 salt（page1 前 16 字节），其**前 32 字节** = enc_key（key+salt 连续布局）
  **不靠猜格式/偏移下结论**——每个候选都用 SQLCipher4 的 HMAC 校验 page1（唯一裁判）：验证过才是真 key。

  macOS 前置：微信默认 Hardened Runtime 挡 task_for_pid，需先 ad-hoc 重签才能被 lldb attach（不关 SIP）。

  ⚠️ 真机实测结论（2026-07-15，微信 macOS 4.1.10 arm64）：ad-hoc 重签 + attach 成功、32 个加密库 page1
  读到、库 salt 在内存**命中 61 次**（库确实加载了），但 **ASCII 0 命中、salt 前后偏移(32/48/16)候选 HMAC 全不过**。
  即：**4.1.10 的 key 存储布局与现役开源工具攻破的 4.1.2.x 不同**（key 不在 salt 附近的常规位置，可能走 codec_ctx
  指针或新结构），是尚未被公开攻破的前沿。本脚本框架/HMAC 校验/WeLive 对接均已备好——等 4.1.10 的 key 定位方式
  被攻破，只需把 `_scan` 里的候选来源换成新方法即可。降级到 4.1.2.x 或用 Windows 微信（WeLive 自动取钥）是即用替代。

它不做什么：不解密、不导出、不改微信。纯只读内存扫描 + 本地 HMAC 校验。取到的 key 只走 stdout（上层填
  进 ~/welive/welive.yaml，不入库、不打全 key 到共享日志）。

用法（上层 welive-setup-mac.sh 会自动调；手动诊断保留 stderr）：
  sudo lldb --batch -p $(pgrep -x WeChat) \
    -o "command script import scripts/lib/feedback/dump_wechat_key.py" \
    -o "dump_wechat_key --root ~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files" \
    -o "quit"
"""

import glob
import hashlib
import hmac as hmac_mod
import json
import os
import shlex
import struct
import sys

KEY_RE = __import__("re").compile(rb"x'([0-9a-fA-F]{96})'")
CHUNK = 8 * 1024 * 1024
PAGE_SZ = 4096
SALT_SZ = 16
KEY_SZ = 32
RESERVE_SZ = 80  # SQLCipher4: IV(16) + HMAC-SHA512(64)
HMAC_SZ = 64


def _log(msg):
    print(f"[dump_wechat_key] {msg}", file=sys.stderr)
    sys.stderr.flush()


def _emit(obj):
    """结果 → stdout（setup grep）+ stderr（可见）。ok/no_match/error 统一前缀。"""
    line = "WECHAT_KEY_JSON " + json.dumps(obj, ensure_ascii=False)
    print(line)
    sys.stdout.flush()
    print(line, file=sys.stderr)
    sys.stderr.flush()


def _verify_key(enc_key, page1):
    """SQLCipher4 HMAC 校验 page1（唯一裁判）。enc_key=32字节, page1≥4096字节。"""
    if len(enc_key) != KEY_SZ or len(page1) < PAGE_SZ:
        return False
    salt = page1[:SALT_SZ]
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=KEY_SZ)
    hmac_data = page1[SALT_SZ : PAGE_SZ - RESERVE_SZ + SALT_SZ]  # [16 : 4032]
    stored = page1[PAGE_SZ - HMAC_SZ : PAGE_SZ]  # [4032 : 4096]
    hm = hmac_mod.new(mac_key, hmac_data, hashlib.sha512)
    hm.update(struct.pack("<I", 1))
    return hm.digest() == stored


def _iter_db_page1s(root):
    """xwechat_files 下每个 .db → page1（前 4096 字节，含 salt + HMAC，供校验）。"""
    out = {}
    root = os.path.expanduser(root)
    for db in glob.glob(os.path.join(root, "**", "*.db"), recursive=True):
        try:
            with open(db, "rb") as f:
                page1 = f.read(PAGE_SZ)
            if (len(page1) >= PAGE_SZ
                    and page1[:15] != b"SQLite format 3"  # 非明文 SQLite
                    and page1[:SALT_SZ] != b"\x00" * SALT_SZ):  # 非全 0 salt（排除 MMKV/mpkv 等非 SQLCipher 库）
                out[db] = page1
        except OSError:
            continue
    return out


def _scan(process, db_page1):
    """扫可读可写区域：ASCII pattern + 每个 db 的 binary salt。候选都 HMAC 验证。返回 verified{db:hex} + 诊断。"""
    import lldb

    salt_to_db = {p1[:SALT_SZ]: db for db, p1 in db_page1.items()}  # binary salt → db
    verified = {}
    diag = {"ascii_hits": 0, "salt_hits": 0, "ascii_verified": 0, "binary_verified": 0}

    regions = process.GetMemoryRegions()
    n = regions.GetSize()
    _log(f"内存区域总数 {n}，扫可读可写（堆）区域，ASCII + binary salt 双路…")
    info = lldb.SBMemoryRegionInfo()
    scanned = 0
    for i in range(n):
        if not regions.GetMemoryRegionAtIndex(i, info):
            continue
        if not info.IsReadable() or not info.IsWritable():
            continue
        base, end = info.GetRegionBase(), info.GetRegionEnd()
        scanned += 1
        addr = base
        while addr < end:
            size = min(CHUNK, end - addr)
            err = lldb.SBError()
            data = process.ReadMemory(addr, size, err)
            if err.Success() and data:
                # ① ASCII：x'<64hex key><32hex salt>'
                for m in KEY_RE.finditer(data):
                    diag["ascii_hits"] += 1
                    hx = m.group(1).decode("ascii").lower()
                    db = next((d for d, p1 in db_page1.items() if p1[:SALT_SZ].hex() == hx[64:]), None)
                    if db and db not in verified:
                        ek = bytes.fromhex(hx[:64])
                        if _verify_key(ek, db_page1[db]):
                            verified[db] = hx[:64]
                            diag["ascii_verified"] += 1
                # ② binary：搜 16 字节 salt，前 32 字节候选 enc_key（HMAC 定夺）
                for salt_b, db in salt_to_db.items():
                    if db in verified:
                        continue
                    start = 0
                    while True:
                        p = data.find(salt_b, start)
                        if p < 0:
                            break
                        diag["salt_hits"] += 1
                        # key 与 salt 连续，key 在 salt 前——试 salt 前 32..48 字节几个偏移，HMAC 定夺
                        for back in (32, 48, 16):
                            if p - back >= 0:
                                ek = data[p - back : p - back + KEY_SZ]
                                if len(ek) == KEY_SZ and _verify_key(ek, db_page1[db]):
                                    verified[db] = ek.hex()
                                    diag["binary_verified"] += 1
                                    break
                        start = p + 1
            addr += size - 100 if size == CHUNK else size
        if scanned % 200 == 0:
            _log(f"已扫 {scanned} 区域，验证通过 {len(verified)}，salt 命中 {diag['salt_hits']}")
    _log(f"扫描完成：{scanned} 区域，ASCII 命中 {diag['ascii_hits']}，salt 命中 {diag['salt_hits']}，"
         f"HMAC 验证通过 {len(verified)} 个库")
    return verified, diag


def dump_wechat_key(debugger, command, result, internal_dict):
    try:
        _dump_impl(debugger, command)
    except Exception as e:  # noqa: BLE001
        import traceback
        _log("异常：\n" + traceback.format_exc())
        _emit({"status": "error", "message": f"脚本异常：{e}"})


def _dump_impl(debugger, command):
    args = shlex.split(command or "")
    root = "~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"
    it = iter(args)
    for a in it:
        if a == "--root":
            root = next(it, root)
    _log(f"root = {os.path.expanduser(root)}")

    db_page1 = _iter_db_page1s(root)
    _log(f"读到 {len(db_page1)} 个加密库的 page1（供 HMAC 校验）")
    if not db_page1:
        _emit({"status": "error", "message": f"xwechat_files 下没找到加密 .db（root={root}）"})
        return

    target = debugger.GetSelectedTarget()
    process = target.GetProcess() if target else None
    if not process or not process.IsValid():
        _emit({"status": "error", "message": "没 attach 到微信进程（lldb -p 成功吗？看上面 attach 有没有报错）"})
        return
    _log(f"已 attach 微信进程，state={process.GetState()}")

    verified, diag = _scan(process, db_page1)

    if not verified:
        # 诊断：salt 在不在内存 → 区分「库没加载」vs「格式变了」
        if diag["salt_hits"] > 0:
            msg = (f"内存里找到了库 salt（{diag['salt_hits']} 次命中），但 salt 前后的候选都没通过 HMAC 校验——"
                   "说明这个微信版本(4.1.10)的 key 布局和现役工具(测 4.1.2)不同，是尚未攻破的前沿。")
        else:
            msg = ("内存里连库 salt 都没搜到——微信可能还没把这些库加载进内存（WCDB lazy-open）。"
                   "在微信里多点开几个聊天/群，再重跑一次。")
        _emit({"status": "no_match", "message": msg,
               "ascii_hits": diag["ascii_hits"], "salt_hits": diag["salt_hits"], "dbs": len(db_page1)})
        return

    single_raw_key = len(set(verified.values())) == 1
    session_db = next((db for db in verified if os.path.join("session", "session.db") in db), None)
    session_key = verified.get(session_db) if session_db else None

    _emit({
        "status": "ok",
        "via": "ascii" if diag["ascii_verified"] else "binary",  # 哪路取到的
        "single_raw_key": single_raw_key,
        "matched_dbs": len(verified),
        "total_dbs": len(db_page1),
        "session_db": session_db,
        "session_key": session_key,  # 敏感：上层填 welive.yaml，不外发
        "db_key_preview": {os.path.basename(db): k[:8] + "…" for db, k in sorted(verified.items())},
    })


def hook_wechat_key(debugger, command, result, internal_dict):
    """hook 模式（4.1.10 唯一破法）：断点 CommonCrypto CCCrypt 系列，微信解密某页时捕获 key。
    4.1.10 起 key「用完即擦」不驻留内存，被动扫描失效；但 WCDB 用 CommonCrypto 做 AES 后端，
    key 在解密时经 CCCrypt/CCCryptorCreate 传参。需用户在微信里浏览聊天触发解密。
    注入型 hook，有封号风险（用户已知情）。key 取一次永久有效，一次性。"""
    try:
        _hook_impl(debugger, command)
    except Exception as e:  # noqa: BLE001
        import traceback
        _log("hook 异常：\n" + traceback.format_exc())
        _emit({"status": "error", "message": f"hook 脚本异常：{e}"})


def _hook_impl(debugger, command):
    import time
    import lldb

    args = shlex.split(command or "")
    root = "~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"
    timeout = 180
    it = iter(args)
    for a in it:
        if a == "--root":
            root = next(it, root)
        elif a == "--timeout":
            timeout = int(next(it, str(timeout)))

    db_page1 = _iter_db_page1s(root)
    _log(f"读到 {len(db_page1)} 个加密库的 page1（供 HMAC 配对）")
    if not db_page1:
        _emit({"status": "error", "message": f"没找到加密 .db（root={root}）"})
        return

    target = debugger.GetSelectedTarget()
    process = target.GetProcess() if target else None
    if not process or not process.IsValid():
        _emit({"status": "error", "message": "没 attach 到微信进程"})
        return

    # 断 CommonCrypto AES 入口（arm64 参数寄存器；_CCCrypt 是公开符号 strip 不掉）
    #   CCCryptorCreate(op,alg,options, key,keyLen, iv,…)          → key=x3 len=x4（SQLCipher CC 后端主入口）
    #   CCCryptorCreateWithMode(op,mode,alg,pad,iv, key,keyLen,…)  → key=x5 len=x6
    #   CCCrypt(op,alg,options, key,keyLen, iv,…)                  → key=x3 len=x4（每页调用最频繁，兜底）
    # 优先断 CCCryptorCreate*（SQLCipher CC 后端每次解密创建 cryptor 时设 key，频率低不卡）；
    # 都没有才加 CCCrypt（每页调用最频繁、会卡微信，仅兜底）
    primary = [("CCCryptorCreate", "x3", "x4"), ("CCCryptorCreateWithMode", "x5", "x6")]
    fallback = [("CCCrypt", "x3", "x4")]
    reg_by_func = {}
    for name, kreg, lreg in primary:
        bp = target.BreakpointCreateByName(name)
        locs = bp.GetNumLocations() if bp.IsValid() else 0
        if locs > 0:
            reg_by_func[name] = (kreg, lreg)
            _log(f"断点 {name}: {locs} locations ✓")
        else:
            _log(f"断点 {name}: 0 locations")
    if not reg_by_func:  # primary 都没有 → 加 CCCrypt 兜底
        for name, kreg, lreg in fallback:
            bp = target.BreakpointCreateByName(name)
            locs = bp.GetNumLocations() if bp.IsValid() else 0
            if locs > 0:
                reg_by_func[name] = (kreg, lreg)
                _log(f"断点 {name}: {locs} locations ✓（兜底，微信会卡）")
    if not reg_by_func:
        _emit({"status": "error", "message": "CCCrypt 系列断点全 0 location——hook 法在此版本也失效了"})
        return

    verified = {}
    seen = set()
    _log(f"▶ 开始收集。请现在去微信里点开「nomi画布群」+ 多个聊天/朋友圈触发解密"
         f"（{timeout}s 超时，收齐 {len(db_page1)} 个库自动停）")
    start = time.time()
    hits = 0
    while len(verified) < len(db_page1) and time.time() - start < timeout:
        process.Continue()
        st = process.GetState()
        if st == lldb.eStateExited or not process.IsValid():
            _log("微信进程退出，停止")
            break
        if st != lldb.eStateStopped:
            continue
        thread = process.GetSelectedThread()
        if not thread or thread.GetStopReason() != lldb.eStopReasonBreakpoint:
            continue
        frame = thread.GetFrameAtIndex(0)
        fname = frame.GetFunctionName() or ""
        regs = next((rp for fn, rp in reg_by_func.items() if fn in fname), None)
        if not regs:
            continue
        hits += 1
        kreg, lreg = regs
        if frame.FindRegister(lreg).GetValueAsUnsigned() != 32:  # 只要 AES-256 的 32 字节 key
            continue
        kptr = frame.FindRegister(kreg).GetValueAsUnsigned()
        e2 = lldb.SBError()
        kbytes = process.ReadMemory(kptr, 32, e2)
        if not e2.Success() or not kbytes or kbytes in seen:
            continue
        seen.add(kbytes)
        for db, p1 in db_page1.items():
            if db not in verified and _verify_key(kbytes, p1):
                verified[db] = kbytes.hex()
                _log(f"  ✓ 取到 {os.path.basename(db)}（{len(verified)}/{len(db_page1)}）")
                break
        if hits % 500 == 0:
            _log(f"  已断 {hits} 次，验证通过 {len(verified)}，候选 key {len(seen)}")

    if not verified:
        _emit({"status": "no_match",
               "message": f"断点触发 {hits} 次、候选 32 字节 key {len(seen)} 个，但没一个过 HMAC——"
                          "浏览聊天了吗？或该版本 key 没走这几个 CC 函数。",
               "breakpoint_hits": hits, "candidates": len(seen)})
        return

    single = len(set(verified.values())) == 1
    session_db = next((db for db in verified if os.path.join("session", "session.db") in db), None)
    # 安全：per-db key 写进本地 600 权限文件，**不打全 key 到 stdout**（防被迫贴出来泄露）
    keys_path = os.path.expanduser("~/welive/wechat_keys.json")
    try:
        with open(keys_path, "w") as f:
            json.dump({"single_raw_key": single, "session_db": session_db,
                       "keys": dict(verified)}, f, ensure_ascii=False, indent=2)
        os.chmod(keys_path, 0o600)
        # sudo 下写的文件属主是 root，chown 回真实用户，否则普通权限（含解密脚本）读不了
        suid = os.environ.get("SUDO_UID")
        if suid:
            try:
                os.chown(keys_path, int(suid), int(os.environ.get("SUDO_GID", "-1")))
            except OSError:
                pass
        written = keys_path
    except OSError as e:
        written = f"写失败:{e}"
    _emit({
        "status": "ok", "via": "hook_cccrypt", "single_raw_key": single,
        "matched_dbs": len(verified), "total_dbs": len(db_page1),
        "keys_written": written,  # key 在这个 600 文件里，屏幕只显示前 6 位预览
        "session_db_found": bool(session_db),
        "db_key_preview": {os.path.basename(db): k[:6] + "…" for db, k in sorted(verified.items())},
    })


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand(f"command script add -f {__name__}.dump_wechat_key dump_wechat_key")
    debugger.HandleCommand(f"command script add -f {__name__}.hook_wechat_key hook_wechat_key")
