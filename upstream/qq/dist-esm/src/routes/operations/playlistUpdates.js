import { playlistUpdatesResult } from '../../services/user/playlistUpdates.js';
import { requiredSession } from './requestValues.js';
// 收藏歌单里哪些有新歌：只读收藏歌单第一页。
export const getPlaylistUpdates = async (request) => playlistUpdatesResult(await requiredSession(request));
