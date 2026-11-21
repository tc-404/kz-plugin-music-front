// src/protocol/playbackRestriction.ts
//
// `/getMusicPlay` 某首歌拿不到链接时附在 `playUrl[mid].restriction` 上的结构化原因。
//
// 规则很简单：没有受控实验证据，就只说「拿不到链接，原因未确认」（`url_unavailable`），
// 不猜会员、购买、地区或下架。分类框架先建好，规则表等有证据再填。零依赖，两个运行时共用。
import { playbackEntryCodesOf } from './playbackDiagnostics.js';
export const PLAYBACK_RESTRICTION_KEYS = [
    'url_unavailable',
    'membership_required',
    'purchase_required',
    'entitlement_required',
    'preview_only',
    'region_restricted',
    'taken_down',
];
const PLAYBACK_QUALITIES = ['m4a', '128', '320', 'ape', 'flac'];
export const playbackQualityOf = (value) => {
    const text = String(value ?? '');
    return PLAYBACK_QUALITIES.includes(text)
        ? text
        : '128';
};
/** 正式路径用的规则表。拿到受控实验的证据之前保持为空：所有失败都是 `url_unavailable`。 */
export const PLAYBACK_RESTRICTION_RULES = [];
const ruleMatches = (rule, input) => {
    try {
        return rule.matches(input) === true;
    }
    catch {
        return false;
    }
};
const withCodes = (codes) => Object.keys(codes).length ? { codes: { ...codes } } : {};
export const classifyPlaybackRestriction = (input, rules = PLAYBACK_RESTRICTION_RULES) => {
    for (const rule of rules) {
        if (rule.evidence !== 'verified-controlled')
            continue;
        if (ruleMatches(rule, input))
            return { key: rule.key, evidence: rule.evidence, ...withCodes(input.codes) };
    }
    // 「拿不到链接」本身是在响应里看到的事实；原因未确认。
    return { key: 'url_unavailable', evidence: 'observed-response', ...withCodes(input.codes) };
};
export const observePlaybackAuthorization = (entry, granted, context, rules = PLAYBACK_RESTRICTION_RULES) => {
    const entryCodes = playbackEntryCodesOf(entry);
    return {
        quality: context.quality,
        authenticated: context.authenticated,
        granted,
        entryCodes,
        ...(granted
            ? {}
            : { restriction: classifyPlaybackRestriction({ ...context, codes: entryCodes }, rules) }),
    };
};
// `playback.url-unavailable` 开发日志的内容由 `playbackDiagnostics.ts` 的 `playbackUnavailableLogOf` 产生，
// 这里不再另写一份。
