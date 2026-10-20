-- LLH-1034: Evakuierungsbezirke werden das eigene Modul `evakuierung`, getrennt von den
-- Betreuungsstellen (`betreuung`). Bisher galt für beide eine Vorgabe; ein neuer Modulschlüssel
-- startet ohne Vorgabe und wäre damit für alle frei und sichtbar. Damit niemand durch die Trennung
-- mehr sieht oder darf als vorher, übernimmt `evakuierung` jede bestehende Vorgabe von
-- `betreuung` vollständig: die Rollenschranke UND die Sichtbarkeit (wer die Betreuung ausgeblendet
-- hatte, hatte auch die Bezirke ausgeblendet). Danach lassen sich beide Module getrennt einstellen.
-- `OR IGNORE`: eine vorhandene Zeile für `evakuierung` (gibt es vor dieser Migration nicht) bleibt.

INSERT OR IGNORE INTO einsatz_modul_override
    (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von)
SELECT einsatz_id, 'evakuierung', sichtbar, benoetigte_rolle, geaendert_at, geaendert_von
FROM einsatz_modul_override
WHERE modul_key = 'betreuung';

INSERT OR IGNORE INTO org_modul_einstellung
    (org_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von)
SELECT org_id, 'evakuierung', sichtbar, benoetigte_rolle, geaendert_at, geaendert_von
FROM org_modul_einstellung
WHERE modul_key = 'betreuung';
