# kz-plugin-music-front（音乐服务前置）— 开发者文档

> 面向**源码持有者与二次开发者**。
> 如果你只是插件使用者，请阅读产物目录里的 `插件文档.md`；本文件讲内部机制、构建流程与高级操作。

统一 QQ 音乐 / 网易云音乐 / 酷狗音乐的前置网关插件。把三家的「搜索列表」与「按序号取精准直链」归一成同一套接口，对外暴露免登录的公开数据路由，并提供扫码登录、多账号、WebUI 与内置上游服务。

- 插件 ID：`kz-plugin-music-front`
- 版本：1.1.1
- 作者：tc-404
- 技术栈：TypeScript + Vite（宿主 Node 环境），上游为三个独立开源 Node 服务

---

## 1. 目录结构

```
kz-plugin-music-front-src/
├── src/                        # 插件源码（TypeScript）
│   ├── index.ts                # 入口：路由注册、搜索/取链、账号管理、限流门禁
│   ├── state.ts                # 内存状态与持久化：账号、凭证、会话、配置
│   ├── services.ts             # 内置上游服务生命周期管理
│   ├── access.ts               # 来源 IP 门禁 + 公网全局限流/封禁
│   ├── types.ts                # 类型定义与常量（平台、默认地址、默认配置）
│   ├── util.ts                 # HTTP、字段提取、凭证转换等工具
│   ├── providers/              # 三个平台的适配器
│   │   ├── qq.ts / netease.ts / kugou.ts
│   │   └── status.ts           # 登录态探测（昵称/头像/VIP）
├── webui/                      # 后台页面（单文件 admin.html，原生 JS，无框架）
├── upstream/                   # 三个上游服务源码（含各自 node_modules）
│   ├── server.cjs              # 统一进程入口：单端口分发到三 Worker
│   ├── worker.cjs              # Worker 承载器：require 平台入口、会话持久化、NODE_PATH 注入
│   ├── qq/ netease/ kugou/     # 各平台服务源码，未改动（依赖见下方说明）
│   └── .gitignore              # 忽略 node_modules、产物、敏感态等├── 插件文档.md                 # 面向使用者的文档（随包分发）
├── plugin.json                 # 插件清单（ID/名称/版本/作者/入口）
├── package.json                # 构建依赖与版本
├── vite.config.ts              # 构建配置与产物资源拷贝钩子
├── prepare-upstream.py         # 把上游服务（含依赖）复制进产物
├── pack.py                     # 打包 zip（node_modules 不压缩，其余 deflate）
├── smoke.mjs                   # 全量冒烟测试（88 项）
├── 构建.bat                    # 一键：安装依赖 → 构建 → 准备上游 → 打包
└── kz-plugin-music-front/      # 构建产物（最终交付目录）
```

产物目录结构：

```
kz-plugin-music-front/
├── index.mjs                   # 打包后的插件入口（Vite 输出）
├── plugin.json / package.json
├── 插件文档.md
├── webui/admin.html
└── upstream/                   # server.cjs / worker.cjs + 三平台完整服务
```

---

## 2. 快速开始

```bash
cd kz-plugin-music-front-src
npm install
npm run typecheck        # tsc --noEmit
node smoke.mjs           # 冒烟测试（用 mock 上游，不联网）
npm run build            # vite build → 产物在 kz-plugin-music-front/
python prepare-upstream.py  # 自动补齐三个上游的依赖（若缺失）并复制进产物
python pack.py           # 生成 kz-plugin-music-front-v1.1.1.zip
```

**关于上游依赖**：源码仓库**不提交** `node_modules`（见 `.gitignore`），但三个上游的 `package.json` + `package-lock.json` 都在。`prepare-upstream.py` 会检查 `upstream/<平台>/node_modules`，若缺失就自动 `npm ci --ignore-scripts --omit=dev` 按 lock 精确安装。所以从 GitHub clone 后直接跑构建即可，无需手动进三个目录装依赖——**但首次构建需联网**（国内可配 npm registry 镜像加速）。构建出的成品 zip 仍内置完整依赖，使用者开箱即用、无需联网。

### 日志分级开关

构建时由 `package.json` 的 `debugLog` 键决定日志详细程度：

