# Proposal

## Why

Die PII-Schwärzung (`schwaerze_einsatz`) setzt Platzhalter, leert Spalten und löscht Zeilen,
etwa die Anhang-BLOBs. Physisch bleiben die alten Bytes trotzdem in der Datenbankdatei stehen,
in Freeblocks und auf Freelist-Seiten, und bis zum nächsten Checkpoint auch in den WAL-Frames.
Der Grund: `db::connect` setzt kein `PRAGMA secure_delete`. Mit einem Hex-Editor lassen sich
die Daten also wiederherstellen, obwohl der ETB-Audit bescheinigt, sie seien „unwiderruflich
entfernt“. Betroffen sind alle Scrub-Spalten und `ZeileLoeschen`. Das ist ein DSGVO-Befund
(Art. 17) aus dem Review von Welle A (Epic LFH-60, LFH-290), erfasst als LFH-725.

## What Changes

- Jede Verbindung des Produktions-Pools läuft mit `secure_delete = ON`. Die Wahl gegen `FAST`
  stützt eine Probe: Unter `FAST` bleiben die Overflow-Seiten eines gelöschten Anhang-BLOBs
  ungenullt auf der Freelist.
- Nach einer erfolgreichen Schwärzung schreibt das System den WAL per
  `wal_checkpoint(TRUNCATE)` zurück und kürzt ihn. Erst damit sind die genullten Seiten in der
  Hauptdatei, und der WAL trägt keinen Vorzustand mehr. Bleibt der Checkpoint wegen aktiver
  Leser unvollständig, holt der nächste Purge-Lauf ihn nach.
- Altbestand: Datenbanken, die vor dieser Änderung geschwärzt oder sonst bereinigt wurden,
  tragen die Altbytes weiter. Ein einmaliges `VACUUM` beim Serverstart baut die Datei neu auf.
  Eine Markierung in `app_meta` sorgt dafür, dass es genau einmal läuft.
- Sicherungen: Die Betriebsdoku beschreibt, wie lange PII nach einer Schwärzung noch in
  Sicherungen liegt. Bei automatischen Sicherungen ist das höchstens Intervall × Anzahl, mit
  den Vorgaben rund 42 h. Bei Downloads und externen Kopien ist der Betreiber verantwortlich.
  Spielt jemand eine Sicherung von vor der Schwärzung zurück, schwärzt der nächste Purge-Lauf
  erneut. Ein Test belegt das.
- Ein Test belegt: Nach der Schwärzung kommt ein gepflanzter Klartext weder in der DB-Datei
  noch im WAL als Bytefolge vor, auch nicht aus einem Anhang-BLOB.
- Die Performance-Auswirkung von `ON` ist gemessen (geschriebene WAL-Frames und Laufzeit, OFF
  gegen ON) und in `design.md` begründet.
- `src/AGENTS.md` bekommt die Regel: Die Haupt-DB wird nur über `db::connect` geöffnet, und
  `secure_delete` ist dort tragend.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `aufbewahrung`: neue Anforderungen. Geschwärzte Werte sind physisch aus DB-Datei und WAL
  entfernt, auch im Altbestand, und ein Restore einer älteren Sicherung wird erneut geschwärzt.

## Impact

- **Backend:** `src/db.rs` (`connect`, `test_pool_datei`, neue Checkpoint-Hilfe, einmaliges
  Verdichten), `src/einsatz/purge_scheduler.rs` (Checkpoint nach Phase B, Nachholen),
  `src/main.rs` (Start-Verdichtung), neue Tests in `src/db.rs` und `tests/`.
- **Arbeitsanleitung:** `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“.
- **Doku:** `docs/betrieb/backup-restore.md` (Sicherungen und Schwärzung).
- Keine API-, DTO- oder Schemaänderung, keine Migration.
- Laufzeit: Löschungen und Updates schreiben mehr Seiten, Anhänge überwiegend. Der
  Append-Pfad (ETB, Meldungen) bleibt unberührt, Messung in `design.md`. Der erste Start nach
  dem Update braucht für das `VACUUM` Zeit und vorübergehend Plattenplatz in DB-Größe.
