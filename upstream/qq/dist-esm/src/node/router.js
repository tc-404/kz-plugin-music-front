import Router from 'koa-router';
import context from '../controllers/index.js';
import { routeManifest } from '../routes/manifest.js';
// 路由表由 manifest 生成，一条路由一行在那边；这里只按方法挂上 controllers 里同名的处理函数。
const router = new Router();
for (const route of routeManifest) {
    if (route.method === 'POST')
        router.post(route.path, context[route.name]);
    else
        router.get(route.path, context[route.name]);
}
export default router;
