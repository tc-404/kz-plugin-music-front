import { likedCategoriesResult } from '../../services/user/likedCategories.js';
import { requiredSession } from './requestValues.js';
// 「我喜欢」的分类：要登录，没有业务参数。
export const getLikedSongCategories = async (request) => likedCategoriesResult(await requiredSession(request));
