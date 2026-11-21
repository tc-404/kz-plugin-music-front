import u_common from '../u_common.js';
export default ({ method = 'get', params = {}, option = {} }) => {
    const options = Object.assign(option, { params });
    return u_common({ method, options });
};
