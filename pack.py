"""打包插件产物为 zip（UTF-8 文件名，解压后顶层即插件目录）。

node_modules 内的文件用 ZIP_STORED（多为已压缩的 js/map，二次压缩收益低且耗时），
其余文件用 ZIP_DEFLATE。
"""
import json
import os
import zipfile

root = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(root, "package.json"), encoding="utf-8") as f:
    version = json.load(f)["version"]
out = os.path.join(root, "kz-plugin-music-front-v" + version + ".zip")
src = os.path.join(root, "kz-plugin-music-front")

stored = 0
deflated = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for dirpath, _dirs, files in os.walk(src):
        for name in files:
            full = os.path.join(dirpath, name)
            arcname = os.path.relpath(full, root).replace(os.sep, "/")
            zi = zipfile.ZipInfo.from_file(full, arcname)
            if "node_modules/" in arcname.replace("\\", "/"):
                zi.compress_type = zipfile.ZIP_STORED
            else:
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.compress_level = 6
            with open(full, "rb") as fh, zf.open(zi, "w") as dest:
                dest.write(fh.read())

size_mb = os.path.getsize(out) / 1024 / 1024
print("  %s / %.1f MB" % (os.path.basename(out), size_mb))