- **空字符串（默认，精简模式）**：只输出插件启动/关闭的关键日志，以及所有 `warn`/`error`（含上游请求错误）。常规 info（账号数、凭证刷新成功、worker 启停、普通请求日志）全部静默。
- **任意非空内容（调试模式）**：输出全部日志，用于排障。

实现链路：`vite.config.ts` 读取该键并通过 `define` 注入 `__DEBUG_LOG__` 常量 → `src/log.ts` 据此提供 `dlog`（调试才输出）与 `klog`（始终输出）→ 构建产物里常量被内联为字面量，运行时不读磁盘。内置服务通过 `KZ_DEBUG_LOG` 环境变量同步该开关：`server.cjs` 的 `log()` 与 `worker.cjs` 的 `console.log` 拦截（错误类日志改走 stderr 保留）据此过滤，上游的 `[OK]` 等请求日志只在调试模式出现。

改完 `debugLog` 后需重新 `npm run build` 才生效。⚠️ 该键**不是运行时开关**，改了必须重新构建。

Windows 可直接双击 `构建.bat` 完成上述四步。

> **迁移规则**：构建脚本**不会**把产物复制到咔咔珂插件目录。修改源码后，需手动把 `kz-plugin-music-front/` 的内容复制到 `kakake/plugins/kz-plugin-music-front/`，并重启咔咔珂生效。

---

## 3. 构建产物为什么这么大

约 72 MB，其中约 75 MB 是 `upstream/<平台>/node_modules`（QQ 16M / 网易云 45M / 酷狗 14M）。这是刻意设计：三个上游服务的生产依赖完整内置，用户无需安装 Node 或联网装依赖。

> 注意区分：**成品 zip 内置依赖**（所以大、开箱即用），**源码仓库不含依赖**（`.gitignore` 排除，所以 clone 体积小）。构建时由 `prepare-upstream.py` 自动补齐依赖后打进成品。

- `prepare-upstream.py` 用 `copytree(dirs_exist_ok=True)` 覆盖复制，不做 `rmtree`；缺依赖时先自动 `npm ci` 安装。
- `vite.config.ts` 的 `buildStart` 只清理 Vite 自己生成的文件，绝不碰 `upstream/`。
- `pack.py` 对 `node_modules/` 内文件使用 `ZIP_STORED`（不二次压缩，省 CPU），其余用 deflate。

如果将来要做瘦身版（在线装依赖），需要改 `prepare-upstream.py` 跳过 node_modules，并保证用户首次使用时能联网、有可用 npm。

---

## 4. 运行时架构

### 4.1 统一进程 + 三 Worker

`services.ts` 启动一个 `upstream/server.cjs` 进程，监听 `9500`，按路径前缀 `/qq` `/netease` `/kugou` 分发到三个独立 Worker Thread：

- 单端口，不与常见 3000 系列端口冲突。
- 某平台 Worker 崩溃只影响自己，主线程按退避自动重启（最多 8 次，稳定后计数清零）。
- 统一入口先监听端口，不等三个 Worker 全就绪：某平台初始化慢时其他平台立即可用，未就绪期间该平台返回 502。
- 60 秒启动看门狗：Worker 卡在初始化时终止并重启。
- 防孤儿：IPC 断开检测 + 父进程 PID 心跳，咔咔珂异常退出后 1～3 秒内自退。
- 关闭时发 SIGTERM 并**等待真正退出**（5 秒兜底 SIGKILL）。

内置地址：`http://127.0.0.1:9500/{qq|netease|kugou}`，默认配置在 `types.ts` 的 `DEFAULT_BASES`。若用户把某平台地址改成非本机地址，插件直连外部服务、不为该平台启动内置服务；端口 9500 已被占用时只复用带 `unified` 健康标记的自家服务。

### 4.2 启动与关闭链路

`plugin_init(ctx)`：加载状态 → 重置全局限流计数 → `void startAllServices(ctx)`（异步不阻塞）→ 注册公开路由与后台路由 → 启动凭证刷新定时器（30 分钟）与会话清理定时器。

`plugin_cleanup(ctx)`：清定时器、清会话缓存、关闭内置服务。

---

## 5. 账号与凭证

### 5.1 数据结构

