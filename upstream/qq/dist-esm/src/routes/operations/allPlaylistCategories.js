import { allCategoriesResult } from '../../services/recommend/allCategories.js';
import { anonymousGet } from './anonymousGet.js';
export const allPlaylistCategories = anonymousGet(() => allCategoriesResult());
