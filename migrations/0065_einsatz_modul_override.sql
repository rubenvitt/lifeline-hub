-- Einsatz-Modul-Override (LFH-132) — Leaf-Tabelle, je (Einsatz, Modul) eine Zeile.
-- Macht Modul-Sichtbarkeit (sichtbar) und die benötigte Rolle (benoetigte_rolle)
-- pro Einsatz überschreibbar. KEINE CHECK-Constraints — die gültigen Modul-Keys und
-- Rollenwerte werden in Rust validiert (src/einsatz/modul.rs), spiegelbildlich zur
-- Frontend-modulRegistry. Org-Isolation läuft strikt über die einsatz_id (ON DELETE
-- CASCADE bindet die Overrides an den Einsatz, nie an die Benutzer-Org).
CREATE TABLE einsatz_modul_override (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Modul-Key aus der Registry (z. B. 'etb', 'chat'); in Rust validiert.
    modul_key       TEXT    NOT NULL,
    -- 1 = sichtbar (Default), 0 = ausgeblendet. Nicht-ausblendbare Module ignoriert der Guard.
    sichtbar        INTEGER NOT NULL DEFAULT 1,
    -- Benötigte System-/Org-Rolle: 'admin' | 'fuehrungskraft'; NULL = frei (für alle).
    benoetigte_rolle TEXT,
    geaendert_at    TEXT,
    geaendert_von   INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (einsatz_id, modul_key)
);
