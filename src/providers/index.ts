/** provider 统一注册与调度 */

import type { Credential, Platform, StdSong } from '../types';
import * as qq from './qq';
import * as netease from './netease';
import * as kugou from './kugou';

export interface Provider {
  search(base: string, keyword: string, page: number, limit: number, cred: Credential | undefined): Promise<{ total: number; songs: StdSong[] }>;
  getUrl(base: string, song: StdSong, quality: string, cred: Credential | undefined): Promise<{ url: string; quality: string }>;
  qrKey(base: string, channel?: string): Promise<string>;
  qrCreate(base: string, key: string): Promise<string>;
  qrCheck(base: string, key: string, channel?: string): Promise<{ status: string; credential?: Credential }>;
  refresh(base: string, cred: Credential): Promise<Credential>;
}

export const PROVIDERS: Record<Platform, Provider> = {
  qq: qq as unknown as Provider,
  netease: netease as unknown as Provider,
  kugou: kugou as unknown as Provider,
};
