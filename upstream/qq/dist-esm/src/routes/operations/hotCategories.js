import { hotCategoriesResult } from '../../services/search/suggest.js';
import { requiredSession } from './requestValues.js';
// 按分类的热搜：要登录，没有业务参数。
export const getHotSearchCategories = async (request) => hotCategoriesResult(await requiredSession(request));
