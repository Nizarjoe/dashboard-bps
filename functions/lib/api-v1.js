import { apiError, apiOk } from './errors.js';
import { bearer, readJson } from './http.js';
import { deleteSession, getSession, newToken, putSession, SESSION_TTL_SECONDS } from './session.js';
import { loadSumber, SLOTS, canonNama } from './sumber.js';
import { readAllowedSheet, sheetCatalog } from './gsheet.js';
import { createStore } from './store.js';
import { deferWork, readAkunCache, resolveAkun, syncAkun } from './akun.js';
import { indexFotoPayload, uploadsFor } from './foto-index.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FOTO = 2 * 1024 * 1024;
const CREDS = 'ID atau password salah.';

function nowMs(env) {
  return env && env.NOW != null ? Number(env.NOW) : Date.now();
}

function userOf(akun) {
  return { id: akun.id, nama: akun.nama, role: akun.role };
}

function orang(akun) {
  if (!akun) return { id: null, nama: '' };
  return { id: akun.id, nama: akun.nama };
}

function byName(akun, role, nama) {
  const want = canonNama(nama);
  return akun.find(a => a.role === role && canonNama(a.nama) === want) || null;
}

function pmlsOf(akun, mitra) {
  return String(mitra && mitra.pml_id || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(id => akun.find(a => a.id === id)).filter(Boolean);
}

function latestOf(rows) {
  const list = (rows || []).slice().sort((a, b) => Number(a.versi) - Number(b.versi));
  return list.length ? list[list.length - 1] : null;
}

function versionsFor(all, jenis, id) {
  return (all || []).filter(row => row.key === jenis + ':' + id);
}

function fotosFor(list, slot) {
  return (list || []).filter(f => f.slot === slot).sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
}

function sniff(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  const head = new TextDecoder().decode(bytes.subarray(0, 12));
  if (head.startsWith('RIFF') && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function maskNik(nik) {
  const s = String(nik || '');
  if (!s) return '';
  if (s.length <= 8) return '*'.repeat(s.length);
  return s.slice(0, 4) + '*'.repeat(s.length - 8) + s.slice(-4);
}

async function openContext(env, execCtx) {
  const sumber = await loadSumber(env);
  if (sumber.error) return sumber;
  const store = createStore(env);
  const akun = await resolveAkun(env, store, sumber.records, execCtx);
  if (akun.error) return akun;
  return { sumber, store, akun: akun.list, env, execCtx };
}

function findRecord(ctx, jenis, id) {
  return ctx.sumber.records.find(r => r.jenis === jenis && r.id === id) || null;
}

function link(ctx, rec) {
  return {
    mitra: byName(ctx.akun, 'mitra', rec.pcl),
    pml: byName(ctx.akun, 'pml', rec.pml),
  };
}

function canRead(user, rec, ctx) {
  if (user.role === 'admin') return true;
  const { mitra, pml } = link(ctx, rec);
  if (user.role === 'mitra') return mitra && mitra.id === user.id;
  if (user.role === 'pml') return pml && pml.id === user.id;
  return false;
}

function workflow(latest) {
  if (!latest) return 'belum';
  return latest.status || 'belum';
}

function isianFields(rec, latest) {
  const base = latest && latest.isian ? latest.isian : rec.bawaan;
  return {
    namaResponden: base.namaResponden || '',
    nik: base.nik || '',
    statusSampel: rec.jenis === 'pengeringan' ? (base.statusSampel || '') : null,
    hasilPencacahan: rec.jenis === 'penggilingan' ? (base.hasilPencacahan || '') : null,
  };
}

function fotoView(rec, uploads, viewer) {
  return SLOTS.map(([slot, labK, labG]) => {
    const hist = fotosFor(uploads, slot);
    const last = hist.length ? hist[hist.length - 1] : null;
    const sheetVal = rec.fotoSheet[slot] || '';
    const terisi = Boolean(last || sheetVal);
    const hidden = viewer.role === 'pml' && slot === 'ktp';
    let url = null;
    if (!hidden) {
      if (last) url = '/api/foto/' + rec.jenis + '/' + encodeURIComponent(rec.id) + '/' + slot;
      else if (/^https?:\/\//i.test(sheetVal)) url = sheetVal;
    }
    const foto = { slot, label: rec.jenis === 'pengeringan' ? labK : labG, terisi, url, uploadedAt: last ? last.waktu : null };
    if (hidden) foto.hidden = true;
    return foto;
  });
}

function ringkas(rec, ctx, latest, uploads) {
  const { mitra, pml } = link(ctx, rec);
  const fotos = fotoView(rec, uploads, { role: 'admin' });
  const status = workflow(latest);
  const dikirim = (versionsFor([latest].filter(Boolean), rec.jenis, rec.id).concat()).find(v => v && v.aksi === 'kirim');
  const kirimAt = latest && latest.aksi === 'kirim' ? latest.waktu : (dikirim && dikirim.waktu) || null;
  return {
    jenis: rec.jenis,
    id: rec.id,
    kecamatan: rec.nmkec,
    desa: rec.desa,
    nama: rec.jenis === 'penggilingan' ? (rec.nama || null) : null,
    nks: rec.nks,
    flagSampel: rec.flagSampel,
    mitra: orang(mitra),
    pml: orang(pml),
    status,
    fotoTerisi: fotos.filter(f => f.terisi).length,
    fotoTotal: 12,
    dikirimAt: status === 'sudah' ? (kirimAt || (latest && latest.waktu) || null) : null,
    updatedAt: latest ? latest.waktu : null,
  };
}

function anomaliFor(rec, ctx, latest, uploads) {
  const view = ringkas(rec, ctx, latest, uploads);
  const fields = isianFields(rec, latest);
  const fotos = fotoView(rec, uploads, { role: 'admin' });
  const out = [];
  const push = (kode, pesan) => out.push({ jenis: rec.jenis, id: rec.id, mitra: view.mitra, kode, pesan });
  if (fields.nik && !/^\d{16}$/.test(fields.nik)) push('NIK_TIDAK_VALID', 'NIK tidak terdiri dari 16 digit.');
  if (view.fotoTerisi < 12) push('FOTO_KURANG', 'Foto belum lengkap.');
  if (!fotos.find(f => f.slot === 'ktp' && f.terisi)) push('KTP_KOSONG', 'Foto KTP masih kosong.');
  const statusNilai = rec.jenis === 'pengeringan' ? fields.statusSampel : fields.hasilPencacahan;
  if (!statusNilai) push('STATUS_KOSONG', 'Status pencacahan masih kosong.');
  const adaKa = fotos.some(f => f.slot.startsWith('ka_') && f.terisi);
  if (view.status === 'sudah' && !adaKa) push('DIKIRIM_TANPA_FOTO_KA', 'Isian dikirim tanpa foto kadar air.');
  return out;
}

async function bundle(ctx) {
  let isian = [];
  let fotoNote = [];
  try {
    isian = await ctx.store.listIsian();
  } catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR') return { error: apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.') };
    throw e;
  }
  return { isian };
}

const FOTO_FRESH = 'foto:ringkas:fresh';
const FOTO_LAST = 'foto:ringkas:last';

async function loadFotoIndex(ctx) {
  const kv = ctx.env && ctx.env.SESSIONS;
  const cache = ctx.store.kind === 'apps-script' && kv;
  if (cache) {
    const fresh = await kv.get(FOTO_FRESH);
    if (fresh) return { index: indexFotoPayload(JSON.parse(fresh).rows), stale: false };
  }
  try {
    const rows = await ctx.store.listFotoAll();
    if (cache) {
      const packed = JSON.stringify({ rows });
      await kv.put(FOTO_LAST, packed);
      await kv.put(FOTO_FRESH, packed, { expirationTtl: 60 });
    }
    return { index: indexFotoPayload(rows), stale: false };
  } catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR' && cache) {
      const last = await kv.get(FOTO_LAST);
      if (last) return { index: indexFotoPayload(JSON.parse(last).rows), stale: true };
    }
    throw e;
  }
}

