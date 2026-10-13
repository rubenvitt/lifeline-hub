-- LLH-1180: Funkplan, Fernmeldeskizze und Kommunikationsplan werden das eigene Modul
-- `fernmeldewesen`, unabhängig vom Stab. Ein neuer Modulschlüssel startet ohne Vorgabe, wäre also
-- für alle frei. Wer den Stab heute auf eine Rolle beschränkt, beschränkt damit auch die
-- S6-Werkzeuge — diese Grenze wandert mit (keine Sperre wird weicher). Eine Ausblendung
-- (`sichtbar = 0`) wandert NICHT: wer den Stab ausgeblendet hat, bekommt das Fernmeldewesen
-- zurück, genau das ist der Zweck der Change.
-- Herleitung: openspec/changes/archive/2026-10-13-nrptfg8r-fernmeldewesen-modul/design.md (D4),
-- openspec/changes/archive/2026-10-12-wgnb0am2-stab-abwaehlbar/design.md (D7).

INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at)
SELECT einsatz_id, 'fernmeldewesen', 1, benoetigte_rolle, datetime('now')
FROM einsatz_modul_override
WHERE modul_key = 'stab' AND benoetigte_rolle IS NOT NULL;

INSERT INTO org_modul_einstellung (org_id, modul_key, benoetigte_rolle, geaendert_at)
SELECT org_id, 'fernmeldewesen', benoetigte_rolle, datetime('now')
FROM org_modul_einstellung
WHERE modul_key = 'stab' AND benoetigte_rolle IS NOT NULL;
