-- LFH-758: Lese-Audit je Abruf einer Datei an einer Unfallhilfsstelle (Spec `uhs-anhaenge`).
-- Fotos und Listen einer Behandlungsstelle können Patienten zeigen; das UHS-Modul führt
-- Patienten sonst nur über Kennungen und hatte deshalb kein Lese-Audit. Jeder zugelassene
-- Download einer UHS-Datei schreibt VOR der Antwort genau eine Zeile (auch bei 304); scheitert
-- sie, wird nichts ausgeliefert. Einsicht nur für die Einsatzleitung.
--
-- APPEND-ONLY: das Repo (`anhang::audit_repo`) bietet bewusst kein UPDATE/DELETE.
--
-- Modulneutral (nicht `uhs_anhang_zugriff`): die Zeile verweist auf die Datei, nicht auf den
-- Linker, und hält in `ablage` den lesbaren Ort beim Abruf („UHS BHP 50“). So bleibt das
-- Protokoll nach der Schwärzung lesbar, wenn Linker und Datei gelöscht sind.
--
-- anhang_id BEWUSST OHNE FREMDSCHLÜSSEL:
--  * ein FK auf `anhang` machte die Tabelle für den Guard
--    `jeder_fremdschluessel_auf_anhang_ist_registriert` zu einem Linker — das ist sie nicht;
--  * die Schwärzung löscht `anhang`, das Protokoll bleibt: CASCADE nähme es mit, RESTRICT
--    ließe die Schwärzung scheitern.
-- Die id kann während der Lebenszeit der Zeile nicht neu vergeben werden: eine UHS-Datei wird
-- vor der Schwärzung nie hart gelöscht (Soft-Delete, generischer DELETE 422, Sweep hält sie);
-- danach trennt `einsatz_id` die Einsätze. Der Wert stammt aus dem Linker-Lookup derselben
-- Anfrage.
--
-- Getrennt von `person_zugriff_audit` (0021/0132): dort plant LFH-757 einen CHECK-Rebuild, und
-- an der UHS gibt es keine person_id.
CREATE TABLE anhang_zugriff_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    anhang_id   INTEGER NOT NULL,
    ablage      TEXT    NOT NULL,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    fassung     TEXT    NOT NULL CHECK (fassung IN ('bereinigt','original')),
    zugriff_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_anhang_zugriff_audit_anhang ON anhang_zugriff_audit (einsatz_id, anhang_id);
