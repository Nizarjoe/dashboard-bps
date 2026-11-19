function waktuRank(value) {
  const t = Date.parse(String(value || ''));
  return Number.isNaN(t) ? 0 : t;
}

// Baris datar {jenis,id,slot,waktu} menjadi daftar slot terbaru per sampel.
export function latestFotoIndex(rows) {
  const best = new Map();
  for (const row of rows || []) {
    if (!row || !row.jenis || row.id == null || !row.slot) continue;
    const key = String(row.jenis) + '\n' + String(row.id) + '\n' + String(row.slot);
    const prev = best.get(key);
    if (!prev || waktuRank(row.waktu) >= waktuRank(prev.waktu)) best.set(key, row);
  }
  const grouped = new Map();
  for (const row of best.values()) {
    const key = String(row.jenis) + ':' + String(row.id);
    const list = grouped.get(key) || [];
    list.push({
      slot: String(row.slot),
      waktu: String(row.waktu || ''),
      mime: row.mime || '',
      oleh: row.oleh || '',
    });
    grouped.set(key, list);
  }
  return grouped;
}

export function indexFotoPayload(payload) {
  if (!Array.isArray(payload) || !payload.length) return new Map();
  if (payload[0] && Array.isArray(payload[0].slots)) {
    const grouped = new Map();
    for (const row of payload) {
      if (!row || !row.jenis || row.id == null) continue;
      grouped.set(String(row.jenis) + ':' + String(row.id), (row.slots || []).map(slot => ({
        slot: String(slot.slot || ''),
        waktu: String(slot.waktu || ''),
        mime: slot.mime || '',
        oleh: slot.oleh || '',
      })).filter(slot => slot.slot));
    }
    return grouped;
  }
  return latestFotoIndex(payload);
}

export function uploadsFor(index, jenis, id) {
  return (index && index.get(String(jenis) + ':' + String(id))) || [];
}
