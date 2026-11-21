import { searchResult } from '../../services/search/search.js';
import { hotSearchesResult, searchSuggestionsResult } from '../../services/search/suggest.js';
import { optionalSession, rawQuery } from './requestValues.js';
// src/routes/operations/searchCatalog.ts
//
// 关键字搜索有会话就带凭证、没有就匿名搜；热搜和搜索建议一律匿名读。
export const getSearch = async (request) => {
    const query = {
        keyword: rawQuery(request, 'keyword'),
        type: rawQuery(request, 'type'),
        page: rawQuery(request, 'page'),
        limit: rawQuery(request, 'limit'),
    };
    return searchResult(query, await optionalSession(request));
};
export const getHotSearches = () => hotSearchesResult();
export const getSearchSuggestions = (request) => searchSuggestionsResult(rawQuery(request, 'keyword'));