const DASH_FRESH = 'dash:admin:fresh';
const DASH_LAST = 'dash:admin:last';
const DASH_FRESH_TTL = 60;
const DASH_LAST_TTL = 7 * 24 * 60 * 60;

async function dropFotoFresh(ctx) {
  const kv = ctx.store.kind === 'apps-script' && ctx.env && ctx.env.SESSIONS;
  if (!kv) return;
  await kv.delete(FOTO_FRESH);
  await kv.delete(DASH_FRESH);
}

function staleDashboard(body) {
  return {
    ...body,
    stale: true,
    meta: { syncedAt: body.syncedAt || null, stale: true },
  };
}

async function savedDashboard(env) {
  const kv = env && env.SESSIONS;
  if (!kv) return null;
  const raw = await kv.get(DASH_LAST);
  if (!raw) return null;
  try { return staleDashboard(JSON.parse(raw)); }
  catch { return null; }
}

function visible(ctx, user) {
  return ctx.sumber.records.filter(rec => canRead(user, rec, ctx));
}

function progres(rows) {
  const hit = { total: rows.length, sudah: 0, draf: 0, ditolak: 0, belum: 0 };
  for (const row of rows) if (hit[row.status] != null) hit[row.status] += 1;
  return hit;
}

async function requireUser(request, env) {
  if (!env || !env.SESSIONS) return { error: apiError(401, 'UNAUTHENTICATED', 'Sesi tidak ada atau sudah berakhir.') };
  const session = await getSession(env.SESSIONS, bearer(request));
  if (!session) return { error: apiError(401, 'UNAUTHENTICATED', 'Sesi tidak ada atau sudah berakhir.') };
  return { user: session };
}

