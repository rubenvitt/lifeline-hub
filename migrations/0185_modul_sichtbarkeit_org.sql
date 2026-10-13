-- no-transaction
-- LLH-1179: Sichtbarkeits-Vorgabe der Organisation je Modul. `sichtbar` = Einsatz ?? Organisation
-- ?? sichtbar, aufgelöst zur Lesezeit (src/einsatz/effektiv.rs, `effektiv_sichtbar`). Herleitung:
-- openspec/changes/archive/2026-10-12-wgnb0am2-stab-abwaehlbar/design.md (D1, D2), Bauweise:
-- openspec/changes/archive/2026-10-13-ivtkmf43-org-modul-sichtbarkeit/design.md (D1).
--
-- Org: neue Spalte, NULL = sichtbar, 0 = ausgeblendet. Geschrieben wird nie 1.
-- Einsatz: `sichtbar` wird nullbar (NULL = erbt). Eine gespeicherte 1 wird NULL: bisher gab es
-- keine Ebene darüber, 1 hieß also dasselbe wie „erbt“. Eine 0 bleibt eine Ausblendung.
--
-- SQLite kann NOT NULL nicht lösen → Rebuild, FK-sicher nach dem Muster von 0176. Leaf-Rebuild:
-- KEIN Fremdschlüssel, Trigger, View oder Index hängt an einsatz_modul_override. Effektives Schema
-- = 0065 (sechs Spalten, PK (einsatz_id, modul_key)).

ALTER TABLE org_modul_einstellung ADD COLUMN sichtbar INTEGER;

PRAGMA foreign_keys = OFF;

CREATE TABLE einsatz_modul_override_new (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Modul-Key aus der Registry (z. B. 'etb', 'chat'); in Rust validiert.
    modul_key       TEXT    NOT NULL,
    -- NULL = erbt (Organisation ?? sichtbar), 1 = sichtbar, 0 = ausgeblendet. Nicht-ausblendbare
    -- Module ignoriert der Guard.
    sichtbar        INTEGER,
    -- Benötigte Rolle: 'admin' | 'fuehrungskraft' | 'einsatzfuehrung'; NULL = erbt bzw. frei.
    benoetigte_rolle TEXT,
    geaendert_at    TEXT,
    geaendert_von   INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (einsatz_id, modul_key)
);

INSERT INTO einsatz_modul_override_new
    (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von)
    SELECT einsatz_id, modul_key, CASE sichtbar WHEN 0 THEN 0 ELSE NULL END, benoetigte_rolle,
           geaendert_at, geaendert_von
    FROM einsatz_modul_override;

DROP TABLE einsatz_modul_override;

ALTER TABLE einsatz_modul_override_new RENAME TO einsatz_modul_override;

PRAGMA foreign_keys = ON;
