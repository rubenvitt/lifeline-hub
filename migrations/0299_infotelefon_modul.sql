-- i6k6mzed: Das Informationstelefon wird das eigene Modul `infotelefon`; das Modul `stab` entfällt
-- (Herleitung openspec/changes/i6k6mzed-stab-herausnehmen/design.md, D3 und D4, Muster 0224).
-- Ein neuer Modulschlüssel startet ohne Vorgabe und wäre damit für alle frei und sichtbar. Damit
-- niemand durch die Trennung mehr sieht oder darf als vorher, übernimmt `infotelefon` jede
-- bestehende Vorgabe von `stab` vollständig: die Rollenschranke UND die Sichtbarkeit (wer den Stab
-- ausgeblendet hatte, hatte auch das Informationstelefon ausgeblendet). Dasselbe gilt für die
-- Ausblendungen der Einsatz-Vorlagen (0238). `OR IGNORE`: eine vorhandene Zeile für `infotelefon`
-- (gibt es vor dieser Migration nicht) bleibt.

INSERT OR IGNORE INTO einsatz_modul_override
    (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von)
SELECT einsatz_id, 'infotelefon', sichtbar, benoetigte_rolle, geaendert_at, geaendert_von
FROM einsatz_modul_override
WHERE modul_key = 'stab';

INSERT OR IGNORE INTO org_modul_einstellung
    (org_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von)
SELECT org_id, 'infotelefon', sichtbar, benoetigte_rolle, geaendert_at, geaendert_von
FROM org_modul_einstellung
WHERE modul_key = 'stab';

INSERT OR IGNORE INTO einsatz_vorlage_modul_aus (vorlage_id, modul_key)
SELECT vorlage_id, 'infotelefon'
FROM einsatz_vorlage_modul_aus
WHERE modul_key = 'stab';

-- Danach gibt es keine Vorgabe für `stab` mehr. In derselben Migration, damit nie ein Schlüssel
-- übrig bleibt, den die Registry nicht mehr kennt: eine Vorlage mit `stab` ließe sich sonst nicht
-- mehr speichern (`normalize_ausgeblendet`, 400).
DELETE FROM einsatz_modul_override WHERE modul_key = 'stab';
DELETE FROM org_modul_einstellung WHERE modul_key = 'stab';
DELETE FROM einsatz_vorlage_modul_aus WHERE modul_key = 'stab';
