-- LFH-758: Fotos und Dateien an einem Tier (Foto eines herrenlosen Tieres, Übergabe ans
-- Tierheim). Die Bytes liegen in `anhang` (BLOB, AV-Scan, ETag, Backup); diese Tabelle ist ein
-- modulgebundener Linker darauf, gebaut nach `0126_einsatz_schaden_anhang.sql`. 1:1
-- (anhang_id UNIQUE): eine Datei gehört genau einem Tier.
--
-- REGISTEREINTRAG PFLICHT: die Tabelle steht in `anhang::repo::MODUL_LINKER` und ihr
-- Deskriptor in `anhang::erfassung::ERFASSUNGS_ABLAGEN`. Ohne den Registereintrag gälte eine
-- Tier-Datei als „ungebunden": der Sweep löschte sie nach 24 h, und die ablegende Person
-- könnte sie über die generische Route laden und hart löschen. Der Guard
-- `jeder_fremdschluessel_auf_anhang_ist_registriert` macht das rot.
--
-- anhang_id ON DELETE CASCADE: die DSGVO-Schwärzung löscht `anhang` per ZeileLoeschen — mit
-- RESTRICT schlüge sie fehl. Der generische DELETE /anhaenge/{aid} verweigert gebundene
-- Anhänge (422). tier_id ON DELETE CASCADE: Tiere werden nur storniert; hart verschwinden sie
-- allein mit dem Einsatz.
--
-- Soft-Delete am Linker (geloescht_at/geloescht_von_id): die Datei verschwindet aus der Liste,
-- bleibt aber bis zur Schwärzung gespeichert. Kein Lese-Audit (wie Tiere insgesamt, 0031).
-- Gleicher Einsatz für Tier, Linker und Anhang gilt durch Bau (alle drei Werte stammen in
-- einer Transaktion aus dem Einsatz der Adresse); ein Repo-Test pinnt das.
CREATE TABLE einsatz_tier_anhang (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    tier_id          INTEGER NOT NULL REFERENCES einsatz_tier(id) ON DELETE CASCADE,
    anhang_id        INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    abgelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at     TEXT,
    geloescht_von_id INTEGER REFERENCES benutzer(id),
    CHECK ((geloescht_at IS NULL) = (geloescht_von_id IS NULL))
);
CREATE INDEX idx_einsatz_tier_anhang_tier
    ON einsatz_tier_anhang(tier_id, abgelegt_at);
