const MISSING_TRANSPORT_MESSAGE = 'Legacy QQ HTTP transport is not registered. Register one in the composition root before ' +
    'calling a catalog service: Node, Electron and Docker load `src/app.ts`, which calls ' +
    '`setLegacyHttpTransport(createAxiosLegacyTransport())`; the serverless runtime registers its ' +
    'fetch transport from `src/serverless`. Tests register the axios transport in `tests/setup.ts`.';
let registered = null;
export const setLegacyHttpTransport = (transport) => {
    registered = transport;
};
export const getLegacyHttpTransport = () => {
    if (!registered)
        throw new Error(MISSING_TRANSPORT_MESSAGE);
    return registered;
};
/** Test hook: restores the unregistered state so the failure message stays covered. */
export const clearLegacyHttpTransport = () => {
    registered = null;
};
