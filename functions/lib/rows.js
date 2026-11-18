const PETAK_COL = 'APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)';

export function derive(row) {
  const kab = String(row.kdkab || row.kab || row.KABUPATEN_SLUG || String(row.id || row.idsub || row.id_subsegmen || '').slice(0, 4) || '');
  let rowKey = '';
  for (const k of ['id', 'idsub', 'id_subsegmen', 'ID_SUBSEGMEN']) {
    if (row[k] != null && String(row[k]) !== '') { rowKey = String(row[k]); break; }
  }
  const idsub = row.idsub == null ? '' : String(row.idsub);
  return {
    kab,
    rowKey,
    jenis: row.jenis == null ? '' : String(row.jenis),
    status: row.status == null ? '' : String(row.status),
    cadangan: /-?C\d+$|C\d+$/.test(idsub) ? 1 : 0,
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
