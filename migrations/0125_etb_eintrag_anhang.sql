-- LFH-117: Anhänge an ETB-Einträgen. Die Bytes liegen in `anhang` (BLOB, AV-Scan, ETag,
-- Backup); diese Tabelle ist der DRITTE Linker auf `anhang` neben `chat_nachricht_anhang`
-- (0052) und `einsatz_dokument` (0116). Ein Eintrag trägt n Dateien, eine Datei gehört
-- höchstens EINEM Eintrag (anhang_id UNIQUE) — „eine Datei, ein Lebenszyklus" ist damit eine
-- Datenbankaussage. Der Handler meldet den Fall vorher mit 422, die UNIQUE-Verletzung ist nur
-- das Netz.
--
-- Beide FKs ON DELETE CASCADE:
--   * anhang_id: die DSGVO-Schwärzung löscht `anhang` per ZeileLoeschen — mit RESTRICT schlüge
--     sie fehl. Der generische DELETE /anhaenge/{aid} verweigert ETB-gebundene Anhänge (422,
--     plus NOT-EXISTS-Riegel in `anhang::repo::loeschen`), die CASCADE reißt also nur bei der
--     Schwärzung etwas mit — und genau dort soll die Verknüpfung gehen, der Eintrag bleibt.
--   * eintrag_id: die Einsatz-Löschung räumt über `etb_eintrag` ab. Nur so liegt die Tabelle
--     in der CASCADE-Hülle, über die der Schwärzungs-Guard sie findet (LFH-291).
--
-- Kein eigener Index auf eintrag_id: der Primärschlüssel deckt ihn als Präfix ab, das
-- gebündelte Nachladen je Seite (`etb::repo::anhaenge_nachladen`) läuft darüber.
CREATE TABLE etb_eintrag_anhang (
    eintrag_id INTEGER NOT NULL REFERENCES etb_eintrag(id) ON DELETE CASCADE,
    anhang_id  INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    PRIMARY KEY (eintrag_id, anhang_id)
);
