/** 登录态探测：向各上游查询已登录账号的资料（昵称 / 头像 / VIP / userId）
 *  用来在 WebUI 里核实「凭证确实可用、能拿到登录配置」。
 *  不同上游实现不一，这里做多路径 best-effort 探测，探测不到会明确返回原因。
 */

import type { AccountProfile, Credential, Platform } from '../types';
import { buildUrl, credToHeaders, credToQuery, fetchJson, isUpstreamError, pick } from '../util';

const PATHS: Record<Platform, string[]> = {
  // QQ：/user/vip 能明确给出 isVip + vipLevel（super/green/free）；资料接口拿昵称头像
  qq: ['/user/vip', '/user/detail', '/login/status', '/api/v1/user/detail'],
  netease: ['/login/status', '/login/refresh'],
  // 酷狗：/user/detail 有 vip_type；/user/info 有头像、svip_level 与 userid，两者合并取全
  kugou: ['/user/detail', '/user/info', '/login/status', '/login/token'],
};

export interface StatusProbe {
  /** 是否从上游拿到可识别的账号资料 */
  found: boolean;
  profile?: AccountProfile;
  /** 面向用户的说明（成功或失败原因） */
  detail: string;
}

export async function probeStatus(platform: Platform, base: string, cred: Credential | undefined): Promise<StatusProbe> {
  if (!cred || (!cred.token && !cred.cookie && !cred.userId)) {
    return {
      found: false,
      detail: '该账号没有保存 token / cookie / userId。搜索通常匿名可用，但登录态资料需要凭证才能查询。',
    };
  }
  const tried: string[] = [];
  const sources: string[] = [];
  // 多接口合并：酷狗头像在 /user/info、会员在 /user/detail；QQ 会员在 /user/vip、昵称头像在 /user/detail。
  // 只取第一个成功的接口会丢字段，所以逐接口收集并合并。
  const merged: AccountProfile = {};

  for (const p of PATHS[platform]) {
    tried.push(p);
    let data: any;
    try {
      data = await fetchJson(buildUrl(base, p, credToQuery(platform, cred)), {
        headers: credToHeaders(platform, cred),
        timeoutMs: 8000,
      });
    } catch {
      continue;
    }
    if (isUpstreamError(data)) continue;
    if (!data || typeof data !== 'object') continue;

    const nickname = String(pick(data, [
      // QQ（yakult）：昵称在 profile.info.nick；酷狗：data.nickname；网易云：profile.nickname
      'data.profile.info.nick', 'profile.info.nick',
      'data.nickname', 'nickname',
      'data.profile.nickname', 'profile.nickname',
      'data.user.nickname', 'user.nickname', 'data.userName', 'userName',
      'data.profile.nick', 'profile.nick',
    ], ''));
    const avatar = String(pick(data, [
      // QQ（yakult）：头像在 profile.info.logo；酷狗：data.pic；网易云：profile.avatarUrl
      'data.profile.info.logo', 'profile.info.logo',
      'data.pic', 'pic',
      'data.profile.avatarUrl', 'profile.avatarUrl',
      'data.avatar', 'avatar', 'data.profile.avatar', 'data.user.avatar',
    ], ''));
    const userId = String(pick(data, [
      'data.profile.musicid', 'profile.musicid',
      'data.userid', 'userid', 'data.userId', 'userId',
      'data.profile.userId', 'profile.userId', 'data.user.userid',
    ], ''));

    // QQ /user/vip 返回 vipLevel: super | green | free | unknown，单独转成布尔，
    // 避免把 'green' / 'super' 当普通字符串正则匹配（'green' 不含 vip 会被误判为非会员）。
    const level = String(pick(data, ['data.vipLevel', 'vipLevel'], ''));
    const levelVip = level === 'super' || level === 'green' ? true : level === 'free' ? false : undefined;
    const vipRaw = levelVip !== undefined ? levelVip : pick(data, [
      'data.isVip', 'isVip',
      'data.profile.vipType', 'profile.vipType', 'data.vipType', 'vipType',
      'data.vip_type', 'vip_type', 'data.svip_level', 'svip_level',
      'data.bookvip_valid', 'bookvip_valid',
      'data.vip', 'vip', 'data.isVipFlag', 'data.profile.iVipFlag',
      'data.profile.vip.isVip', 'profile.vip.isVip',
    ], undefined);
    const vip = vipRaw === undefined ? undefined
      : typeof vipRaw === 'boolean' ? vipRaw
      : Number(vipRaw) > 0 || /true|vip|会员|green|super/i.test(String(vipRaw));

    if (!nickname && !avatar && !userId && vip === undefined) continue;
    sources.push(p);
    if (!merged.nickname && nickname) merged.nickname = nickname;
    if (!merged.avatar && avatar) merged.avatar = avatar;
    if (!merged.userId && userId) merged.userId = userId;
    if (merged.vip === undefined && vip !== undefined) merged.vip = vip;
  }

  if (!sources.length) {
    return {
      found: false,
      detail: `上游未提供可识别的登录资料接口（已尝试 ${tried.join(' / ')}）；不影响搜索与取直链`,
    };
  }
  return {
    found: true,
    profile: merged,
    detail: `已从上游 ${sources.join(' / ')} 获取到登录资料`,
  };
}
