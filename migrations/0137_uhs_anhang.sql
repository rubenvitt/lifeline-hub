-- LFH-758: Fotos, Unterlagen und der Plan (Grundriss als Datei) an einer Unfallhilfsstelle.
-- Die Bytes liegen in `anhang`; diese Tabelle ist ein modulgebundener Linker darauf, gebaut nach
-- `0126_einsatz_schaden_anhang.sql`. 1:1 (anhang_id UNIQUE): eine Datei gehört genau einer UHS.
--
-- REGISTEREINTRAG PFLICHT: die Tabelle steht in `anhang::repo::MODUL_LINKER` und ihr
-- Deskriptor in `anhang::erfassung::ERFASSUNGS_ABLAGEN`. Ohne den Registereintrag gälte eine
-- UHS-Datei als „ungebunden": der Sweep löschte sie nach 24 h, und die ablegende Person könnte
-- sie über die generische Route laden und hart löschen — am Lese-Audit vorbei. Der Guard
-- `jeder_fremdschluessel_auf_anhang_ist_registriert` macht das rot.
--
-- anhang_id ON DELETE CASCADE: die DSGVO-Schwärzung löscht `anhang` per ZeileLoeschen. uhs_id ON
-- DELETE CASCADE: eine UHS wird nur storniert; hart verschwindet sie allein mit dem Einsatz.
--
-- Soft-Delete am Linker: die Datei verschwindet aus der Liste, bleibt aber bis zur Schwärzung.
-- Jeder Abruf einer UHS-Datei steht im Lese-Audit `anhang_zugriff_audit` (0138), weil Fotos
-- und Listen einer Behandlungsstelle Patienten zeigen können. Gleicher Einsatz für UHS, Linker
-- und Anhang gilt durch Bau; ein Repo-Test pinnt das.
CREATE TABLE uhs_anhang (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    uhs_id           INTEGER NOT NULL REFERENCES uhs(id) ON DELETE CASCADE,
    anhang_id        INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    abgelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at     TEXT,
    geloescht_von_id INTEGER REFERENCES benutzer(id),
    CHECK ((geloescht_at IS NULL) = (geloescht_von_id IS NULL))
);
CREATE INDEX idx_uhs_anhang_uhs
    ON uhs_anhang(uhs_id, abgelegt_at);
