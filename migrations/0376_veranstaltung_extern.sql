-- Veranstaltungen aus einer Fremdanwendung (LLH-2097, Design-Doc
-- docs/superpowers/specs/2026-11-25-w36lkuqp-veranstaltungen-abruf-design.md): geplante Dienste,
-- die ein Adapter der Art `veranstaltungen_abruf` über den Vertrag „Veranstaltungen-Abruf v1“
-- abruft. Je Adapter eine Zeile je Veranstaltung mit ihrem letzten Stand; ein unveränderter Abruf
-- schreibt nichts. `art` und `status` sind Codes aus `veranstaltung_extern::vertrag`; `entfernt`
-- setzt nur Lifeline, wenn eine Veranstaltung aus der Lieferung fällt, ohne abgesagt zu sein.
-- `fingerabdruck` ist SHA-256 über den Inhalt ohne den Änderungszeitpunkt der Quelle.
-- Zeitpunkte UTC im Format von `zeit::FORMAT`. Keine Personendaten: `veranstalter` ist eine
-- Stelle. Gelöscht 14 Tage nach `ende_at` (Purge-Lauf, Phase C) oder mit dem Adapter.
CREATE TABLE veranstaltung_extern (
    org_id        INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    adapter_id    TEXT    NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
    extern_id     TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    art           TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    ort           TEXT    NOT NULL DEFAULT '',
    veranstalter  TEXT    NOT NULL DEFAULT '',
    bemerkung     TEXT    NOT NULL DEFAULT '',
    beginn_at     TEXT    NOT NULL,
    ende_at       TEXT    NOT NULL,
    fingerabdruck TEXT    NOT NULL,
    erhalten_at   TEXT    NOT NULL,
    geaendert_at  TEXT    NOT NULL,
    PRIMARY KEY (adapter_id, extern_id)
);
CREATE INDEX idx_veranstaltung_extern_ende ON veranstaltung_extern (ende_at);
CREATE INDEX idx_veranstaltung_extern_org ON veranstaltung_extern (org_id);
