-- LLH-1214: Meldung an meine Funktion (Change kcjecn9e-benachrichtigungskonzept, design.md D8).
--
-- Eine Meldung trägt neben dem freien Empfängertext (`empfaenger`, bleibt unverändert) eine
-- Empfängerfunktion aus dem Katalog `fuehrung::Fuehrungsfunktion`. Wird eine Meldung mit ihr
-- erfasst, meldet der Server `meldung` an die Nutzer dieser Funktion
-- (`benachrichtigung::melden`). Kein Rückschluss vom Freitext auf einen Code, kein Backfill.
--
-- Die CHECK-Liste spiegelt `Fuehrungsfunktion::ALLE` (Guard
-- `check_listen_entsprechen_dem_katalog`). Welche Codes eine Meldung annimmt (nur Leitung und
-- Sachgebiete, S7 nur mit Org-Schalter), prüft Rust in `routes::meldung`.
--
-- Schwärzung: Katalogcode ohne Personenbezug, Retain (G_ENUM) wie
-- `erinnerung.empfaenger_funktion_code`; der Freitext `empfaenger` bleibt Scrub.
ALTER TABLE meldung ADD COLUMN empfaenger_funktion TEXT
    CHECK (empfaenger_funktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                   'fuehrungshilfspersonal','fachberater'));
