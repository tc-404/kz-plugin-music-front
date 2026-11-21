import { searchMatchResult } from '../../services/search/match.js';
import { anonymousGet } from './anonymousGet.js';
export const searchMatch = anonymousGet((request) => searchMatchResult(request.query('keyword')));
