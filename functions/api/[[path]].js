// /api/* di Pages. Binding SESSIONS mengaktifkan API di KV.
// Tanpa binding itu, permintaan diteruskan ke API_ORIGIN (server Node lama).
import { dispatch } from '../lib/handle.js';

export async function onRequest(context) {
  return dispatch(context.request, (context && context.env) || {});
}
