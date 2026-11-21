import { soundPowerResult } from '../../services/user/soundPower.js';
import { requiredSession } from './requestValues.js';
// 本人的音乐力等级：要登录，没有业务参数。
export const getSoundPower = async (request) => soundPowerResult(await requiredSession(request));