async function login(request, env, execCtx) {
  if (!env || !env.SESSIONS) return apiError(503, 'SOURCE_UNAVAILABLE', 'Penyimpanan sesi (KV SESSIONS) belum terpasang.');
  const body = await readJson(request);
  const id = String(body.id || '').trim();
  const password = String(body.password || '');
  if (!id || !password) return apiError(400, 'BAD_REQUEST', 'ID dan password wajib diisi.');
  const now = nowMs(env);
  const rlKey = 'rl:' + id;
  const raw = await env.SESSIONS.get(rlKey);
  let rl = raw ? JSON.parse(raw) : null;
  if (rl && rl.count >= 5 && now < rl.until) {
    return apiError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan login. Coba lagi nanti.', { retryAfter: Math.ceil((rl.until - now) / 1000) });
  }
  let found = null;
  let akunCache = null;
  if (id === '3305') {
    found = { id: '3305', nama: 'ADMIN KEBUMEN', role: 'admin', aktif: true };
  } else {
    akunCache = await readAkunCache(env);
    if (!akunCache) {
      try { akunCache = { list: await syncAkun(env), fresh: true }; }
      catch (e) {
        if (e && e.response) return e.response;
        if (e && e.code === 'UPSTREAM_ERROR') return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
        throw e;
      }
    }
    found = (akunCache.list || []).find(a => a.id === id) || null;
    if (!found && !akunCache.fresh) {
      try {
        const list = await syncAkun(env);
        akunCache = { list, fresh: true };
        found = list.find(a => a.id === id) || null;
      } catch (e) {
        if (e && e.code !== 'UPSTREAM_ERROR' && !e.response) throw e;
      }
    }
  }
  const ok = found && found.aktif !== false && password === id;
  if (!ok) {
    if (!rl || now >= rl.until) rl = { count: 0, until: now + WINDOW_MS };
    rl.count += 1;
    await env.SESSIONS.put(rlKey, JSON.stringify(rl), { expirationTtl: 600 });
    return apiError(401, 'INVALID_CREDENTIALS', CREDS);
  }
  await env.SESSIONS.delete(rlKey);
  if (id === '3305') akunCache = await readAkunCache(env);
  if (!akunCache || !akunCache.fresh) deferWork(execCtx, () => syncAkun(env));
  const token = newToken();
  await putSession(env.SESSIONS, token, found);
  return apiOk({
    token,
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
    user: userOf(found),
  });
}

async function logout(request, env) {
  const token = bearer(request);
  if (env && env.SESSIONS && token) await deleteSession(env.SESSIONS, token);
  return apiOk({ ok: true });
}

async function me(request, env, user, execCtx) {
  const sumber = await loadSumber(env);
  if (sumber.error) return sumber.error;
  const store = createStore(env);
  const loaded = await resolveAkun(env, store, sumber.records, execCtx);
  if (loaded.error && user.role !== 'admin') return loaded.error;
  const daftar = loaded.list || [];
  const ctx = { sumber, akun: daftar };
  const akun = daftar.find(a => a.id === user.id) || user;
  const akunStale = loaded.fresh === false;
  const syncedAt = akunStale && loaded.syncedAt ? loaded.syncedAt : sumber.syncedAt;
  const stale = Boolean(sumber.stale || akunStale);
  const body = { user: userOf(akun), syncedAt, stale };
  if (stale) body.meta = { syncedAt, stale: true };
  if (akun.role === 'mitra') {
    const ids = String(akun.pml_id || '').split(',').filter(Boolean);
    const pml = ctx.akun.find(a => a.id === ids[0]) || null;
    body.pml = orang(pml);
  }
  if (akun.role === 'pml') {
    const names = new Set(sumber.records.filter(r => r.pml && byName(daftar, 'pml', r.pml)?.id === user.id).map(r => r.pcl));
    body.jumlahMitra = [...names].filter(Boolean).length;
  }
  return apiOk(body);
}

