-- LFH-21: Fotos und Dateien an einem Schaden. Die Bytes liegen in `anhang` (BLOB, AV-Scan,
-- ETag, Backup); diese Tabelle ist der VIERTE Linker auf `anhang` neben Chat
-- (`chat_nachricht_anhang`), Dokumentenablage (`einsatz_dokument`) und ETB
-- (`etb_eintrag_anhang`). 1:1 (anhang_id UNIQUE): eine Datei gehört genau einem Schaden —
-- ein Lebenszyklus, ein Rechtemodell.
--
-- REGISTEREINTRAG PFLICHT: die Tabelle steht in `anhang::repo::MODUL_LINKER`. Ohne den
-- Eintrag gälte eine Schaden-Datei als „ungebunden": der Sweep löschte sie nach 24 h, und
-- die ablegende Person könnte sie über die generische Route laden und hart löschen. Der
-- Guard `jeder_fremdschluessel_auf_anhang_ist_registriert` macht das rot.
--
-- anhang_id ON DELETE CASCADE: die DSGVO-Schwärzung löscht `anhang` per ZeileLoeschen — mit
-- RESTRICT schlüge sie fehl. Der generische DELETE /anhaenge/{aid} verweigert gebundene
-- Anhänge (422), deshalb reißt die CASCADE nichts ungewollt mit.
-- schaden_id ON DELETE CASCADE: Schäden werden nur storniert; hart verschwinden sie allein
-- mit dem Einsatz.
--
-- Soft-Delete am Linker (geloescht_at/geloescht_von_id), weil `anhang` keinen hat: die Datei
-- verschwindet aus der Liste, bleibt aber als Beweis bis zur Schwärzung. Das Paar-CHECK
-- verhindert halb gesetzte Löschmarken.
--
-- Gleicher Einsatz für Schaden, Linker und Anhang ist über Tabellen hinweg nicht prüfbar;
-- er gilt durch Bau (alle drei Werte stammen in einer Transaktion aus dem Einsatz der
-- Adresse, der Schaden wird mit `AND einsatz_id = ?` geladen). Ein Repo-Test pinnt das.
CREATE TABLE einsatz_schaden_anhang (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    schaden_id       INTEGER NOT NULL REFERENCES einsatz_schaden(id) ON DELETE CASCADE,
    anhang_id        INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    abgelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at     TEXT,
    geloescht_von_id INTEGER REFERENCES benutzer(id),
    CHECK ((geloescht_at IS NULL) = (geloescht_von_id IS NULL))
);
CREATE INDEX idx_einsatz_schaden_anhang_schaden
    ON einsatz_schaden_anhang(schaden_id, abgelegt_at);
