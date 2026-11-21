// 网关与凭证码冲突时供两个宿主返回 502，协议数字和安全说明仍保持原形。
export class GatewayCredentialConflictError extends Error {
    responseStatus = 502;
    phase;
    upstreamCode;
    globalCode;
    httpStatus;
    constructor(error) {
        super(`${error.phase} failed (HTTP ${error.httpStatus}, global=${error.globalCode}, code=${error.upstreamCode ?? 'unknown'})`);
        // 安全摘要继续走协议错误的白名单，502 是客户端收到的状态，不覆盖上游 HTTP 200。
        this.name = 'QqProtocolError';
        this.phase = error.phase;
        this.upstreamCode = error.upstreamCode;
        this.globalCode = error.globalCode;
        this.httpStatus = error.httpStatus;
    }
}