async function listSampel(url, ctx, user) {
  const jenis = url.searchParams.get('jenis') || '';
  const status = url.searchParams.get('status') || '';
  const mitraParam = url.searchParams.get('mitra') || '';
  let mitraQ = '';
  let scoped = visible(ctx, user);
  if (jenis) scoped = scoped.filter(rec => rec.jenis === jenis);
  if (user.role === 'admin') mitraQ = mitraParam;
  else if (user.role === 'pml' && mitraParam) {
    const bawahan = new Set(scoped.map(rec => byName(ctx.akun, 'mitra', rec.pcl)?.id).filter(Boolean));
    if (!bawahan.has(mitraParam)) return apiError(403, 'FORBIDDEN', 'Mitra itu bukan bawahan Anda.');
    mitraQ = mitraParam;
  }
  let isian;
  try { isian = await ctx.store.listIsian(); }
  catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR') return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
    throw e;
  }
  const statusOf = (rec) => workflow(latestOf(versionsFor(isian, rec.jenis, rec.id)));
  const prog = progres(scoped.map(rec => ({ status: statusOf(rec) })));
  let chosen = scoped;
  if (mitraQ) chosen = chosen.filter(rec => (byName(ctx.akun, 'mitra', rec.pcl)?.id || '') === mitraQ);
  if (status) chosen = chosen.filter(rec => statusOf(rec) === status);
  let foto = { index: new Map(), stale: false };
  if (chosen.length) {
    try { foto = await loadFotoIndex(ctx); }
    catch (e) {
      if (e && e.code === 'UPSTREAM_ERROR') return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
      throw e;
    }
  }
  const data = chosen.map(rec => ringkas(rec, ctx, latestOf(versionsFor(isian, rec.jenis, rec.id)), uploadsFor(foto.index, rec.jenis, rec.id)));
  return apiOk({
    data,
    meta: { syncedAt: ctx.sumber.syncedAt, stale: ctx.sumber.stale || foto.stale, progres: prog },
  });
}

async function detail(ctx, user, jenis, id) {
  const rec = findRecord(ctx, jenis, id);
  if (!rec) return apiError(404, 'NOT_FOUND', 'Sampel tidak ditemukan.');
  if (!canRead(user, rec, ctx)) return apiError(403, 'FORBIDDEN', 'Anda tidak berhak mengakses sampel ini.');
  const isianAll = await ctx.store.listIsian();
  const versions = versionsFor(isianAll, jenis, id);
  const latest = latestOf(versions);
  const uploads = await ctx.store.listFoto(jenis, id);
  const fields = isianFields(rec, latest);
  if (user.role === 'pml') fields.nik = maskNik(fields.nik);
  const sumber = { ...rec.sumber };
  if (user.role === 'pml') {
    delete sumber.narahubung;
    delete sumber.telepon;
  }
  const body = {
    sampel: ringkas(rec, ctx, latest, uploads),
    sumber,
    isian: fields,
    foto: fotoView(rec, uploads, user),
    locked: workflow(latest) === 'sudah',
    versi: latest ? Number(latest.versi) : 0,
    alasanDitolak: latest && latest.status === 'ditolak' ? (latest.alasan || '') : null,
    meta: { syncedAt: ctx.sumber.syncedAt, stale: ctx.sumber.stale },
  };
  if (user.role === 'admin') {
    body.riwayat = versions.map(v => ({
      versi: Number(v.versi),
      oleh: orang(ctx.akun.find(a => a.id === v.oleh)),
      aksi: v.aksi,
      waktu: v.waktu,
    }));
  }
  return apiOk(body);
}

function validateIsian(rec, input, opsi, kirim, uploads) {
  const fields = {};
  const nama = String(input.namaResponden || '').trim();
  if (nama.length < 1 || nama.length > 100) fields.namaResponden = 'Nama responden harus 1 sampai 100 karakter.';
  if (rec.jenis === 'pengeringan') {
    const nilai = String(input.statusSampel || '').trim();
    if (!opsi.statusSampel.includes(nilai)) fields.statusSampel = 'Status sampel tidak ada di daftar opsi.';
  } else {
    const nilai = String(input.hasilPencacahan || '').trim();
    if (!opsi.hasilPencacahan.includes(nilai)) fields.hasilPencacahan = 'Hasil pencacahan tidak ada di daftar opsi.';
  }
  if (kirim === true) {
    const nik = String(input.nik || '').trim();
    if (!/^\d{16}$/.test(nik)) fields.nik = 'NIK harus 16 digit.';
    const ktp = fotosFor(uploads, 'ktp');
    const sheetKtp = rec.fotoSheet.ktp || '';
    if (!ktp.length && !sheetKtp) fields.ktp = 'Foto KTP wajib ada sebelum kirim.';
  }
  return fields;
}

