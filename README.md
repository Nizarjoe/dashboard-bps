# Dashboard Monitoring Produksi 3305 — BPS Kebumen

Reinkarnasi profesional Google Sites "Monitoring Produksi 3305" (Tim Statistik Produksi, BPS Kabupaten Kebumen) menjadi dashboard web production-ready.

## Menjalankan

```bash
node server.js        # port 8200 (env PORT untuk ubah)
```

- Dashboard: http://localhost:8200
- API: /api/login, /api/me, /api/data, /api/survei, /api/progress, /api/users, /api/upload, /api/foto/delete, /api/meta, /api/export (CSV)

## Login (ganti password di data/db.json untuk produksi)

| Role | Username | Password | Hak |
|---|---|---|---|
| Superadmin | superadmin | bps3305 | Semua + kelola pengguna |
| Admin | admin | bps3305 | Kelola survei, upload/hapus foto, aktivitas, pengaturan |
| Mitra BPS | mitra | mitra3305 | Lihat dashboard + update progres + upload foto |

## Fitur (mengikuti situs Google Sites asli)

- 3 bidang: Statistik Tanaman Pangan, INPEK, Horti/Perkebunan/Peternakan/Perikanan — 27 survei seed (KSA, Ubinan SR1-3, SKJG, SKGB, IMK, DPA/STPIM/IBSTR, Galian URT/BH, Konstruksi, SPT, SKP, Komstrat, VIP Horti, DPP DUTL)
- Progres real-time per survei (target vs selesai, persen, status Belum Mulai/Berjalan/Selesai)
- Link Google Sheet monitoring & Google Form per survei (dikelola admin, persis seperti situs lama)
- Upload foto dokumentasi survei (magic-byte validation, maks 5 MB) menggantikan Google Form upload foto
- KPI dashboard: total survei, progres keseluruhan, perlu perhatian, dokumentasi
- Log aktivitas, manajemen pengguna (superadmin), export CSV rekap, pengaturan instansi

## Teknis

Node http murni tanpa dependensi; data di `data/db.json`; upload di `uploads/`. Auth token Bearer in-memory (SESS).


## Revisi v2
- Semua laporan progres langsung di website (tanpa Google Form/Sheet) — link eksternal dihapus
- Mitra mobile-first (bottom nav + drawer); admin desktop (sidebar) & mobile sama-sama nyaman
- Upload foto per nama mitra: nama file `foto_<mitra>_<ts>_<rand>.ext`, filter galeri per mitra & program
- Dashboard progres setiap mitra di setiap program (tabel + filter + pencarian + peringkat mitra)
- Impor mitra Excel/CSV (`/api/template.xlsx` template resmi): mitra baru + penugasan otomatis terintegrasi (login, lapor, upload)
- Desain sidebar profesional mengikuti referensi (hero biru + KPI + quick actions + peringkat)
- Superadmin kelola program penuh (nama, bidang, target, satuan, tenggat, wajib foto, status)
- Verifikasi laporan oleh admin; aktivitas tercatat; bahasa Indonesia penuh
