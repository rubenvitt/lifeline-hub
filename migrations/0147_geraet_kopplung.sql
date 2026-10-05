-- LFH-892: Gerätekopplung. Ein ausgegebenes Gerät (UHS-Tablet, UHS-Laptop, Lagemonitor) arbeitet
-- ohne Personenkonto in genau einem Einsatz, einer Funktionsansicht und ggf. einer UHS.
-- Herleitung: openspec/changes/archive/2026-10-05-lfh-892-funktionsansichten-geraete/design.md (D1, D3).
--
-- Jede Kopplung bekommt ein eigenes Gerätekonto in `benutzer` (benutzer_id UNIQUE), damit alle
-- Urheberspalten (erfasser_id, erfasst_von, …) unverändert weiterlaufen. Die Ansicht ist ein
-- Wire-Wert des Enums `geraet::Funktionsansicht` (Guard: tests/enum_wire_kontrakt.rs).
CREATE TABLE geraet_kopplung (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id        INTEGER NOT NULL UNIQUE REFERENCES benutzer(id),
    ansicht            TEXT    NOT NULL CHECK (ansicht IN ('uhs-tablet', 'uhs-laptop', 'lagemonitor')),
    -- Stelle der stellengebundenen Ansichten; die Bindung prüft der Code (uhs-* ⇒ gesetzt).
    uhs_id             INTEGER REFERENCES uhs(id),
    bezeichnung        TEXT    NOT NULL,             -- „Tablet 1“, ≤ 60 Zeichen
    erstellt_von       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    laeuft_ab_at       TEXT    NOT NULL,
    gekoppelt_at       TEXT,                         -- letzte Einlösung eines Codes
    letzter_zugriff_at TEXT,                         -- höchstens minütlich fortgeschrieben
    widerrufen_at      TEXT,
    widerrufen_von     INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_geraet_kopplung_einsatz ON geraet_kopplung (einsatz_id);

-- Höchstens ein Code je Kopplung: ein neu ausgestellter ersetzt den alten (Upsert auf dem
-- Primärschlüssel). In der DB steht nur der SHA-256 des Codes, wie beim Sitzungstoken.
CREATE TABLE geraet_kopplungscode (
    kopplung_id   INTEGER PRIMARY KEY REFERENCES geraet_kopplung(id) ON DELETE CASCADE,
    code_hash     TEXT    NOT NULL UNIQUE,
    laeuft_ab_at  TEXT    NOT NULL,
    eingeloest_at TEXT
);

-- Ereignisspur der Kopplung (append-only): wer hat wann angelegt, Code ausgestellt, verlängert,
-- widerrufen; wann wurde von welcher IP eingelöst. Die Einlösung steht zusätzlich in auth_audit
-- (Anmeldeweg 'geraetecode').
CREATE TABLE geraet_kopplung_ereignis (
    id          INTEGER PRIMARY KEY,
    kopplung_id INTEGER NOT NULL REFERENCES geraet_kopplung(id) ON DELETE CASCADE,
    ereignis    TEXT    NOT NULL CHECK (ereignis IN ('angelegt', 'code_ausgestellt', 'eingeloest',
                                                     'verlaengert', 'widerrufen')),
    von         INTEGER REFERENCES benutzer(id),      -- handelnde Person; NULL beim Einlösen
    peer_ip     TEXT,
    zeitpunkt   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_geraet_kopplung_ereignis ON geraet_kopplung_ereignis (kopplung_id, zeitpunkt);

-- Gerätesitzung: eine normale Sitzung mit Verweis auf ihre Kopplung. NULL = Personensitzung.
ALTER TABLE session ADD COLUMN kopplung_id INTEGER REFERENCES geraet_kopplung(id) ON DELETE CASCADE;
CREATE INDEX idx_session_kopplung ON session (kopplung_id);