async function putIsian(request, ctx, user, jenis, id) {
  if (user.role === 'pml') return apiError(403, 'FORBIDDEN', 'PML tidak dapat mengubah isian.');
  const rec = findRecord(ctx, jenis, id);
  if (!rec) return apiError(404, 'NOT_FOUND', 'Sampel tidak ditemukan.');
  if (!canRead(user, rec, ctx)) return apiError(403, 'FORBIDDEN', 'Anda tidak berhak mengakses sampel ini.');
  const body = await readJson(request);
  const isianAll = await ctx.store.listIsian();
  const versions = versionsFor(isianAll, jenis, id);
  const latest = latestOf(versions);
  const current = latest ? Number(latest.versi) : 0;
  const statusNow = workflow(latest);
  if (user.role === 'mitra' && statusNow === 'sudah') return apiError(409, 'LOCKED', 'Isian sudah dikirim dan terkunci.');
  if (Number(body.versi) !== current) return apiError(409, 'CONFLICT', 'Versi isian sudah berubah. Muat ulang lalu coba lagi.');
  let kirim = body.kirim;
  let status = statusNow;
  if (user.role === 'admin' && kirim == null) {
    status = statusNow === 'belum' ? 'draf' : statusNow;
    kirim = status === 'sudah';
  } else if (kirim !== true && kirim !== false) {
    return apiError(400, 'BAD_REQUEST', 'Field kirim harus true atau false.');
  } else {
    status = kirim ? 'sudah' : 'draf';
  }
  const uploads = await ctx.store.listFoto(jenis, id);
  const fields = validateIsian(rec, body.isian || {}, ctx.sumber.opsi, status === 'sudah', uploads);
  if (Object.keys(fields).length) return apiError(422, 'VALIDATION', 'Isian tidak valid.', { fields });
  const input = body.isian || {};
  const waktu = new Date().toISOString();
  const row = {
    key: jenis + ':' + id,
    versi: current + 1,
    oleh: user.id,
    aksi: status === 'sudah' ? 'kirim' : 'simpan',
    waktu,
    status,
    alasan: '',
    isian: {
      namaResponden: String(input.namaResponden || '').trim(),
      nik: String(input.nik || '').trim(),
      statusSampel: rec.jenis === 'pengeringan' ? String(input.statusSampel || '').trim() : null,
      hasilPencacahan: rec.jenis === 'penggilingan' ? String(input.hasilPencacahan || '').trim() : null,
    },
  };
  try {
    await ctx.store.appendIsian(row);
  } catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR') return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
    throw e;
  }
  return apiOk({ status, versi: row.versi, locked: status === 'sudah', updatedAt: waktu });
}

async function putFoto(request, ctx, user, jenis, id, slot) {
  if (user.role === 'pml') return apiError(403, 'FORBIDDEN', 'PML tidak dapat mengubah foto.');
  if (!SLOTS.some(([name]) => name === slot)) return apiError(404, 'NOT_FOUND', 'Slot foto tidak dikenal.');
  const rec = findRecord(ctx, jenis, id);
  if (!rec) return apiError(404, 'NOT_FOUND', 'Sampel tidak ditemukan.');
  if (!canRead(user, rec, ctx)) return apiError(403, 'FORBIDDEN', 'Anda tidak berhak mengakses sampel ini.');
  const isianAll = await ctx.store.listIsian();
  const latest = latestOf(versionsFor(isianAll, jenis, id));
  if (user.role === 'mitra' && workflow(latest) === 'sudah') return apiError(409, 'LOCKED', 'Isian sudah dikirim dan terkunci.');
  let form;
  try { form = await request.formData(); } catch { return apiError(400, 'BAD_REQUEST', 'Berkas harus dikirim sebagai multipart.'); }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return apiError(400, 'BAD_REQUEST', 'Field file wajib ada.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_FOTO) return apiError(413, 'FILE_TOO_LARGE', 'Ukuran berkas melebihi 2 MB.');
  const mime = sniff(bytes);
  if (!mime) return apiError(415, 'UNSUPPORTED_FILE', 'Hanya berkas JPEG, PNG, atau WEBP.');
  const waktu = new Date().toISOString();
  try {
    await ctx.store.uploadFoto({ jenis, id, slot, mime, bytes, oleh: user.id, waktu });
    await dropFotoFresh(ctx);
  } catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR') return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
    throw e;
  }
  const uploads = await ctx.store.listFoto(jenis, id);
  const fotos = fotoView(rec, uploads, user);
  return apiOk({
    slot,
    terisi: true,
    url: '/api/foto/' + jenis + '/' + encodeURIComponent(id) + '/' + slot,
    uploadedAt: waktu,
    fotoTerisi: fotos.filter(f => f.terisi).length,
  });
}