`Account` 存在 `data/kz-plugin-music-front/accounts.json`，按平台分组。字段：`id / name / enabled / isDefault / createdAt / token / cookie / userId / channel / profile`。

`profile` 由「检测登录」写入：`nickname / avatar / vip / userId / checkedAt`。**VIP 优先规则依赖这个字段**——没检测过的账号按非会员处理。

### 5.2 账号选择优先级

`state.ts` 的 `accountCandidates(platform, id?)` 定义候选顺序：

1. 显式 `id`：只返回该账号。
2. 已启用且 `profile.vip === true` → 已启用非 VIP → 未启用兜底。
3. 同级内：`isDefault` 优先，再按 `createdAt` 升序。

`getAccount()` 取候选第一个；`getDefaultAccount()` 单独按 `isDefault` 取，供后台展示用（后台"默认账号"标签不被 VIP 规则改写）。

**失败轮换**：`publicSearch` / `publicPick` / `api.search` / `api.pick` 遍历候选账号，某个失败就换下一个；显式指定 `accountId` 时不轮换，直接报错。这样某账号登录失效时仍能继续服务。

后台"优先使用"标签对应的就是 `getAccount()` 的返回值。

### 5.3 QQ 会话持久化

QQ 上游的登录凭证是服务端会话（`x-qq-session` 头传会话 ID，真正的 `musickey` 存在上游进程内存）。`worker.cjs` 启用上游官方文件持久化：

- 数据目录 `qq-auth-sessions.json`，AES-256-GCM 加密
- 密钥 `qq-session-secret.txt`，权限 0600
- 启动日志打印 `auth-session ... kind: 'file', restoredCount: N`

启用持久化前保存的旧 QQ 凭证无法恢复，需重新扫码。

### 5.4 其他平台登录细节

- 网易云扫码轮询带 `timestamp` 防缓存（官方要求）。
- 酷狗上游对 200 响应强制缓存 2 分钟，扫码轮询同样加 `timestamp`；token/userid 走响应体 + Set-Cookie 双路解析。
- 酷狗登录态**不能**用 `/login/status`（返回 502 / error_code 20010），必须走 `/user/info`（头像、svip_level）与 `/user/detail`（vip_type、bookvip_valid）。

---

## 6. 搜索与封面适配

三个上游给封面的方式不同，`providers/` 做了兼容：

| 平台 | 上游字段 | 处理方式 |
| --- | --- | --- |
| QQ | `album.mid`，无现成 URL | 拼 `https://y.qq.com/music/photo_new/T002R300x300M000{mid}.jpg` |
| 网易云 | `album.picId`（数字），哈希为私有算法 | 批量调 `/song/detail?ids=...` 取现成 picUrl；失败静默保留空值 |
| 酷狗 | `Image`，含 `{size}` 占位符 | 替换为 240 尺寸 |

QQ 音质降级顺序：`320 → m4a → 128 → best`，返回值 `quality` 是实际音质。酷狗 `/audio` 给 hash，再走 `/song/url` 换直链；上游的 `url`/`backupUrl` 是数组，只取其中一条（早期拼接成 `"url1,url2"` 导致 403，已修复）。

搜索会话缓存在内存：最多 200 个，2 小时过期（清理定时器 10 分钟一次）。

---

## 7. 访问控制与限流

`access.ts` 实现两层防护，仅作用于 4 个公开路由（`/health` `/platforms` `/search` `/pick`）：

**来源 IP 门禁**（配置存 `settings.json`，后台「文档 → 访问控制」）：

- `listenAddress` 默认 `127.0.0.1`，仅回环放行；`0.0.0.0` 时放行全部来源。
- `ipWhitelist` 仅 `0.0.0.0` 模式生效，空数组表示不限制。
- 只信 TCP 对端地址（`req.raw.socket.remoteAddress`），**不读 X-Forwarded-For**，归一化 IPv4-mapped 与 IPv6 回环。
- 拒绝返回 HTTP 403 / `code:-403`。

**公网全局限流**（仅 `0.0.0.0` 模式启用）：

- 全 IP 共用一个计数桶（60 秒窗口 120 次），不按 IP 分桶。
- 超限后全部公网来源封禁 5 分钟，期间白名单也无效；本机/内网不受影响。
- 拒绝返回 HTTP 429 / `code:-429`。
- `plugin_init` 调 `resetGlobalGuard()`，所以重启插件立即解除。
- 暴露 `api.resetGlobalGuard()` / `api.globalGuardState()` 便于测试与诊断。

