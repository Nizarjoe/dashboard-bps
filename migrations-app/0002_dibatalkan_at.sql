-- Waktu pembatalan terpisah dari waktu tutup. ditutup_at hanya untuk status ditutup.
ALTER TABLE koreksi ADD COLUMN dibatalkan_at TEXT;

UPDATE koreksi
   SET dibatalkan_at = ditutup_at, ditutup_at = NULL
 WHERE status = 'dibatalkan'
   AND ditutup_at IS NOT NULL
   AND dibatalkan_at IS NULL;