async function getFoto(ctx, user, jenis, id, slot) {
  if (!SLOTS.some(([name]) => name === slot)) return apiError(404, 'NOT_FOUND', 'Slot foto tidak dikenal.');
  const rec = findRecord(ctx, jenis, id);
  if (!rec) return apiError(404, 'NOT_FOUND', 'Sampel tidak ditemukan.');
  if (!canRead(user, rec, ctx)) return apiError(403, 'FORBIDDEN', 'Anda tidak berhak mengakses sampel ini.');
  if (user.role === 'pml' && slot === 'ktp') return apiError(403, 'FORBIDDEN', 'Foto KTP tidak ditampilkan untuk PML.');
  const file = await ctx.store.getFoto(jenis, id, slot);
  if (!file) return apiError(404, 'NOT_FOUND', 'Foto belum diunggah.');
  return new Response(file.bytes, {
    status: 200,
    headers: { 'content-type': file.mime, 'cache-control': 'private, max-age=300' },
  });
}

async function tolak(request, ctx, user, jenis, id) {
  if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat menolak isian.');
  const rec = findRecord(ctx, jenis, id);
  if (!rec) return apiError(404, 'NOT_FOUND', 'Sampel tidak ditemukan.');
  const body = await readJson(request);
  const alasan = String(body.alasan || '').trim();
  if (alasan.length < 1 || alasan.length > 300) {
    return apiError(422, 'VALIDATION', 'Alasan tidak valid.', { fields: { alasan: 'Alasan harus 1 sampai 300 karakter.' } });
  }
  const versions = versionsFor(await ctx.store.listIsian(), jenis, id);
  const latest = latestOf(versions);
  const current = latest ? Number(latest.versi) : 0;
  const waktu = new Date().toISOString();
  const row = {
    key: jenis + ':' + id,
    versi: current + 1,
    oleh: user.id,
    aksi: 'tolak',
    waktu,
    status: 'ditolak',
    alasan,
    isian: latest && latest.isian ? latest.isian : isianFields(rec, null),
  };
  try { await ctx.store.appendIsian(row); }
  catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR') return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
    throw e;
  }
  return apiOk({ status: 'ditolak', versi: row.versi, locked: false });
}

async function computeDashboard(ctx) {
  const isian = await ctx.store.listIsian();
  const foto = ctx.sumber.records.length ? await loadFotoIndex(ctx) : { index: new Map(), stale: false };
  const groups = { pengeringan: [], penggilingan: [] };
  const anomali = [];
  const perK = new Map();
  const perM = new Map();
  for (const rec of ctx.sumber.records) {
    const latest = latestOf(versionsFor(isian, rec.jenis, rec.id));
    const uploads = uploadsFor(foto.index, rec.jenis, rec.id);
    const item = ringkas(rec, ctx, latest, uploads);
    groups[rec.jenis].push(item);
    anomali.push(...anomaliFor(rec, ctx, latest, uploads));
    const kk = rec.kdkec + '|' + rec.nmkec;
    const kec = perK.get(kk) || { kdkec: rec.kdkec, nmkec: rec.nmkec, total: 0, sudah: 0 };
    kec.total += 1;
    if (item.status === 'sudah') kec.sudah += 1;
    perK.set(kk, kec);
    const mid = item.mitra.id || item.mitra.nama;
    const m = perM.get(mid) || { mitra: item.mitra, pml: item.pml, total: 0, sudah: 0, draf: 0, ditolak: 0, belum: 0 };
    m.total += 1;
    if (m[item.status] != null) m[item.status] += 1;
    perM.set(mid, m);
  }
  const kpiOf = (rows) => ({
    sampel: rows.length,
    utama: rows.filter(r => r.flagSampel === 'U').length,
    cadangan: rows.filter(r => r.flagSampel === 'C').length,
    sudah: rows.filter(r => r.status === 'sudah').length,
    draf: rows.filter(r => r.status === 'draf').length,
    ditolak: rows.filter(r => r.status === 'ditolak').length,
    belum: rows.filter(r => r.status === 'belum').length,
    fotoLengkap: rows.filter(r => r.fotoTerisi === 12).length,
  });
  return {
    kpi: { pengeringan: kpiOf(groups.pengeringan), penggilingan: kpiOf(groups.penggilingan) },
    perMitra: [...perM.values()],
    perKecamatan: [...perK.values()],
    anomali,
    syncedAt: ctx.sumber.syncedAt,
    stale: ctx.sumber.stale || foto.stale,
  };
}