> 咔咔珂框架自身对 `/plugin/*/api/*` 有按单 IP 分桶的 120 次/分钟限制，且这些路由免登录、公网可达。本插件的门禁是叠加在框架之上的额外保护。

---

## 8. 测试

`smoke.mjs` 是核心回归测试（88 项，全部通过）。它：

- 用 `node:http` 起 3 个 mock 上游（33200/33300/33400），模拟三平台的搜索、取链、登录、扫码、VIP 探测等接口；
- 直接 `import` 构建产物 `kz-plugin-music-front/index.mjs`，调用 `plugin_init` 与 handlers；
- 伪造 `raw.socket.remoteAddress` 来测试 IP 门禁与限流；
- 用替换 `Date.now` 的方式测试 5 分钟封禁自动解除；
- 覆盖：搜索标准化、多账号切换、音质降级、扫码登录、封面补全、访问控制、全局限流、VIP 优先、失败轮换等。

运行：`node smoke.mjs`（需先 `npm run build`，因为测的是产物）。

---

## 9. 高级操作与排障

### 查看内置服务状态

后台「搜索」页能看到各平台是否使用内置服务。公开接口 `GET /health` 返回 `builtinServices` 状态。

### 端口与多实例

- 统一端口固定 `9500`，内部回环端口由 `20000 + (9500 % 1000) × 3` 推出，均在源码常量中，**不支持 WebUI 修改**。
- 同机多开会复用同一端口，不会重复拉起；不要试图用相同端口做多实例。
- 若 9500 被第三方占用，插件只复用带自家健康标记的服务，不误接管。

### 覆盖上游源码

`upstream/<平台>/` 是未改动的原项目。升级某个平台时替换对应目录即可，无需改网关代码。注意替换后必须重新 `prepare-upstream.py` 与 `pack.py`。

### 常见排障点

- **上游 401 / auth-missing**：多为会话失效；QQ 检查 `qq-auth-sessions.json` 是否存在、启动日志的 `restoredCount` 是否为正数。
- **取直链 403**：检查是否把数组 URL 拼成了字符串、直链是否过期、账号是否有会员。
- **扫码一直等待**：确认轮询带了 `timestamp`；酷狗还要确认 token/userid 的双路解析。
- **封面为空**：该平台上游本身没给字段，见第 6 节。
- **Worker 反复重启**：看日志里的退避次数；单平台故障不影响另外两个。
- **进程残留**：正常由 IPC + PID 心跳自清理；异常时检查 9500 端口与残留 node 进程。

### 数据目录

`data/kz-plugin-music-front/`：`settings.json`（配置与访问控制）、`accounts.json`（账号与脱敏展示用字段）、`qq-auth-sessions.json`、`qq-session-secret.txt`。调试时可查看这些文件，但注意里面有加密会话与密钥，不要外泄。

---

## 10. Linux 部署与跨平台说明

本插件是纯 JS 实现，跨平台性很好——经核查，内置依赖里**没有任何 `.node` 原生二进制、没有平台专属包、没有 install/postinstall 编译脚本**，源码全用 `path.join`/`__dirname`，无 Windows 路径硬编码。真正的运行前提只有一个：**咔咔珂本身能在 Linux 上跑起来**。

### 10.1 为什么能跨平台上游依赖

- 三个上游的依赖全是**纯 JS**（无 `.node` 原生模块、无平台专属包、无编译脚本），所以在哪个平台安装都能在另一个平台运行。源码仓库不带依赖，clone 后由 `prepare-upstream.py` 在**当前系统**上首次安装（Linux 上就是 Linux 装），装好的成品依赖也能拷到其他平台使用。
- `.bin` 目录里虽有 `.cmd`/`.ps1` 文件，但那是开发期工具（eslint 等），**运行时完全不调用**，入口都是纯 `require`。
- 咔咔珂官方提供 Linux x64 便携版（`dist/kakake-linux-x64`），自带 `runtime/bin/node`；插件通过 `spawn(process.execPath, ...)` 用宿主自身的 Node 启动内置服务，**不依赖系统 PATH 里的 node**。所以免装 Node 的便携环境也能用。

