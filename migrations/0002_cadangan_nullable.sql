-- Kolom cadangan boleh NULL. Flag kosong berarti pembaca memakai jenis.
-- SQLite tidak bisa mengubah batasan kolom, jadi tabel disalin lalu diganti.
CREATE TABLE sheet_row_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet TEXT NOT NULL,
  kab TEXT NOT NULL DEFAULT '',
  row_key TEXT NOT NULL DEFAULT '',
  jenis TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  cadangan INTEGER,
  hasil TEXT NOT NULL DEFAULT '',
  petak TEXT NOT NULL DEFAULT '',
  pemanen TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL
);

INSERT INTO sheet_row_new (id, sheet, kab, row_key, jenis, status, cadangan, hasil, petak, pemanen, data)
SELECT id, sheet, kab, row_key, jenis, status, cadangan, hasil, petak, pemanen, data
FROM sheet_row;

DROP TABLE sheet_row;

ALTER TABLE sheet_row_new RENAME TO sheet_row;

CREATE INDEX idx_sheet_kab ON sheet_row (sheet, kab);
CREATE INDEX idx_sheet_key ON sheet_row (sheet, row_key);
CREATE INDEX idx_sheet_status ON sheet_row (sheet, status, cadangan);

INSERT INTO sqlite_sequence (name, seq)
SELECT 'sheet_row', COALESCE((SELECT MAX(id) FROM sheet_row), 0)
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'sheet_row');

UPDATE sqlite_sequence
SET seq = COALESCE((SELECT MAX(id) FROM sheet_row), 0)
WHERE name = 'sheet_row'
  AND seq < COALESCE((SELECT MAX(id) FROM sheet_row), 0);
