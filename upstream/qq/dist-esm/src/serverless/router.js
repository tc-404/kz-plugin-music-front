/**
 * A router for seventeen known paths, written by hand.
 *
 * The route set is fixed and tiny — thirteen literals and three with parameters — so a routing
 * library would be a runtime dependency bought for a `switch`. Keeping it here also keeps the
 * serverless bundle at zero npm packages, which is the property the dependency-closure gate
 * actually checks.
 */
/**
 * `/a/:b/:c?` becomes a regex with named groups. Only the two forms the route table uses are
 * supported — a required segment and a trailing optional one — because inventing more would be
 * inventing a router.
 */
const compile = (path, handler) => {
    const keys = [];
    const pattern = path
        .split('/')
        .filter((segment) => segment !== '')
        .map((segment) => {
        if (!segment.startsWith(':'))
            return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
        const optional = segment.endsWith('?');
        keys.push(segment.slice(1, optional ? -1 : undefined));
        return optional ? '(?:/([^/]+))?' : '/([^/]+)';
    })
        .join('');
    return { path, pattern: new RegExp(`^${pattern}/?$`), keys, handler };
};
export const createRouter = (routes) => {
    const staticRoutes = new Map();
    const dynamicRoutes = [];
    for (const [path, handler] of Object.entries(routes)) {
        if (path.includes(':'))
            dynamicRoutes.push(compile(path, handler));
        else
            staticRoutes.set(path, handler);
    }
    return (pathname) => {
        // A trailing slash is the same route; anything else is compared literally.
        const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
        const exact = staticRoutes.get(normalized);
        if (exact)
            return { handler: exact, params: {}, route: normalized };
        for (const route of dynamicRoutes) {
            const matched = route.pattern.exec(normalized);
            if (!matched)
                continue;
            const params = {};
            route.keys.forEach((key, index) => {
                const value = matched[index + 1];
                // An unmatched optional segment is absent, not empty: the handlers distinguish them.
                if (value !== undefined)
                    params[key] = decodeURIComponent(value);
            });
            return { handler: route.handler, params, route: route.path };
        }
        return null;
    };
};
