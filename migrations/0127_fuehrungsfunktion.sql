-- LFH-549: Funktionskatalog für Führungsfunktionen (FwDV 100 Anlage 1/2).
-- Herleitung: openspec/changes/archive/2026-09-30-lfh-549-funktionskatalog/design.md (D1–D3).
--
-- Drei Freitext-Funktionsfelder bekommen in EINEM Zug eine Codespalte neben den Bestandstext
-- (keine halbe Migration, Stab-Spec LFH-46 Entscheidung 14). Die Codeliste ist
-- `fuehrung::Fuehrungsfunktion::ALLE`; der Guard `check_listen_entsprechen_dem_katalog` hält die
-- vier CHECK-Listen unten gegen sie.
--
-- DOPPELROLLE DES TEXTES (je Tabelle gleich):
--   Code NULL                          → der Text ist Freitext (Fallback, wie bisher);
--   Code fuehrungshilfspersonal/fachberater → der Text ist die Pflicht-Bezeichnung („THW“);
--   jeder andere Code                  → der Text ist NULL.
-- Geprüft in Rust (`fuehrung::pruefe_funktion`), nicht per Mehrspalten-CHECK.
--
-- KEIN BACKFILL: Bestandswerte bleiben Freitext. Ein Rückschluss „S3“ → s3 wäre eine Heuristik
-- über Freitext, die die Anforderung verbietet.
--
-- Schwärzung: die Codespalten tragen keinen Personenbezug (Retain G_ENUM); die Textspalten
-- behalten ihre Klasse (erinnerung/fuehrungsstelle Scrub, auftrag_empfaenger Retain).

ALTER TABLE erinnerung ADD COLUMN empfaenger_funktion_code TEXT
    CHECK (empfaenger_funktion_code IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                        'fuehrungshilfspersonal','fachberater'));

ALTER TABLE auftrag_empfaenger ADD COLUMN funktion TEXT
    CHECK (funktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                        'fuehrungshilfspersonal','fachberater'));

ALTER TABLE einsatz_mitgliedschaft ADD COLUMN fuehrungsfunktion TEXT
    CHECK (fuehrungsfunktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                 'fuehrungshilfspersonal','fachberater'));

-- Mandantenlabels und S7-Schalter je Organisation. Den Katalog selbst pflegt niemand.
--   label NULL = Standardlabel aus dem Code;
--   aktiv nur für s7 (Rust lehnt es an jedem anderen Code mit 422 ab); fehlt die Zeile oder ist
--   aktiv NULL, ist S7 aus.
-- Stammdaten der Organisation, nicht einsatzbezogen: nicht in der Schwärzungs-Registry.
CREATE TABLE org_fuehrungsfunktion (
    org_id        INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    funktion      TEXT    NOT NULL
        CHECK (funktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                            'fuehrungshilfspersonal','fachberater')),
    label         TEXT,
    aktiv         INTEGER CHECK (aktiv IN (0, 1)),
    geaendert_at  TEXT,
    geaendert_von INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (org_id, funktion)
);
