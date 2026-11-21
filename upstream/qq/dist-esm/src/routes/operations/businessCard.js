import { businessCardResult } from '../../services/user/businessCard.js';
import { requiredSession } from './requestValues.js';
export const getBusinessCard = async (request) => businessCardResult(await requiredSession(request));
