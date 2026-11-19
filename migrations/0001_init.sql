-- Skema SINTA PADI. Baris sheet disimpan sebagai JSON plus kolom untuk filter.
CREATE TABLE users (
  kode TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  nama TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE target (
  kode TEXT NOT NULL,
  jenis TEXT NOT NULL,
  t INTEGER NOT NULL DEFAULT 0,
  r INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kode, jenis)
);

CREATE TABLE sheet_row (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet TEXT NOT NULL,
  kab TEXT NOT NULL DEFAULT '',
  row_key TEXT NOT NULL DEFAULT '',
  jenis TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  cadangan INTEGER NOT NULL DEFAULT 0,
  hasil TEXT NOT NULL DEFAULT '',
  petak TEXT NOT NULL DEFAULT '',
  pemanen TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL
);

CREATE INDEX idx_sheet_kab ON sheet_row (sheet, kab);
CREATE INDEX idx_sheet_key ON sheet_row (sheet, row_key);
CREATE INDEX idx_sheet_status ON sheet_row (sheet, status, cadangan);

CREATE TABLE upload (
  key TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kode TEXT NOT NULL,
  backend TEXT NOT NULL,
  dibuat INTEGER NOT NULL
);
