-- Database aplikasi (binding APPDB). TERPISAH dari D1 `DB` lama (a5eb0932).
-- Isi: koreksi PML -> mitra, jejak audit, dan penanda hapus foto (soft delete).
-- Terapkan HANYA ke database yang dipasang sebagai APPDB.

CREATE TABLE IF NOT EXISTS koreksi (
  id TEXT PRIMARY KEY,
  tipe TEXT NOT NULL CHECK (tipe IN ('sampel', 'monitoring')),
  jenis TEXT,                    -- sampel: pengeringan|penggilingan
  sampel_id TEXT,                -- sampel: id sampel SKGB
  tab_id TEXT,                   -- monitoring: id katalog
  baris TEXT,                    -- monitoring: kunci baris (mis. kode identitas)
  bagian TEXT NOT NULL DEFAULT '',
  catatan TEXT NOT NULL,
  mitra_id TEXT NOT NULL,
  pml_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('terkirim', 'dibaca', 'ditanggapi', 'diperbaiki', 'ditutup', 'dibatalkan')),
  tanggapan TEXT NOT NULL DEFAULT '',
  versi INTEGER NOT NULL DEFAULT 1,
  dibuat TEXT NOT NULL,
  diubah TEXT NOT NULL,
  dibaca_at TEXT,
  ditanggapi_at TEXT,
  ditutup_at TEXT,
  dihapus INTEGER NOT NULL DEFAULT 0,
  dihapus_at TEXT,
  dihapus_oleh TEXT
);

CREATE INDEX IF NOT EXISTS idx_koreksi_mitra ON koreksi (mitra_id, dihapus, status);
CREATE INDEX IF NOT EXISTS idx_koreksi_pml ON koreksi (pml_id, dihapus, status);
CREATE INDEX IF NOT EXISTS idx_koreksi_sampel ON koreksi (jenis, sampel_id);

CREATE TABLE IF NOT EXISTS koreksi_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  koreksi_id TEXT NOT NULL,
  waktu TEXT NOT NULL,
  oleh TEXT NOT NULL,
  peran TEXT NOT NULL,
  aksi TEXT NOT NULL,
  dari_status TEXT,
  ke_status TEXT,
  catatan TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_koreksi_log ON koreksi_log (koreksi_id, id);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu TEXT NOT NULL,
  oleh TEXT NOT NULL,
  peran TEXT NOT NULL,
  entitas TEXT NOT NULL,         -- akun | foto | isian
  entitas_id TEXT NOT NULL,
  aksi TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_entitas ON audit (entitas, entitas_id, id);

CREATE TABLE IF NOT EXISTS foto_hapus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis TEXT NOT NULL,
  sampel_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  waktu TEXT NOT NULL,           -- unggahan dengan waktu <= ini dianggap terhapus
  oleh TEXT NOT NULL,
  alasan TEXT NOT NULL DEFAULT '',
  batal_at TEXT,                 -- diisi saat admin memulihkan
  batal_oleh TEXT
);

CREATE INDEX IF NOT EXISTS idx_foto_hapus ON foto_hapus (jenis, sampel_id, slot, batal_at);
