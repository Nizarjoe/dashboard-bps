// Role kab tidak boleh memilih kabupaten lain lewat ?kab= atau badan permintaan.
// Nilai klien yang beda diganti kode sesi. Provinsi dan superadmin tetap memakai filter klien.
export function kabFilter(me, requested, opts = {}) {
  const asked = String(requested ?? '').trim();
  if (me && me.role === 'kab') {
    if (opts.lockOwn || asked) return me.kode;
    return null;
  }
  return asked || null;
}
