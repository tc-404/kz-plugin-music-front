/** 冒烟测试：mock 三个上游，验证多账号 + 搜索列表 → 按序号取精准内容全链路。
 *  运行：node smoke.mjs
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function cookieVal(cookie, name){ if(!cookie) return ''; for(const part of String(cookie).split(';')){const i=part.indexOf('=');if(i<=0)continue;if(part.slice(0,i).trim()===name)return part.slice(i+1).trim();} return ''; }

const profiles = {
  // QQ（yakult）真实结构：profile.info.nick / info.logo / profile.musicid
  qq: {
    main: { musicid: '1152921505121482831', info: { nick: 'QQ主号', logo: 'http://img/qq-main' } },
    alt: { musicid: '999', info: { nick: 'QQ小号', logo: 'http://img/qq-alt' } },
  },
  netease: { main: { profile: { nickname: '网易主号', userId: 123, vipType: 2 } } },
  kugou: { main: { nickname: '酷狗主号', userid: 99, vip: true } },
};

// 记录扫码 check 是否带 timestamp（酷狗/网易云防缓存）
const qrCheckCalls = {};
// 酷狗直链模式：url=/audio 直接给链接；meta=/audio 只给 hash，需再走 /song/url；blocked=上游风控
let kugouMode = 'url';

const mockHandler = (platform) => (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');

  // QQ /user/vip：真实结构 isVip + vipLevel（super/green/free）
  if (platform === 'qq' && u.pathname === '/user/vip') {
    const t = req.headers['x-qq-session'] || cookieVal(u.searchParams.get('cookie') || '', 'qqmusic_session');
    if (t === 'TOK_MAIN' || t === 'TOK_ALT' || t === 'QQQRTOKEN') {
      res.end(JSON.stringify({ code: 200, data: { isVip: true, vipLevel: 'green', upstream: { iVipFlag: 1 } } })); return;
    }
    res.statusCode = 401; res.end(JSON.stringify({ code: 401, message: 'Login required' })); return;
  }
  if (platform === 'qq' && u.pathname === '/user/detail') {
    const t = req.headers['x-qq-session'] || cookieVal(u.searchParams.get('cookie') || '', 'qqmusic_session');
    if (t === 'TOK_MAIN' || t === 'TOK_ALT') {
      res.end(JSON.stringify({ data: { profile: profiles.qq[t === 'TOK_MAIN' ? 'main' : 'alt'] } })); return;
    }
    if (t === 'QQQRTOKEN') {
      res.end(JSON.stringify({ data: { profile: { musicid: '8888', info: { nick: 'QQ扫码昵称', logo: 'http://img/qr-avatar' } } } })); return;
    }
    res.statusCode = 401; res.end(JSON.stringify({ code: 401, message: 'Login required' })); return;
  }
  // 酷狗 /user/detail：vip_type；/user/info：头像 + svip_level + userid（两个接口互补）
  if (platform === 'kugou' && (u.pathname === '/user/detail' || u.pathname === '/user/info')) {
    const auth = req.headers.authorization || '';
    const qr = auth.includes('token=KGQRTOKEN');
    const main = auth.includes('token=KG_MAIN') || qr;
    if (!main) { res.statusCode = 401; res.end(JSON.stringify({ error: 'no login' })); return; }
    const nick = qr ? '酷狗扫码昵称' : '酷狗主号';
    const pic = qr ? 'http://img/kugou-qr.jpg' : 'http://img/kugou-main.jpg';
    if (u.pathname === '/user/detail') {
      res.end(JSON.stringify({ data: { nickname: nick, pic, vip_type: qr ? 0 : 6 } })); return;
    }
    res.end(JSON.stringify({ data: { nickname: nick, pic, svip_level: qr ? 0 : 5, userid: qr ? 12345 : 1762008317 } })); return;
  }

  // 登录资料探测（用于核实能否获取登录配置）
  if (u.pathname === '/login/status') {
    if (platform === 'qq') {
      const t = req.headers['x-qq-session'] || cookieVal(u.searchParams.get('cookie') || '', 'qqmusic_session') || u.searchParams.get('token');
      if (t === 'TOK_MAIN' || t === 'TOK_ALT') {
        res.end(JSON.stringify({ data: { profile: profiles.qq[t === 'TOK_MAIN' ? 'main' : 'alt'] } }));
        return;
      }
      if (t === 'QQQRTOKEN') {
        res.end(JSON.stringify({ data: { profile: { musicid: '8888', info: { nick: 'QQ扫码昵称', logo: 'http://img/qr-avatar' } } } })); return;
      }
    } else if (platform === 'netease') {
      if ((u.searchParams.get('cookie') || '').includes('MUSIC_U')) {
        res.end(JSON.stringify(profiles.netease.main)); return;
      }
    } else if (platform === 'kugou') {
      const auth = req.headers.authorization || '';
      if (auth.includes('token=KG_MAIN')) {
        res.end(JSON.stringify({ data: profiles.kugou.main })); return;
      }
      if (auth.includes('token=KGQRTOKEN')) {
        res.end(JSON.stringify({ data: { nickname: '酷狗扫码昵称', userid: 12345, vip: false } })); return;
      }
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'no login' })); return;
  }

  if (u.pathname === '/search') {
    if (platform === 'qq') {
      const tk = u.searchParams.get('cookie') ? cookieVal(u.searchParams.get('cookie'), 'qqmusic_session') : (req.headers['x-qq-session'] || '');
      if (tk === 'TOK_VIPFAIL') {
        res.end(JSON.stringify({ __error: 'auth-missing: 登录态已失效' })); return;
      }
      res.end(JSON.stringify({ code: 200, total: 3, items: [
        { mid: 'QQMID001', title: 'QQ歌一', singer: [{ name: '歌手A' }], album: { title: '专辑A', mid: '000ALBUMMID1' }, interval: 200 },
        { mid: 'QQMID002', title: 'QQ歌二', singer: [{ name: '歌手B' }], album: { title: '专辑B', mid: '000ALBUMMID2' }, interval: 220 },
      ]}));
    } else if (platform === 'netease') {
      res.end(JSON.stringify({ result: { songCount: 2, songs: [
        { id: 111, name: '网易歌一', artists: [{ name: '歌手C' }], album: { name: '专辑C', picUrl: 'http://img/c' }, duration: 180000 },
        { id: 222, name: '网易歌二', artists: [{ name: '歌手D' }], album: { name: '专辑D' }, duration: 240000 },
      ]}}));
    } else {
      // 真实 MakcRe/KuGouMusicApi 的 search.js 透传酷狗官方字段（大写开头）
      res.end(JSON.stringify({ status: 1, error_code: 0, data: { total: 2, lists: [
        { FileHash: 'KGHASH1', SongName: '酷狗歌一', SingerName: '歌手E', AlbumName: '专辑E', Duration: 190, Image: 'http://img/kugou/{size}/e.jpg' },
        { FileHash: 'KGHASH2', SongName: '酷狗歌二', SingerName: '歌手F', AlbumName: '专辑F', Duration: 210, Image: 'http://img/kugou/{size}/f.jpg' },
      ]}}));
    }
    return;
  }
  if (platform === 'netease' && u.pathname === '/song/detail') {
    res.end(JSON.stringify({ songs: [
      { id: 111, al: { picUrl: 'http://img/c' } },
      { id: 222, al: { picUrl: 'http://img/d-from-detail' } },
    ]})); return;
  }
  if (platform === 'qq' && u.pathname.startsWith('/getMusicPlay/')) {
    const t = req.headers['x-qq-session'] || cookieVal(u.searchParams.get('cookie') || '', 'qqmusic_session') || u.searchParams.get('token');
    const mid = decodeURIComponent(u.pathname.split('/').pop() || '');
    const q = u.searchParams.get('quality') || '320';
    // 模拟非 VIP 账号：320/ape 拿不到 purl，m4a/128/best 正常（验证音质自动降级）
    if (q === '320' || q === 'ape') {
      res.end(JSON.stringify({ code: 0, data: { playUrl: { [mid]: {
        url: '', error: '暂无播放链接',
        restriction: { key: 'url_unavailable', hint: { message: 'need vip' } },
        source: { protocol: 'android-vkey', quality: q },
      } } } })); return;
    }
    // 真实 yakult 结构：data.playUrl[<songmid>] = { url, error, source }
    res.end(JSON.stringify({ code: 0, data: { playUrl: { [mid]: {
      url: t === 'TOK_ALT' ? 'http://cdn/qq-alt.m4a' : 'http://cdn/qq.m4a',
      error: false, source: { protocol: 'android-vkey', quality: q },
    } } } })); return;
  }
  if (platform === 'netease' && u.pathname === '/song/url') {
    res.end(JSON.stringify({ data: [{ url: 'http://cdn/netease.mp3', br: 320000 }] })); return;
  }
  if (platform === 'kugou' && u.pathname === '/audio') {
    if (kugouMode === 'url') { res.end(JSON.stringify({ data: [{ url: 'http://cdn/kugou.mp3' }] })); return; }
    res.end(JSON.stringify({ data: [{ hash: 'KGHASH1', hash_320: 'KG320HASH', hash_flac: 'KGFLACHASH' }] })); return;
  }
  if (platform === 'kugou' && u.pathname === '/song/url') {
    if (kugouMode === 'blocked') { res.end(JSON.stringify({ status: 2, errcode: 20028, error: '本次请求需要验证' })); return; }
    // 真实酷狗 /song/url：url / backupUrl 都是数组
    const qual = u.searchParams.get('quality');
    res.end(JSON.stringify({ status: 1, errcode: 0,
      url: ['http://cdn/kugou-a-' + qual + '.mp3', 'http://cdn/kugou-b-' + qual + '.mp3'],
      backupUrl: ['http://cdn/kugou-backup-' + qual + '.mp3'] })); return;
  }

  // ---- 扫码登录三接口（按真实上游结构 mock）----
  if (u.pathname === '/login/qr/key') {
    if (platform === 'qq') { res.end(JSON.stringify({ code: 0, unikey: 'QQKEY' })); return; }
    if (platform === 'netease') { res.end(JSON.stringify({ code: 200, data: { code: 200, unikey: 'NEKEY' } })); return; }
    if (platform === 'kugou') { res.end(JSON.stringify({ data: { qrcode: 'KGKEY', qrcode_img: 'data:image/png;base64,AAAA' }, status: 1, error_code: 0 })); return; }
  }
  if (u.pathname === '/login/qr/create') {
    if (platform === 'qq') { res.end(JSON.stringify({ code: 0, qrimg: 'data:image/png;base64,QQIMG' })); return; }
    if (platform === 'netease') { res.end(JSON.stringify({ code: 200, data: { qrurl: 'http://x', qrimg: 'data:image/png;base64,NEIMG' } })); return; }
    if (platform === 'kugou') { res.end(JSON.stringify({ code: 200, data: { url: 'http://x', base64: 'data:image/png;base64,KGIMG' } })); return; }
  }
  if (u.pathname === '/login/qr/check') {
    qrCheckCalls[platform] = { hasTimestamp: !!u.searchParams.get('timestamp') };
    if (platform === 'qq') { res.end(JSON.stringify({ code: 803, cookie: 'qqmusic_session=QQQRTOKEN' })); return; }
    if (platform === 'netease') { res.end(JSON.stringify({ code: 803, message: '授权成功', cookie: 'MUSIC_U=NEQRCOOKIE; __csrf=x' })); return; }
    if (platform === 'kugou') {
      // 模拟酷狗上游：token 在 Set-Cookie 头里（body 里只给 status），验证兜底解析
      res.setHeader('Set-Cookie', ['token=KGQRTOKEN; PATH=/', 'userid=12345; PATH=/']);
      res.end(JSON.stringify({ data: { status: 4 }, status: 4, error_code: 0 })); return;
    }
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
};

const servers = [];
for (const [p, port] of [['qq', 33200], ['netease', 33300], ['kugou', 33400]]) {
  const s = http.createServer(mockHandler(p));
  await new Promise(r => s.listen(port, '127.0.0.1', r));
  servers.push(s);
}

// ---- 加载插件 ----
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'music-front-smoke-'));
fs.writeFileSync(path.join(dataPath, 'settings.json'), JSON.stringify({
  bases: { qq: 'http://127.0.0.1:33200', netease: 'http://127.0.0.1:33300', kugou: 'http://127.0.0.1:33400' },
  quality: '320',
}), 'utf-8');
fs.writeFileSync(path.join(dataPath, 'accounts.json'), JSON.stringify({
  qq: [
    { id: 'acc-vipfail', name: '失效VIP', token: 'TOK_VIPFAIL', enabled: true, isDefault: false, createdAt: 0, updatedAt: 0, profile: { vip: true } },
    { id: 'acc-main', name: '主号', token: 'TOK_MAIN', enabled: true, isDefault: true, createdAt: 1, updatedAt: 1 },
    { id: 'acc-alt', name: '小号', token: 'TOK_ALT', enabled: true, isDefault: false, createdAt: 2, updatedAt: 2, profile: { nickname: '小号VIP', vip: true } },
  ],
  netease: [{ id: 'acc-ne', name: '网易主号', cookie: 'MUSIC_U=abc; __csrf=x', enabled: true, isDefault: true, createdAt: 3, updatedAt: 3 }],
  kugou: [{ id: 'acc-kg', name: '酷狗主号', token: 'KG_MAIN', userId: '99', enabled: true, isDefault: true, createdAt: 4, updatedAt: 4 }],
}), 'utf-8');

const handlers = {};
const ctx = {
  pluginName: 'kz-plugin-music-front', pluginPath: process.cwd(), dataPath, configPath: path.join(dataPath, 'config.json'),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, log: () => {} },
  router: {
    get(p, h) { handlers['get:' + p] = h; }, post(p, h) { handlers['post:' + p] = h; },
    put() {}, delete() {}, getNoAuth(p, h) { handlers['noauth:' + p] = h; }, postNoAuth() {}, page() {},
  },
};

const mod = await import('./kz-plugin-music-front/index.mjs');
await mod.plugin_init(ctx);

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label} ${extra}`); fail++; }
}
function res() { return { json(d) { this.body = d; }, status() { return this; }, send() {}, type() { return this; }, setHeader() { return this; } }; }
async function call(key, req) {
  // 模拟宿主传入的原始请求：默认来源为本机，使公开接口门禁（默认仅本机）放行
  const withRaw = { query: {}, body: undefined, params: {}, headers: {}, path: '', ...req };
  if (!withRaw.raw) withRaw.raw = { socket: { remoteAddress: (req && req._ip) || '127.0.0.1' } };
  const r = res(); await handlers[key](withRaw, r); return r.body;
}

console.log('\n=== 测试 1：三平台搜索返回标准化列表（含 seq / sessionId） ===');
for (const p of ['qq', 'netease', 'kugou']) {
  const r = await mod.api.search(p, '测试', 1, 20);
  check(`${p} 有 sessionId`, !!r.sessionId);
  check(`${p} list 非空`, r.list.length >= 2, JSON.stringify(r.list));
  check(`${p} seq 从1递增`, r.list[0]?.seq === 1 && r.list[1]?.seq === 2);
  check(`${p} 歌曲有 id/title`, !!r.list[0]?.id && !!r.list[0]?.title);
}
const kg = await mod.api.search('kugou', '测试', 1, 20);
check('酷狗真实大写字段能解析出歌名', kg.list[0]?.title === '酷狗歌一', JSON.stringify(kg.list[0]));
check('酷狗 FileHash 作为 id', kg.list[0]?.id === 'KGHASH1');
check('酷狗封面 {size} 占位符被替换', kg.list[0]?.cover === 'http://img/kugou/240/e.jpg', JSON.stringify(kg.list[0]?.cover));

console.log('\n=== 测试 1b：封面补全（QQ album.mid 拼接 / 网易云 song/detail 批量） ===');
const qqCover = await mod.api.search('qq', '测试', 1, 20);
check('QQ 用 album.mid 拼出封面 URL', qqCover.list[0]?.cover === 'https://y.qq.com/music/photo_new/T002R300x300M000000ALBUMMID1.jpg', JSON.stringify(qqCover.list[0]?.cover));
const neCover = await mod.api.search('netease', '测试', 1, 20);
check('网易云原有 picUrl 保留', neCover.list[0]?.cover === 'http://img/c', JSON.stringify(neCover.list[0]?.cover));
check('网易云缺失封面由 song/detail 补齐', neCover.list[1]?.cover === 'http://img/d-from-detail', JSON.stringify(neCover.list[1]?.cover));

console.log('\n=== 测试 2：公开搜索路由 + 多账号切换 ===');
const sDefault = await call('noauth:/search', { query: { platform: 'qq', keyword: '测试' } });
check('VIP 账号优先于默认账号', sDefault.data.accountId === 'acc-alt', JSON.stringify(sDefault));
check('失效 VIP 被自动跳过、轮换到下一个 VIP', sDefault.data.accountId === 'acc-alt' && sDefault.data.accountName === '小号', JSON.stringify(sDefault));
const sExplicitFail = await call('noauth:/search', { query: { platform: 'qq', keyword: '测试', accountId: 'acc-vipfail' } });
check('显式指定失效账号时报错而不轮换', sExplicitFail.code === -2 && /auth-missing/.test(sExplicitFail.message || ''), JSON.stringify(sExplicitFail));
const cfgVip = await call('get:/settings', { query: {} });
check('后台默认账号仍是用户设定的，不被 VIP 规则改写', cfgVip.data.platforms.find(x => x.platform === 'qq').defaultAccountId === 'acc-main');
const sAlt = await call('noauth:/search', { query: { platform: 'qq', keyword: '测试', accountId: 'acc-alt' } });
check('指定 accountId 生效', sAlt.data.accountId === 'acc-alt' && sAlt.data.accountName === '小号', JSON.stringify(sAlt));
const sBad = await call('noauth:/search', { query: { platform: 'qq', keyword: '测试', accountId: 'not-exist' } });
check('无效 accountId 被拒绝', sBad.code !== 0);

console.log('\n=== 测试 3：按序号取精准内容，且沿用搜索账号 ===');
const picked = await call('noauth:/pick', { query: { sessionId: sAlt.data.sessionId, seq: 1, quality: '320' } });
check('pick 返回直链', !!picked.data.url, JSON.stringify(picked));
check('pick 沿用小号凭证', picked.data.url.includes('qq-alt'), JSON.stringify(picked));
check('pick 回传账号信息', picked.data.accountId === 'acc-alt');
const seqBad = await call('noauth:/pick', { query: { sessionId: sAlt.data.sessionId, seq: 99 } });
check('越界 seq 被拒绝', seqBad.code !== 0);

console.log('\n=== 测试 4：后台配置与账号管理（脱敏） ===');
const cfg = await call('get:/settings', { query: {} });
const qqCfg = cfg.data.platforms.find(x => x.platform === 'qq');
check('后台返回三个 QQ 账号', qqCfg.accounts.length === 3);
check('凭证已脱敏（无明文 token）', JSON.stringify(qqCfg).indexOf('TOK_MAIN') < 0);
check('tokenMask 有值', qqCfg.accounts[0].tokenMask.includes('***'));
const added = await call('post:/accounts/manual', { body: { platform: 'qq', name: '新号', token: 'TOK_NEW' } });
check('手动添加账号成功', added.code === 0 && added.data.name === '新号');
const defSet = await call('post:/accounts/default', { body: { platform: 'qq', id: 'acc-alt' } });
check('设置默认账号成功', defSet.code === 0);
const cfg2 = await call('get:/settings', { query: {} });
check('默认账号已切换', cfg2.data.platforms.find(x => x.platform === 'qq').defaultAccountId === 'acc-alt');
const removed = await call('post:/accounts/remove', { body: { platform: 'qq', id: 'acc-alt' } });
check('删除账号成功', removed.code === 0);
const cfg3 = await call('get:/settings', { query: {} });
check('默认账号自动顺延', cfg3.data.platforms.find(x => x.platform === 'qq').defaultAccountId !== 'acc-alt');

console.log('\n=== 测试 5：登录配置探测（核实能否获取） ===');
const st1 = await call('get:/accounts/status', { query: { platform: 'qq', id: 'acc-main' } });
check('QQ 能探测到昵称', st1.data.found === true && st1.data.profile.nickname === 'QQ主号', JSON.stringify(st1));
check('QQ /user/vip 能探测到会员', st1.data.profile.vip === true, JSON.stringify(st1.data.profile));
check('QQ 能探测到头像', /^http/.test(st1.data.profile.avatar || ''), JSON.stringify(st1.data.profile));
const st2 = await call('get:/accounts/status', { query: { platform: 'netease', id: 'acc-ne' } });
check('网易云能探测到昵称', st2.data.found === true && st2.data.profile.nickname === '网易主号', JSON.stringify(st2));
const st3 = await call('get:/accounts/status', { query: { platform: 'kugou', id: 'acc-kg' } });
check('酷狗能探测到昵称', st3.data.found === true && st3.data.profile.nickname === '酷狗主号', JSON.stringify(st3));
check('酷狗 /user/detail + /user/info 合并出头像', /^http/.test(st3.data.profile.avatar || ''), JSON.stringify(st3.data.profile));
check('酷狗能探测到会员（vip_type/svip_level）', st3.data.profile.vip === true, JSON.stringify(st3.data.profile));
check('酷狗能探测到 userId', st3.data.profile.userId === '1762008317', JSON.stringify(st3.data.profile));
const cfg4 = await call('get:/settings', { query: {} });
check('探测结果已持久化', cfg4.data.platforms.find(x => x.platform === 'qq').accounts.some(a => a.profile && a.profile.nickname === 'QQ主号'));

console.log('\n=== 测试 7：三平台扫码登录（key/create/check 全链路） ===');
for (const pl of ['qq', 'netease', 'kugou']) {
  const started = await call('post:/accounts/qr/start', { body: { platform: pl, name: pl + '扫码号', channel: 'qq' } });
  check(pl + ' qr/start 成功且返回二维码图片', started.code === 0 && !!started.data.key && /^data:image/.test(started.data.qrimg || ''), JSON.stringify(started));
  const checked = await call('post:/accounts/qr/check', { body: { platform: pl, key: started.data.key, channel: 'qq', name: pl + '扫码号' } });
  check(pl + ' qr/check 803/成功 新增账号', checked.code === 0 && checked.data.status === 'ok' && !!checked.data.account, JSON.stringify(checked));
  // 自动探测：登录成功后应立即带出昵称（前端显示「备注名 - 账号名」用）
  check(pl + ' 登录成功后自动探测到昵称', !!(checked.data.account && checked.data.account.profile && checked.data.account.profile.nickname), JSON.stringify(checked.data.account && checked.data.account.profile));
}
check('酷狗/网易云扫码 check 带 timestamp 防缓存', qrCheckCalls.kugou && qrCheckCalls.kugou.hasTimestamp && qrCheckCalls.netease && qrCheckCalls.netease.hasTimestamp, JSON.stringify(qrCheckCalls));
const qacc = await call('get:/settings', { query: {} });
check('扫码新增的 QQ 账号 token 来自 cookie 解析', qacc.data.platforms.find(x => x.platform === 'qq').accounts.some(a => a.tokenMask && a.name === 'qq扫码号'));

console.log('\n=== 测试 8：QQ 音质自动降级（320 失败→m4a 成功） ===');
const dgS = await call('noauth:/search', { query: { platform: 'qq', keyword: '降级测试' } });
check('降级测试搜索有结果', dgS.code === 0 && dgS.data.list.length > 0, JSON.stringify(dgS));
const dgP = await call('noauth:/pick', { query: { sessionId: dgS.data.sessionId, seq: 1, quality: '320' } });
check('320 失败后自动降级拿到直链', dgP.code === 0 && /^http/.test(dgP.data.url), JSON.stringify(dgP));
check('降级后回传实际音质 m4a', dgP.data.quality === 'm4a', 'quality=' + dgP.data.quality);

console.log('\n=== 测试 9：酷狗 /audio 元数据 → /song/url 回退与风控提示 ===');
kugouMode = 'meta';
const kgPick = await mod.api.pick('kugou', 'KGHASH1', '320');
check('酷狗回退 /song/url 拿到直链', /^http/.test(kgPick.url || ''), JSON.stringify(kgPick));
check('酷狗数组 url 取单条而非逗号拼接', kgPick.url === 'http://cdn/kugou-a-320.mp3', JSON.stringify(kgPick));
check('酷狗按音质选择 hash', kgPick.quality === '320');
kugouMode = 'blocked';
let kgErr = '';
try { await mod.api.pick('kugou', 'KGHASH1', '128'); } catch (e) { kgErr = e.message; }
check('酷狗风控错误原文回传', kgErr.includes('本次请求需要验证') && kgErr.includes('20028'), kgErr);
kugouMode = 'url';

console.log('\n=== 测试 10：公开接口访问控制（监听地址 / IP 白名单） ===');
// 默认仅本机：本机放行，外网 IP 拒绝
const gLocal = await call('noauth:/platforms', { query: {}, _ip: '127.0.0.1' });
check('默认仅本机模式下本机可访问', gLocal.code === 0);
const gRemote = await call('noauth:/search', { query: { platform: 'qq', keyword: '测试' }, _ip: '8.8.8.8' });
check('默认仅本机模式下外网 IP 被拒绝', gRemote.code === -403, JSON.stringify(gRemote));
const gHealth = await call('noauth:/health', { query: {}, _ip: '192.168.1.9' });
check('health 同样受门禁保护', gHealth.code === -403, JSON.stringify(gHealth));
// 伪造 X-Forwarded-For 不得绕过：门禁只看 socket 对端地址
const gSpoof = await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8', headers: { 'x-forwarded-for': '127.0.0.1' } });
check('伪造 XFF 不能绕过仅本机限制', gSpoof.code === -403, JSON.stringify(gSpoof));

// 切到 0.0.0.0 + 白名单
const setAll = await call('post:/settings', { body: { listenAddress: '0.0.0.0', ipWhitelist: ['192.168.1.9', '::ffff:192.168.1.10', 'bad-ip', '192.168.1.9'] } });
check('设置 0.0.0.0 + 白名单成功', setAll.code === 0);
check('白名单去重并丢弃非法 IP', JSON.stringify(setAll.data.ipWhitelist) === JSON.stringify(['192.168.1.9', '192.168.1.10']), JSON.stringify(setAll.data.ipWhitelist));
const gW = await call('noauth:/platforms', { query: {}, _ip: '192.168.1.9' });
check('白名单内 IP 可访问', gW.code === 0, JSON.stringify(gW));
const gW6 = await call('noauth:/platforms', { query: {}, _ip: '192.168.1.10' });
check('IPv4-mapped 白名单项归一化后命中', gW6.code === 0, JSON.stringify(gW6));
const gOut = await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
check('白名单外 IP 被拒绝', gOut.code === -403, JSON.stringify(gOut));

// 0.0.0.0 但白名单为空 = 全部放行
await call('post:/settings', { body: { listenAddress: '0.0.0.0', ipWhitelist: [] } });
const gAny = await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
check('0.0.0.0 且白名单为空时放行所有 IP', gAny.code === 0, JSON.stringify(gAny));

// 切回仅本机后，白名单被强制清空（不生效）
await call('post:/settings', { body: { listenAddress: '127.0.0.1', ipWhitelist: ['8.8.8.8'] } });
const backCfg = await call('get:/settings', { query: {} });
check('切回 127.0.0.1 时白名单被清空', backCfg.data.settings.listenAddress === '127.0.0.1' && backCfg.data.settings.ipWhitelist.length === 0, JSON.stringify(backCfg.data.settings));

console.log('\n=== 测试 11：公网全局限流与临时封禁 ===');
await call('post:/settings', { body: { listenAddress: '0.0.0.0', ipWhitelist: [] } });
mod.api.resetGlobalGuard();
let limitOk = true;
for (let i = 0; i < 120; i++) {
  const r = await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
  if (r.code !== 0) { limitOk = false; break; }
}
check('全 IP 共用：前 120 次均放行', limitOk);
const over = await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
check('第 121 次触发公网封禁', over.code === -429, JSON.stringify(over));
const newIp = await call('noauth:/platforms', { query: {}, _ip: '1.1.1.1' });
check('封禁期间新公网 IP 同样被拒', newIp.code === -429, JSON.stringify(newIp));
await call('post:/settings', { body: { listenAddress: '0.0.0.0', ipWhitelist: ['9.9.9.9'] } });
const wlIp = await call('noauth:/platforms', { query: {}, _ip: '9.9.9.9' });
check('封禁期间白名单 IP 也被拒', wlIp.code === -429, JSON.stringify(wlIp));
await call('post:/settings', { body: { listenAddress: '0.0.0.0', ipWhitelist: [] } });
const localDuringBan = await call('noauth:/platforms', { query: {}, _ip: '127.0.0.1' });
check('封禁期间本机 IP 不受影响', localDuringBan.code === 0, JSON.stringify(localDuringBan));
// 仅本机模式下不累计全局计数，公网来源直接被 IP 门禁拒绝而非限流
await call('post:/settings', { body: { listenAddress: '127.0.0.1', ipWhitelist: [] } });
mod.api.resetGlobalGuard();
for (let i = 0; i < 125; i++) await call('noauth:/platforms', { query: {}, _ip: '127.0.0.1' });
check('仅本机模式下本机调用不受 120 次限制', (await call('noauth:/platforms', { query: {}, _ip: '127.0.0.1' })).code === 0);
check('仅本机模式下全局计数保持为 0', mod.api.globalGuardState().count === 0, JSON.stringify(mod.api.globalGuardState()));
// 重启插件立即重置封禁
await call('post:/settings', { body: { listenAddress: '0.0.0.0', ipWhitelist: [] } });
mod.api.resetGlobalGuard();
for (let i = 0; i < 121; i++) await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
check('已再次进入封禁态', mod.api.globalGuardState().banned === true);
await mod.plugin_init(ctx);
check('重启插件后封禁立即解除', (await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' })).code === 0);
// 5 分钟自动解除：注入假时间快进
mod.api.resetGlobalGuard();
const realNow = Date.now;
let fakeTime = realNow();
Date.now = () => fakeTime;
try {
  for (let i = 0; i < 121; i++) await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
  check('假时间下已封禁', (await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' })).code === -429);
  fakeTime += 5 * 60 * 1000 + 1;
  const after = await call('noauth:/platforms', { query: {}, _ip: '8.8.8.8' });
  check('5 分钟后公网 IP 自动恢复访问', after.code === 0, JSON.stringify(after));
} finally { Date.now = realNow; }
await call('post:/settings', { body: { listenAddress: '127.0.0.1', ipWhitelist: [] } });
mod.api.resetGlobalGuard();

console.log('\n=== 测试 6：平台概览与会话、清理 ===');
const plats = await call('noauth:/platforms', { query: {} });
check('platforms 返回账号数', plats.data.find(x => x.platform === 'qq').accountCount >= 2);
check('getSession 可用', mod.api.getSession(sAlt.data.sessionId)?.list?.length === 2);
await mod.plugin_cleanup(ctx);
check('cleanup 无异常', true);

for (const s of servers) s.close();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
