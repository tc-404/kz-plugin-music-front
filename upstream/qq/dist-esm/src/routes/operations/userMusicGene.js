import { userMusicGeneResult } from '../../services/user/musicGene.js';
import { requiredSession } from './requestValues.js';
export const userMusicGene = async (request) => userMusicGeneResult(await requiredSession(request));