### 10.2 在 Linux 上安装插件

与 Windows 一样：把构建产物 `kz-plugin-music-front/` 整个放进咔咔珂的 `plugins/` 目录，启用插件总开关即可。无需在 Linux 上构建或安装依赖（zip 已内置一切）。

注意事项：

- **用 `unzip` 解压** zip 包（文件名含中文，确保用 UTF-8 解压），解压后顶层就是 `kz-plugin-music-front/` 目录。
- **文件权限**：确保 `upstream/server.cjs`、`upstream/worker.cjs` 以及三个平台的入口 `app.js` 可读（正常解压即满足）。插件启动子进程时不需要这些文件有可执行位——Node 直接解释执行。
- **端口**：内置服务固定监听 `127.0.0.1:9500`。云主机上若该端口被面板或其他程序占用，插件只复用带自家健康标记的服务，不会误接管；需先释放端口。
- **QQ 会话持久化**：`worker.cjs` 用 `fs.writeFileSync(..., { mode: 0o600 })` 写密钥文件，Linux 上同样生效；重启不掉登录。

### 10.3 在 Linux 上从源码构建（开发者）

Linux 没有 `构建.bat`，用等价命令：

```bash
cd kz-plugin-music-front-src
npm install
npm run typecheck
node smoke.mjs
npm run build
python3 prepare-upstream.py
python3 pack.py
```

`prepare-upstream.py` 与 `pack.py` 都用 Python 标准库、路径用 `os.path`，跨平台无碍。产物同样是 `kz-plugin-music-front/` 与 `kz-plugin-music-front-v*.zip`。

### 10.4 systemd 托管（可选）

咔咔珂 Linux 便携版的启动命令在 `启动.sh` 里，核心是 `./runtime/bin/node ...`。若要用 systemd 托管，按你实际使用的咔咔珂版本调整 `ExecStart` 与 `WorkingDirectory`，例如（路径与入口需按实际版本核实，不要照抄）：

```ini
[Unit]
Description=Kakake
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/kakake
ExecStart=/opt/kakake/runtime/bin/node /opt/kakake/packages/server/main.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

插件内置服务由咔咔珂进程拉起，通过 IPC 断开 + PID 心跳跟随宿主退出，**无需为插件单独配置 systemd 服务**。

### 10.5 跨平台排障

- **内置服务没启动**：先看咔咔珂日志里有无 `[内置服务]` 字样；若提示统一入口不存在，检查 `upstream/server.cjs` 是否随包解压到位。
- **端口冲突**：`ss -ltnp | grep 9500` 查看占用；插件只复用带 `unified` 健康标记的自家服务。
- **上游报错**：日志前缀 `[upstream]`，按第 9 节的排障点处理；单平台故障不影响其他两个。
- **中文路径/文件名**：解压与部署目录建议避开含空格或特殊字符的路径；zip 内文件名是 UTF-8，用支持 UTF-8 的解压工具。

---

## 11. 导出给其他扩展插件

```js
const api = ctx.getPluginExports('kz-plugin-music-front');
await api.search(platform, keyword, page, limit, accountId?);  // 返回会话对象
await api.pick(platform, id, quality?, accountId?);            // 返回 { url, quality }
api.getSession(sessionId);
api.listAccounts(platform);
api.resetGlobalGuard();      // 诊断用
api.globalGuardState();      // 诊断用
```

内部调用失败时**抛异常**，不返回 `code`。

---

## 12. 上游致谢

三个平台的音源解析来自以下开源项目，本插件仅做编排与转发、未修改其源码：

| 平台 | 仓库 | 作者 | 许可证 |
| --- | --- | --- | --- |
| QQ 音乐 | https://github.com/yakult-green-tea/qq-music-api | Rain120 / yakult-green-tea | MIT |
| 网易云音乐 | https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced | MoeFurina | MIT |
| 酷狗音乐 | https://github.com/MakcRe/KuGouMusicApi | MakcRe | MIT |

各上游 `LICENSE`（QQ 另有 `ATTRIBUTION.md`）已随源码与产物保留。上游均为非官方实现，仅供学习与个人使用，请尊重版权、支持正版。
