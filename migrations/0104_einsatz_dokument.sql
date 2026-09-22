-- LFH-632: Dokumentenablage je Einsatz. Die Bytes liegen in `anhang` (BLOB, AV-Scan,
-- ETag, Backup); diese Tabelle ist der ZWEITE Linker auf `anhang` neben
-- `chat_nachricht_anhang`. 1:1 (anhang_id UNIQUE): ein Dokument, eine Datei.
--
-- anhang_id ON DELETE CASCADE: die DSGVO-Schwärzung löscht `anhang` per ZeileLoeschen —
-- mit RESTRICT schlüge sie fehl. Der generische DELETE /anhaenge/{aid} verweigert
-- dokument-gebundene Anhänge (422), deshalb reißt die CASCADE nichts ungewollt mit.
--
-- Bezug: höchstens EINES von Abschnitt/Einheit/ETB-Eintrag. Abschnitt und Einheit werden
-- hart gelöscht → ON DELETE SET NULL (sonst blockiert der FK deren Löschen, LFH-237).
-- Die Einsatzzugehörigkeit des Ziels prüft der Handler; die FKs sichern sie nicht.
--
-- Soft-Delete (geloescht_at): Beweissicherung, die Datei bleibt bis zum Einsatz-Purge.
CREATE TABLE einsatz_dokument (
    id                   INTEGER PRIMARY KEY,
    einsatz_id           INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    anhang_id            INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    kategorie            TEXT    NOT NULL
        CHECK (kategorie IN ('lagekarte_plan','befehl','formular','foto','sonstiges')),
    titel                TEXT    NOT NULL,
    bezug_abschnitt_id   INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    bezug_einheit_id     INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    bezug_etb_eintrag_id INTEGER REFERENCES etb_eintrag(id),
    etb_eintrag_id       INTEGER NOT NULL REFERENCES etb_eintrag(id),
    abgelegt_von_id      INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at         TEXT,
    geloescht_von_id     INTEGER REFERENCES benutzer(id),
    CHECK ((bezug_abschnitt_id IS NOT NULL)
         + (bezug_einheit_id IS NOT NULL)
         + (bezug_etb_eintrag_id IS NOT NULL) <= 1)
);
CREATE INDEX idx_einsatz_dokument_einsatz ON einsatz_dokument(einsatz_id, abgelegt_at);
