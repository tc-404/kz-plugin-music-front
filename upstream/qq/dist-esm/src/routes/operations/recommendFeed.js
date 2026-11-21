import { recommendFeedResult } from '../../services/recommend/feed.js';
import { requiredSession } from './requestValues.js';
// 首页 feed 只读当前账号的第 1 页，两个宿主共用同一实现。
export const recommendFeed = async (request) => recommendFeedResult(await requiredSession(request));
