-- Mitgliedschaft = exklusiv (max. 1 Einheit je Kraft) über eine FK-Spalte direkt an
-- den Dispozeilen. NULL = freie, nicht zugeordnete Kraft. Kein ON DELETE (SQLite-Grenze
-- bei nachträglichem ADD COLUMN): das Freigeben beim Auflösen passiert explizit in einer
-- Repo-Transaktion.
ALTER TABLE einsatz_personal ADD COLUMN einheit_id INTEGER REFERENCES einsatz_einheit(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN einheit_id INTEGER REFERENCES einsatz_einheit(id);
