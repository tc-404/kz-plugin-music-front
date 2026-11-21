import { routeManifest } from '../routes/manifest.js';
import { protectAccountWrite } from '../routes/operations/writeSafety.js';
import { withControllerLogging } from '../util/observability.js';
import logoutOperationController from './logoutOperation.js';
import musicPlayOperationController from './musicPlayOperation.js';
import { operationController } from './operation.js';
import qrCheckOperationController from './qrCheckOperation.js';
/**
 * 共用路由在 Node 上另有转接的：要用 Koa 的 Cookie 等 API 的三条，以及 Node 上仍走原来
 * controller 的 /getLyric。其余的都直接用 `operationController(handler)`。
 */
const nodeAdapters = {
    qrCheck: qrCheckOperationController,
    logout: logoutOperationController,
    getMusicPlay: musicPlayOperationController,
};
const controllerOf = (route) => {
    const accountWrite = 'accountWrite' in route && route.accountWrite;
    const handler = accountWrite ? protectAccountWrite(route.handler) : route.handler;
    return (nodeAdapters[route.name] ?? operationController(handler, route.name === 'getEncryptedMusicPlay'));
};
export default Object.fromEntries(routeManifest.map((route) => [
    route.name,
    withControllerLogging(route.name, controllerOf(route)),
]));
