import { signBody } from './hmac.js';

function b64(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text) {
  const bin = atob(text || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createMemoryStore() {
  const isian = [];
  const foto = [];
  const akun = [];
  return {
    kind: 'memory',
    async listIsian() { return isian.map(row => ({ ...row })); },
    async appendIsian(row) { isian.push({ ...row }); return { ...row }; },
    async listFoto(jenis, id) { return foto.filter(f => f.jenis === jenis && f.id === id).map(f => ({ ...f })); },
    async uploadFoto(row) { foto.push({ ...row, bytes: row.bytes }); return { waktu: row.waktu }; },
    async getFoto(jenis, id, slot) {
      const hits = foto.filter(f => f.jenis === jenis && f.id === id && f.slot === slot);
      if (!hits.length) return null;
      hits.sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
      const last = hits[hits.length - 1];
      return { mime: last.mime, bytes: last.bytes, waktu: last.waktu };
    },
    async listAkun() { return akun.map(a => ({ ...a })); },
    async upsertAkun(row) {
      const i = akun.findIndex(a => a.id === row.id);
      if (i >= 0) akun[i] = { ...akun[i], ...row };
      else akun.push({ ...row });
      return { ...row };
    },
  };
}

export function createKvStore(kv) {
  const fotoIdx = (jenis, id) => 'foto-idx:' + jenis + ':' + id;
  return {
    kind: 'kv',
    async listIsian() {
      const raw = await kv.get('isian:all');
      return raw ? JSON.parse(raw) : [];
    },
    async appendIsian(row) {
      const all = await this.listIsian();
      all.push(row);
      await kv.put('isian:all', JSON.stringify(all));
      return row;
    },
    async listFoto(jenis, id) {
      const raw = await kv.get(fotoIdx(jenis, id));
      return raw ? JSON.parse(raw) : [];
    },
    async uploadFoto(row) {
      const list = await this.listFoto(row.jenis, row.id);
      const item = { slot: row.slot, waktu: row.waktu, mime: row.mime, oleh: row.oleh };
      list.push(item);
      await kv.put(fotoIdx(row.jenis, row.id), JSON.stringify(list));
      await kv.put('foto-bin:' + row.jenis + ':' + row.id + ':' + row.slot + ':' + row.waktu, b64(row.bytes));
      return { waktu: row.waktu };
    },
    async getFoto(jenis, id, slot) {
      const list = (await this.listFoto(jenis, id)).filter(f => f.slot === slot);
      if (!list.length) return null;
      list.sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
      const last = list[list.length - 1];
      const raw = await kv.get('foto-bin:' + jenis + ':' + id + ':' + slot + ':' + last.waktu);
      if (!raw) return null;
      return { mime: last.mime, bytes: fromB64(raw), waktu: last.waktu };
    },
    async listAkun() {
      const raw = await kv.get('akun:all');
      return raw ? JSON.parse(raw) : [];
    },
    async upsertAkun(row) {
      const all = await this.listAkun();
      const i = all.findIndex(a => a.id === row.id);
      if (i >= 0) all[i] = { ...all[i], ...row };
      else all.push(row);
      await kv.put('akun:all', JSON.stringify(all));
      return row;
    },
  };
}

export function createAppsScriptStore(env) {
  return {
    kind: 'apps-script',
    async call(op, payload) {
      const body = await signBody(env.APPS_SCRIPT_SECRET, op, payload);
      let res;
      try {
        res = await fetch(env.APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const err = new Error('upstream');
        err.code = 'UPSTREAM_ERROR';
        throw err;
      }
      let data = {};
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || data.ok === false) {
        const err = new Error(data.error || 'upstream');
        err.code = 'UPSTREAM_ERROR';
        throw err;
      }
      return data.result;
    },
    async listIsian() { return (await this.call('listIsian', {})) || []; },
    async appendIsian(row) { return this.call('appendIsian', row); },
    async listFoto(jenis, id) { return (await this.call('listFoto', { jenis, id })) || []; },
    async uploadFoto(row) {
      return this.call('uploadFoto', {
        jenis: row.jenis, id: row.id, slot: row.slot, mime: row.mime, oleh: row.oleh, waktu: row.waktu,
        base64: b64(row.bytes),
      });
    },
    async getFoto(jenis, id, slot) {
      const result = await this.call('getFoto', { jenis, id, slot });
      if (!result || !result.base64) return null;
      return { mime: result.mime, bytes: fromB64(result.base64), waktu: result.waktu };
    },
    async listAkun() { return (await this.call('listAkun', {})) || []; },
    async upsertAkun(row) { return this.call('upsertAkun', row); },
  };
}

export function createStore(env) {
  if (env && env.APPS_SCRIPT_URL) return createAppsScriptStore(env);
  if (env && env.STORE === 'memory') return createMemoryStore();
  if (env && env.SESSIONS) return createKvStore(env.SESSIONS);
  return createMemoryStore();
}
