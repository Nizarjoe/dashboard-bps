export function apiError(status, code, message, extra) {
  const error = { code, message };
  if (extra && extra.fields) error.fields = extra.fields;
  if (extra && typeof extra.retryable === 'boolean') error.retryable = extra.retryable;
  if (extra && extra.sumber) error.sumber = extra.sumber;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (extra && extra.retryAfter != null) headers['retry-after'] = String(extra.retryAfter);
  return new Response(JSON.stringify({ error }), { status, headers });
}

export function apiOk(body, status = 200, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(headers || {}),
    },
  });
}
