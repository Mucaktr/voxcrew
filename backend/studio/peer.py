"""Bağlantının karşı ucundaki süreç stüdyonun başlattığı bir süreç mi (ADR-kullanici-varligi, katman 2).

Stüdyonun başlattığı her süreç (ajan bağlayıcıları, kabuk araçları, MCP araç sunucuları, gateway, `ollama serve`) bu
sunucu sürecinin torunudur. Kullanıcıya ait bir işlem (arayüz oturumu açma ya da kullanıcı-yalnız yazma) böyle bir
süreçten gelirse reddedilir: tarayıcı stüdyonun torunu değildir (kullanıcı onu masaüstünden açar; `--open` tarayıcıyı
ayrık bir yardımcıyla açar, bkz. main.open_browser).

Yalnızca standart kitaplık: Windows'ta iphlpapi `GetExtendedTcpTable` + Toolhelp anlık görüntüsü (ctypes), Linux'ta
`/proc`. Diğer platformlarda ve her hata durumunda sonuç `None`dır (bilinmiyor): çağıran açık bırakır (fail-open),
çünkü bu katman arayüz jetonuna ek bir savunmadır ve kullanıcıyı kilitlememelidir.

Sınır: süreç ağacından bilerek kopan (Windows'ta WMI / zamanlanmış görev, POSIX'te çift fork + setsid) ya da Vite
geliştirme vekili üzerinden gelen istek ayırt edilmez. Ayrıntı ve kalan risk:.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import sys
import threading
import time

log = logging.getLogger("studio.peer")

CACHE_TTL_S = 10.0  # aynı TCP bağlantısı (keep-alive) için tekrar sorgulama yok
_cache: dict[tuple[str, int, int], tuple[float, bool | None]] = {}
_cache_lock = threading.Lock()


def from_studio(client_host: str | None, client_port: int | None, server_port: int | None) -> bool | None:
    """True: istemci soketi bu süreçte ya da torunlarından birinde. False: değil. None: bilinmiyor."""
    if not client_host or not client_port or not server_port:
        return None
    try:
        ip = ipaddress.ip_address(client_host)
    except ValueError:
        return None  # "testclient" gibi soketsiz taşıyıcılar
    if not ip.is_loopback:
        return None
    key = (str(ip), int(client_port), int(server_port))
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < CACHE_TTL_S:
            return hit[1]
    try:
        if sys.platform == "win32":
            verdict = _windows(ip, int(client_port), int(server_port))
        elif sys.platform.startswith("linux") and os.path.isdir("/proc/self/fd"):
            verdict = _linux(ip, int(client_port), int(server_port))
        else:
            verdict = None
    except Exception:  # noqa: BLE001 - savunma katmanı arayüzü bozmamalı
        log.debug("karşı süreç sorgusu başarısız", exc_info=True)
        verdict = None
    with _cache_lock:
        if len(_cache) > 256:
            _cache.clear()
        _cache[key] = (now, verdict)
    return verdict


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


# ---------------------------------------------------------------- Windows
def _windows(ip: ipaddress.IPv4Address | ipaddress.IPv6Address, cport: int, sport: int) -> bool | None:
    import ctypes
    from ctypes import wintypes

    if ip.version != 4:
        return None  # sunucu yalnızca 127.0.0.1'e bağlanır
    iphlpapi = ctypes.WinDLL("iphlpapi")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class Row(ctypes.Structure):
        _fields_ = [("state", wintypes.DWORD), ("laddr", wintypes.DWORD), ("lport", wintypes.DWORD),
                    ("raddr", wintypes.DWORD), ("rport", wintypes.DWORD), ("pid", wintypes.DWORD)]

    size = wintypes.DWORD(0)
    AF_INET, TCP_TABLE_OWNER_PID_ALL = 2, 5
    iphlpapi.GetExtendedTcpTable(None, ctypes.byref(size), False, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0)
    owner = None
    for _attempt in range(3):
        buf = ctypes.create_string_buffer(size.value + 4096)
        rc = iphlpapi.GetExtendedTcpTable(buf, ctypes.byref(size), False, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0)
        if rc == 122:  # ERROR_INSUFFICIENT_BUFFER: tablo arada büyüdü
            continue
        if rc != 0:
            return None
        count = ctypes.cast(buf, ctypes.POINTER(wintypes.DWORD))[0]
        rows = ctypes.cast(ctypes.addressof(buf) + ctypes.sizeof(wintypes.DWORD), ctypes.POINTER(Row * count))[0]
        want_addr = int.from_bytes(ip.packed, "little")
        for row in rows:
            if (_port(row.lport) == cport and _port(row.rport) == sport and row.laddr == want_addr):
                owner = int(row.pid)
                break
        break
    if owner is None:
        return None
    me = os.getpid()
    if owner == me:
        return True

    class Entry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                    ("szExeFile", wintypes.WCHAR * 260)]

    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return None
    parents: dict[int, int] = {}
    try:
        entry = Entry()
        entry.dwSize = ctypes.sizeof(Entry)
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)

    def created(pid: int) -> int | None:
        h = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return None
        try:
            c, e, k, u = (wintypes.FILETIME() for _ in range(4))
            if not kernel32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u)):
                return None
            return (c.dwHighDateTime << 32) | c.dwLowDateTime
        finally:
            kernel32.CloseHandle(h)

    # Sahip süreçten yukarı yürü. Windows ebeveyn PID'ini ebeveyn öldükten sonra da tutar ve PID yeniden
    # kullanılabilir: ebeveyn çocuktan sonra oluşturulduysa zincir koptu demektir (yanlış pozitif olmasın).
    pid, seen = owner, set()
    child_ts = created(pid)
    while pid not in seen and pid > 4:
        seen.add(pid)
        parent = parents.get(pid)
        if parent is None or parent == pid:
            return False
        parent_ts = created(parent)
        if parent_ts is None or child_ts is None or parent_ts > child_ts:
            return False
        if parent == me:
            return True
        pid, child_ts = parent, parent_ts
    return False


def _port(raw: int) -> int:
    return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)


# ---------------------------------------------------------------- Linux
def _linux(ip: ipaddress.IPv4Address | ipaddress.IPv6Address, cport: int, sport: int) -> bool | None:
    inode = _linux_inode(ip, cport, sport)
    if inode is None:
        return None
    target = f"socket:[{inode}]"
    me = os.getpid()
    children: dict[int, list[int]] = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as fh:
                stat = fh.read().decode("latin-1")
        except OSError:
            continue
        ppid = int(stat.rsplit(")", 1)[1].split()[1])
        children.setdefault(ppid, []).append(int(name))
    # Canlı ağaç: yalnızca bu sürecin ve torunlarının soketlerine bakılır (PID yeniden kullanımı sorun değil)
    stack, tree = [me], []
    while stack:
        pid = stack.pop()
        tree.append(pid)
        stack.extend(children.get(pid, []))
    for pid in tree:
        try:
            fds = os.listdir(f"/proc/{pid}/fd")
        except OSError:
            continue
        for fd in fds:
            try:
                if os.readlink(f"/proc/{pid}/fd/{fd}") == target:
                    return True
            except OSError:
                continue
    return False


def _linux_inode(ip: ipaddress.IPv4Address | ipaddress.IPv6Address, cport: int, sport: int) -> int | None:
    tables = ["/proc/net/tcp"] if ip.version == 4 else ["/proc/net/tcp6"]
    if ip.version == 4:
        tables.append("/proc/net/tcp6")  # çift yığınlı soketlerde ::ffff:127.0.0.1
    for table in tables:
        try:
            with open(table, encoding="ascii") as fh:
                lines = fh.read().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            parts = line.split()
            if len(parts) < 10:
                continue
            local, remote = parts[1], parts[2]
            lport = int(local.rsplit(":", 1)[1], 16)
            rport = int(remote.rsplit(":", 1)[1], 16)
            if lport == cport and rport == sport and _linux_addr(local.rsplit(":", 1)[0]) == ip:
                return int(parts[9])
    return None


def _linux_addr(hexaddr: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    raw = bytes.fromhex(hexaddr)
    if len(raw) == 4:
        return ipaddress.IPv4Address(raw[::-1])
    if len(raw) == 16:
        # dört adet küçük-endian 32 bit sözcük
        words = b"".join(raw[i:i + 4][::-1] for i in range(0, 16, 4))
        addr = ipaddress.IPv6Address(words)
        return addr.ipv4_mapped or addr
    return None