async function rememberDashboard(kv, body) {
  const packed = JSON.stringify(body);
  await kv.put(DASH_LAST, packed, { expirationTtl: DASH_LAST_TTL });
  await kv.put(DASH_FRESH, packed, { expirationTtl: DASH_FRESH_TTL });
}

async function refreshDashboard(ctx) {
  const body = await computeDashboard(ctx);
  if (ctx.env && ctx.env.SESSIONS) await rememberDashboard(ctx.env.SESSIONS, body);
  return body;
}

async function dashboard(ctx) {
  const kv = ctx.env && ctx.env.SESSIONS;
  const remote = ctx.store.kind === 'apps-script' && kv;
  if (remote) {
    const fresh = await kv.get(DASH_FRESH);
    if (fresh) {
      try { return apiOk(JSON.parse(fresh)); }
      catch { /* hitung ulang */ }
    }
    const last = await kv.get(DASH_LAST);
    if (last) {
      try {
        const body = JSON.parse(last);
        deferWork(ctx.execCtx, () => refreshDashboard(ctx));
        return apiOk(staleDashboard(body));
      } catch { /* hitung ulang */ }
    }
  }
  try {
    const body = await computeDashboard(ctx);
    if (remote) await rememberDashboard(kv, body);
    return apiOk(body);
  } catch (e) {
    if (e && e.code === 'UPSTREAM_ERROR') {
      if (remote) {
        const saved = await savedDashboard(ctx.env);
        if (saved) return apiOk(saved);
      }
      return apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.');
    }
    throw e;
  }
}

async function pmlDashboard(ctx, user) {
  const mine = visible(ctx, user);
  const isian = await ctx.store.listIsian();
  const foto = mine.length ? await loadFotoIndex(ctx) : { index: new Map(), stale: false };
  const byMitra = new Map();
  const anomali = [];
  for (const rec of mine) {
    const latest = latestOf(versionsFor(isian, rec.jenis, rec.id));
    const uploads = uploadsFor(foto.index, rec.jenis, rec.id);
    const item = ringkas(rec, ctx, latest, uploads);
    anomali.push(...anomaliFor(rec, ctx, latest, uploads));
    const key = item.mitra.id || item.mitra.nama;
    const row = byMitra.get(key) || { mitra: item.mitra, total: 0, sudah: 0, draf: 0, ditolak: 0, belum: 0, fotoLengkap: 0 };
    row.total += 1;
    if (row[item.status] != null) row[item.status] += 1;
    if (item.fotoTerisi === 12) row.fotoLengkap += 1;
    byMitra.set(key, row);
  }
  const diri = ctx.akun.find(a => a.id === user.id);
  return apiOk({
    pml: orang(diri),
    mitra: [...byMitra.values()],
    anomali,
    syncedAt: ctx.sumber.syncedAt,
    stale: ctx.sumber.stale || foto.stale,
  });
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function ekspor(url, ctx) {
  const format = url.searchParams.get('format') || 'csv';
  if (format !== 'csv') return apiError(400, 'BAD_REQUEST', 'Format ekspor harus csv.');
  const jenis = url.searchParams.get('jenis') || '';
  const isian = await ctx.store.listIsian();
  const header = ['jenis', 'id', 'kecamatan', 'desa', 'nama', 'nks', 'flagSampel', 'mitra', 'pml', 'status', 'namaResponden', 'nik', 'statusSampel', 'hasilPencacahan', 'versi'];
  const lines = [header.join(',')];
  for (const rec of ctx.sumber.records) {
    if (jenis && rec.jenis !== jenis) continue;
    const latest = latestOf(versionsFor(isian, rec.jenis, rec.id));
    const item = ringkas(rec, ctx, latest, []);
    const fields = isianFields(rec, latest);
    lines.push([
      item.jenis, item.id, item.kecamatan, item.desa, item.nama, item.nks, item.flagSampel,
      item.mitra.nama, item.pml.nama, item.status, fields.namaResponden, fields.nik,
      fields.statusSampel, fields.hasilPencacahan, latest ? latest.versi : 0,
    ].map(csvEscape).join(','));
  }
  const jenisFile = jenis || 'semua';
  const tanggal = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response('\uFEFF' + lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="skgb-' + jenisFile + '-' + tanggal + '.csv"',
      'cache-control': 'no-store',
    },
  });
}

