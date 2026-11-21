import { radioCategoriesResult } from '../../services/radio/categories.js';
import { anonymousGet } from './anonymousGet.js';
export const radioCategories = anonymousGet(() => radioCategoriesResult());
