import { dailySongsResult } from '../../services/recommend/dailySongs.js';
export const userDailySongs = async (request) => dailySongsResult(await (await request.service()).resolveSession(request.token));
