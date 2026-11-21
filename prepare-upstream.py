"""把内置上游服务（含生产依赖）复制到插件构建产物目录。

在 npm run build 之后、pack.py 之前由构建.bat 调用。
把 <root>/upstream/<平台> 整个复制到 <root>/kz-plugin-music-front/upstream/<平台>。
"""
import os
import shutil
import subprocess
import sys

root = os.path.dirname(os.path.abspath(__file__))
src_root = os.path.join(root, "upstream")
dst_root = os.path.join(root, "kz-plugin-music-front", "upstream")

if not os.path.isdir(src_root):
    print("  [upstream] source dir missing: upstream/")
    sys.exit(1)

PLATFORMS = ["qq", "netease", "kugou"]
ENTRY_FILES = ["server.cjs", "worker.cjs"]
total = 0

# 源码仓库不含 node_modules（GitHub 不传依赖）。构建时若缺依赖，用 lock 精确安装，
# 让使用者 clone 后直接一键构建，无需手动进三个目录装依赖。
def ensure_deps(p):
    nm = os.path.join(src_root, p, "node_modules")
    if os.path.isdir(nm):
        return True
    pkg = os.path.join(src_root, p, "package.json")
    lock = os.path.join(src_root, p, "package-lock.json")
    if not os.path.isfile(pkg):
        print("  [upstream] %s missing package.json" % p)
        return False
    print("  [upstream] %s 无 node_modules，正在从 lock 安装依赖…" % p)
    npm = "npm.cmd" if os.name == "nt" else "npm"
    cmd = [npm, "ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"]
    if not os.path.isfile(lock):
        print("  [upstream] %s 无 lock，回退 npm install --omit=dev" % p)
        cmd = [npm, "install", "--omit=dev", "--no-audit", "--no-fund"]
    try:
        r = subprocess.run(cmd, cwd=os.path.join(src_root, p), shell=(os.name == "nt"))
        if r.returncode != 0:
            print("  [upstream] %s 依赖安装失败" % p)
            return False
    except Exception as e:
        print("  [upstream] %s 依赖安装异常: %s" % (p, e))
        return False
    return os.path.isdir(nm)

for p in PLATFORMS:
    if not ensure_deps(p):
        sys.exit(1)

# 统一进程入口（单进程 + 三 Worker 的调度器与承载器）单独复制到 upstream 根目录
os.makedirs(dst_root, exist_ok=True)
for f in ENTRY_FILES:
    s = os.path.join(src_root, f)
    if not os.path.isfile(s):
        print("  [upstream] missing entry: %s" % f)
        sys.exit(1)
    shutil.copy2(s, os.path.join(dst_root, f))
    print("  [upstream] entry %s copied" % f)

for p in PLATFORMS:
    s = os.path.join(src_root, p)
    d = os.path.join(dst_root, p)
    if not os.path.isdir(s):
        print("  [upstream] missing: %s" % p)
        sys.exit(1)
    # 用覆盖复制，不用 rmtree（避免触发批量删除保护，且结构稳定时覆盖即足够）
    shutil.copytree(s, d, dirs_exist_ok=True)
    size = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _dn, fn in os.walk(d) for f in fn
    )
    total += size
    print("  [upstream] %s -> %.1f MB" % (p, size / 1024 / 1024))

print("  [upstream] total %.1f MB" % (total / 1024 / 1024))
