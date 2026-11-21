import { searchUsersResult } from '../../services/search/users.js';
import { requiredSession } from './requestValues.js';
export const searchUsers = async (request) => searchUsersResult({
    keyword: request.query('keyword'),
    page: request.query('page'),
    limit: request.query('limit'),
}, await requiredSession(request));
