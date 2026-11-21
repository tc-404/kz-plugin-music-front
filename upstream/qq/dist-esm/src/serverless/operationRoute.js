import { createServerlessQrOperations } from './qrOperations.js';
import { capabilitiesFor } from './qrRuntime.js';
import { json } from './response.js';
export const operationRequestOf = ({ url, params, token, tokenSource, service, env, options, request, strictRequest, }) => ({
    runtime: 'serverless',
    signal: request?.signal,
    unverifiedWritesEnabled: env?.QQ_UNVERIFIED_WRITES_ENABLED === '1',
    method: request?.method ?? 'GET',
    body: async () => request?.json(),
    contentType: request?.headers.get('content-type') ?? undefined,
    query: (name) => url.searchParams.get(name) ?? undefined,
    queryRaw: (name) => {
        const values = url.searchParams.getAll(name);
        return strictRequest && values.length > 1 ? values : values[0];
    },
    params,
    token,
    tokenSource,
    fetchSite: request?.headers.get('sec-fetch-site') ?? undefined,
    sessionConfigured: Boolean(env?.QQ_SESSION_SECRET),
    service,
    qr: createServerlessQrOperations({ env: env ?? {}, options: options ?? {}, service }),
    capabilities: capabilitiesFor(options ?? {}, env ?? {}),
});
export const operationRoute = (handler, strictRequest = false) => async (context) => {
    const result = await handler(operationRequestOf({ ...context, strictRequest }));
    return json(result.body, result.status, result.headers);
};
