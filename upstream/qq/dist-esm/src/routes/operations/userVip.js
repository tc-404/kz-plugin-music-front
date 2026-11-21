import { userVipResult } from '../../services/user/vip.js';
export const userVip = async (request) => userVipResult(await (await request.service()).resolveSession(request.token));
