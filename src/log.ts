/** 日志分级：构建期由 package.json 的 debugLog 键决定（Vite define 注入 __DEBUG_LOG__）。
 *  非空 = 调试模式（输出全部日志）；空 = 精简模式（仅启动/关闭与 warn/error）。 */
import type { Ctx } from './types';

declare const __DEBUG_LOG__: string | undefined;

let debug = false;
try {
  debug = typeof __DEBUG_LOG__ === 'string' && __DEBUG_LOG__.trim().length > 0;
} catch { /* 构建未注入时按精简处理 */ }

/** 当前是否调试模式（供内置服务开关透传） */
export function isDebugLog(): boolean {
  return debug;
}

/** 常规日志：仅调试模式输出 */
export function dlog(ctx: Ctx, ...a: unknown[]): void {
  if (debug) ctx.logger.info(...a);
}

/** 关键日志：启动/关闭，任何模式都输出 */
export function klog(ctx: Ctx, ...a: unknown[]): void {
  ctx.logger.info(...a);
}
