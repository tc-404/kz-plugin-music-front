import { friendRankResult } from '../../services/user/friendRank.js';
import { requiredSession } from './requestValues.js';
// 好友听歌日榜：要登录，只读第一页。
export const getFriendRank = async (request) => friendRankResult(await requiredSession(request));
