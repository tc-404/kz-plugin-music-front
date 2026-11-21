import { recentPlaysResult } from '../../services/user/recentPlays.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 云端最近播放：只读，type 选分类，默认歌曲。
export const getRecentPlays = async (request) => recentPlaysResult(await requiredSession(request), rawQuery(request, 'type'));
