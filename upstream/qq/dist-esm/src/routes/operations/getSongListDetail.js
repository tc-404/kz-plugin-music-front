import songListDetailService from '../../services/songLists/songListDetail.js';
// 匿名 CGI 先读；只有 code 10 才由 service 重读。重读失败仍保留匿名回应，不能让 Folia 清掉会话。
export const getSongListDetail = async (request) => {
    const disstid = request.params.disstid ?? request.queryRaw('disstid');
    const token = request.token;
    const { status, body } = await songListDetailService({
        method: 'get',
        params: { disstid },
        option: {},
        ...(token && (request.runtime === 'node' || request.sessionConfigured)
            ? {
                readWithCredential: async (id) => (await request.service()).getAuthenticatedSongListDetail(token, id),
            }
            : {}),
    });
    return { status, headers: {}, body };
};
