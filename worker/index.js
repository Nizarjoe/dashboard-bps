// Pages advanced mode. Satu skrip ini melayani /api/* dan aset statis.
import { dispatch } from '../functions/lib/handle.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return dispatch(request, env, ctx);
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Aset statis tidak tersedia', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
