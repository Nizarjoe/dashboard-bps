const PETAK_COL = 'APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)';

// Satu aturan cadangan untuk KPI dan ku/kc.
// Flag 1 = cadangan, flag 0 = utama. Flag kosong memakai jenis = 'Cadangan'.
export const CADANGAN_SQL = "CASE WHEN cadangan = 1 THEN 1 WHEN cadangan = 0 THEN 0 WHEN jenis = 'Cadangan' THEN 1 ELSE 0 END";

export function isCadangan(row) {
  const flag = row && row.cadangan;
  if (flag === 1 || flag === '1') return true;
  if (flag === 0 || flag === '0') return false;
  return String(row && row.jenis || '') === 'Cadangan';
}

export function cadanganFlag(row) {
  const idsub = row.idsub == null ? '' : String(row.idsub);
  if (!idsub) return null;
  return /-?C\d+$|C\d+$/.test(idsub) ? 1 : 0;
}

export function derive(row) {
  const kab = String(row.kdkab || row.kab || row.KABUPATEN_SLUG || String(row.id || row.idsub || row.id_subsegmen || '').slice(0, 4) || '');
  let rowKey = '';
  for (const k of ['id', 'idsub', 'id_subsegmen', 'ID_SUBSEGMEN']) {
    if (row[k] != null && String(row[k]) !== '') { rowKey = String(row[k]); break; }
  }
  return {
    kab,
    rowKey,
    jenis: row.jenis == null ? '' : String(row.jenis),
    status: row.status == null ? '' : String(row.status),
    cadangan: cadanganFlag(row),
    hasil: row.hasil == null ? '' : String(row.hasil),
    petak: row.petak == null ? '' : String(row.petak),
    pemanen: row.pemanen == null ? '' : String(row.pemanen),
  };
}

export function applyCell(hit, col, value) {
  if (col === 'petak' || col === PETAK_COL) { hit.petak = value; return true; }
  if (col === 'pengganti' || col === 'SAMPEL PENGGANTI') { hit.pengganti = value; return true; }
  if (hit[col] !== undefined) { hit[col] = value; return true; }
  return false;
}
