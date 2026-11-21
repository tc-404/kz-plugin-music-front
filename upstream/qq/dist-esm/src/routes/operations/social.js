import { friendsResult, relationListResult } from '../../services/user/social.js';
import { requiredSession } from './requestValues.js';
// 社交：只读本人第一页，没有业务参数。
export const getFollowingSingers = async (request) => relationListResult('following-singers', await requiredSession(request));
export const getFollowingUsers = async (request) => relationListResult('following-users', await requiredSession(request));
export const getFollowers = async (request) => relationListResult('followers', await requiredSession(request));
export const getFriends = async (request) => friendsResult(await requiredSession(request));
