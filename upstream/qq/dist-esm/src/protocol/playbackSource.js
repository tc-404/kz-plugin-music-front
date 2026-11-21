// src/protocol/playbackSource.ts
//
// 一首歌取到（或没取到）的音源，在内部怎么描述。对外的 `playUrl` 回包形状不变，只多一个可选的 `source`，
// 里面只放几项（见 publicSourceOf），其余只在内部用。
// 「完整」「试听」「不确定」分开记；文件格式、加密、授权结果、能不能直接播、试听范围也各记各的。
// 不知道的就留空，不拿别的字段推算。零依赖，两个运行时共用。
export const PLAYBACK_PROTOCOLS = {
    'android-vkey': {
        rpc: 'music.vkey.GetVkey/UrlGetVkey',
        profile: 'android',
        requiresSession: true,
        files: 'plain',
        qualities: ['m4a', '128', '320', 'flac', 'ape'],
        evidence: 'verified-controlled',
        implemented: true,
        usedByDefault: true,
        notes: '带会话的请求都先走这里。文件名是两段：前缀、songmid、media_mid（没有就再放一次 songmid）。' +
            '登录失效、被限流时不再试；m4a、128 原因没确认时同一请求最多再取一次。',
    },
    'preview-rs02': {
        rpc: 'music.vkey.GetVkey/UrlGetVkey',
        profile: 'android',
        requiresSession: true,
        files: 'preview',
        qualities: ['preview'],
        evidence: 'verified-controlled',
        implemented: true,
        usedByDefault: false,
        notes: '调用方明确要试听（preview=1）才用。单曲详情确认有试听文件、又有 14 个字符的 media id 才去要，' +
            '不拿 songmid 代替。拿不到不再试。',
    },
    'web-anonymous-vkey': {
        rpc: 'vkey.GetVkeyServer/CgiGetVkey',
        profile: 'web',
        requiresSession: false,
        files: 'plain',
        qualities: ['m4a', '128', 'preview'],
        evidence: 'existing-behavior',
        implemented: true,
        usedByDefault: false,
        notes: '只有 Node 不带会话时用，Serverless 不带会话直接回 401。失败不再试，也不会改走带会话的路。',
    },
    'web-session-vkey': {
        rpc: 'music.vkey.GetVkey/UrlGetVkey',
        profile: 'webPlayer',
        requiresSession: true,
        files: 'plain',
        qualities: ['m4a', '128', '320', 'flac'],
        evidence: 'verified-controlled',
        implemented: true,
        usedByDefault: true,
        notes: '安卓身份明确回 104003 时，换官方网页播放器的 comm、标头和 Cookie，用同一个文件名再要一次。' +
            '同一会员账号在 App 身份被挡的歌，官方网页播放器能放完整歌曲，实测四种音质都拿到完整文件。试听、ape 不用。',
    },
    'evkey-plain': {
        rpc: 'music.vkey.GetEVkey/CgiGetEVkey',
        profile: 'android',
        requiresSession: true,
        files: 'plain',
        qualities: [],
        evidence: 'observed-response',
        implemented: false,
        usedByDefault: false,
        notes: '同一首歌、同一账号只换出口的对照里，现行做法被挡的歌换成这里（含 ct=24、一段文件名等组合）也一样被挡；' +
            '另有一种账号在这里一律被拒。没有证据能多拿到歌，不当备援。',
    },
    'encrypted-evkey': {
        rpc: 'music.vkey.GetEVkey/CgiGetEVkey',
        profile: 'android',
        requiresSession: true,
        files: 'encrypted',
        qualities: ['96', '192', 'flac'],
        evidence: 'verified-controlled',
        implemented: true,
        usedByDefault: false,
        notes: '只在独立的加密取链接接口使用。返回加密文件链接和对应字段，不解密。',
    },
};
export const playbackAccessOf = ({ granted, kind }) => granted ? kind : 'refused';
export const playbackPlayabilityOf = ({ granted, cdn, encryption, }) => {
    if (!granted)
        return 'unplayable';
    if (encryption === 'encrypted')
        return 'unsupported-encrypted';
    return cdn === 'unverified-default' ? 'cdn-unverified' : 'direct';
};
/**
 * 拿到链接的条目算哪一种：明确要的试听就是试听；完整文件那条路上，这一条没有带失败的结果码才算完整，
 * 带着非零结果码却又有链接的，不确定是什么，记成 unknown。
 */
export const playbackSourceKindOf = (protocol, codes) => {
    if (protocol === 'preview-rs02')
        return 'preview';
    return codes.result === undefined || codes.result === 0 ? 'full' : 'unknown';
};
export const publicSourceOf = (source) => ({
    kind: source.kind,
    protocol: source.protocol,
    cdn: source.cdn,
    ...(source.deliveredQuality ? { quality: source.deliveredQuality } : {}),
    ...(source.codec ? { codec: source.codec } : {}),
    ...(source.trial?.durationMs !== undefined
        ? { trial: { durationMs: source.trial.durationMs } }
        : {}),
});
/** 对外的成功条目：url、error 和以前一样，试听多一个 preview，最后是可选的 source。 */
export const publicPlayEntryOf = (source) => ({
    url: source.url,
    error: false,
    ...(source.protocol === 'preview-rs02' ? { preview: true } : {}),
    source: publicSourceOf(source),
});