function akunPublik(ctx) {
  const counts = new Map();
  for (const rec of ctx.sumber.records) {
    const mitra = byName(ctx.akun, 'mitra', rec.pcl);
    if (!mitra) continue;
    counts.set(mitra.id, (counts.get(mitra.id) || 0) + 1);
    const pml = byName(ctx.akun, 'pml', rec.pml);
    if (pml) counts.set(pml.id, (counts.get(pml.id) || 0) + 1);
  }
  return {
    data: ctx.akun.map(a => {
      const ids = String(a.pml_id || '').split(',').filter(Boolean);
      const pml = a.role === 'mitra' ? (ctx.akun.find(x => x.id === ids[0]) || null) : null;
      return {
        id: a.id,
        nama: a.nama,
        role: a.role,
        pml: a.role === 'mitra' ? orang(pml) : null,
        aktif: a.aktif !== false,
        jumlahSampel: counts.get(a.id) || 0,
      };
    }),
  };
}

export async function handleV1(request, env, execCtx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/logout' && (method === 'POST' || method === 'DELETE')) return logout(request, env);
  if (path === '/api/login' && method === 'POST') return login(request, env, execCtx);
  if (!path.startsWith('/api/')) return apiError(404, 'NOT_FOUND', 'Halaman tidak ditemukan.');
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;
  if (method === 'PUT' || method === 'POST') {
    if (user.role === 'pml' && path !== '/api/logout') return apiError(403, 'FORBIDDEN', 'PML tidak dapat mengubah data.');
  }
  if (path === '/api/me' && method === 'GET') return me(request, env, user, execCtx);
  if ((path === '/api/gsheets' || path === '/api/gsheet') && method === 'GET') {
    if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat membuka monitoring.');
    if (path === '/api/gsheets') return apiOk({ sheets: sheetCatalog() });
    return readAllowedSheet(env, url.searchParams.get('sid') || '', url.searchParams.get('gid') || '0');
  }
  const ctx = await openContext(env, execCtx);
  if (ctx.error) {
    if (path === '/api/admin/dashboard' && method === 'GET' && user.role === 'admin' && ctx.error.status === 502) {
      const saved = await savedDashboard(env);
      if (saved) return apiOk(saved);
    }
    return ctx.error;
  }
  if (path === '/api/sampel' && method === 'GET') return listSampel(url, ctx, user);
  if (path === '/api/opsi' && method === 'GET') return apiOk(ctx.sumber.opsi);
  if (path === '/api/admin/dashboard' && method === 'GET') {
    if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat membuka dashboard ini.');
    return dashboard(ctx);
  }
  if (path === '/api/admin/akun' && method === 'GET') {
    if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat melihat akun.');
    return apiOk(akunPublik(ctx));
  }
  if (path === '/api/admin/ekspor' && method === 'GET') {
    if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat mengekspor.');
    return ekspor(url, ctx);
  }
  if (path === '/api/pml/dashboard' && method === 'GET') {
    if (user.role !== 'pml') return apiError(403, 'FORBIDDEN', 'Dashboard ini hanya untuk PML.');
    return pmlDashboard(ctx, user);
  }
  let m = path.match(/^\/api\/sampel\/(pengeringan|penggilingan)\/([^/]+)$/);
  if (m && method === 'GET') return detail(ctx, user, m[1], decodeURIComponent(m[2]));
  m = path.match(/^\/api\/sampel\/(pengeringan|penggilingan)\/([^/]+)\/isian$/);
  if (m && method === 'PUT') return putIsian(request, ctx, user, m[1], decodeURIComponent(m[2]));
  m = path.match(/^\/api\/sampel\/(pengeringan|penggilingan)\/([^/]+)\/foto\/([a-z0-9_]+)$/);
  if (m && method === 'PUT') return putFoto(request, ctx, user, m[1], decodeURIComponent(m[2]), m[3]);
  m = path.match(/^\/api\/foto\/(pengeringan|penggilingan)\/([^/]+)\/([a-z0-9_]+)$/);
  if (m && method === 'GET') return getFoto(ctx, user, m[1], decodeURIComponent(m[2]), m[3]);
  m = path.match(/^\/api\/admin\/sampel\/(pengeringan|penggilingan)\/([^/]+)\/tolak$/);
  if (m && method === 'POST') {
    if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat menolak isian.');
    return tolak(request, ctx, user, m[1], decodeURIComponent(m[2]));
  }
  return apiError(404, 'NOT_FOUND', 'Endpoint tidak ditemukan.');
}
