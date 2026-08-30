-- Benutzer-Präferenzen (LFH-391 · Etappe D) — Schlüssel/Wert je Benutzer.
--
-- BEWUSST KEINE Spalte je Präferenz: der erste Konsument ist das Gedächtnis der
-- Kommandopalette ("zuletzt ausgeführte Befehls-IDs"), und eine eigene Spalte dafür
-- hätte jede weitere Präferenz wieder zu einer Migration gemacht. Der Schlüsselraum ist
-- deshalb offen; welche Schlüssel gültig sind, entscheidet eine Whitelist in Rust
-- (src/benutzer_einstellungen/mod.rs) — eine neue Präferenz kostet dort eine Zeile.
--
-- `wert` ist ein OPAKER Text. Was darin steht (hier ein JSON-Array), weiß nur der
-- Besitzer des Schlüssels; dieselbe Arbeitsteilung wie `einsatz_einstellungen`
-- (`fachebenen_sichtbar TEXT, -- JSON {...}`). Die Länge begrenzt Rust, nicht die DB.
--
-- Kein `org_id`: die Organisation hängt am Benutzer (`benutzer.org_id`) und wird nicht
-- zweimal geführt (F05/LFH-232 — die Org leitet sich aus dem handelnden Benutzer ab).
-- Ein zweiter Träger derselben Angabe könnte auseinanderlaufen.
--
-- ON DELETE CASCADE: eine Präferenz ohne Benutzer hat keinen Leser mehr; sie stehen zu
-- lassen hieße, sie beim nächsten Benutzer mit derselben Id an eine fremde Person
-- auszuliefern.
--
-- Keine CHECK-Constraints (Validierung in Rust) — wie bei `einsatz_einstellungen` und
-- `org_einstellungen`, wegen des sqlx-sqlite-0.8.6-Rebuild-Limits.
CREATE TABLE benutzer_einstellungen (
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    schluessel   TEXT    NOT NULL,
    wert         TEXT    NOT NULL,
    geaendert_at TEXT    NOT NULL,
    PRIMARY KEY (benutzer_id, schluessel)
);
