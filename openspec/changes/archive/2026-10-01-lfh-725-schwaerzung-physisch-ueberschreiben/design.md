# Design

## Context

Die Haupt-DB öffnet nur `db::connect` (`src/main.rs` Serverstart und CLI-`backup`). Der Pool
hat bis zu fünf Verbindungen und läuft im WAL-Modus mit `busy_timeout` 5 s und
`wal_autocheckpoint` als Vorgabe (PASSIVE, ab 1000 Seiten). Die Schwärzung
(`einsatz::repo::schwaerze_einsatz`, aus der Registry `schwaerzung_registry`) läuft als eine
Transaktion in Phase B des Purge-Schedulers, höchstens alle 10 Minuten, und schreibt Platzhalter,
setzt Spalten auf NULL oder löscht Zeilen. Anhänge liegen als BLOB in `anhang.daten` und
belegen damit Overflow-Seiten. Das einzige FTS5-Verzeichnis ist `etb_eintrag_fts`; das ETB ist
Retain, ein FTS-Rest geschwärzter Werte entsteht also nicht. Sitzungstokens liegen nur als
Hash in der DB.

**Probe (SQLite 3.45, WAL, Klartext in Textspalte und 60-KB-BLOB, dann UPDATE + DELETE):**

| `secure_delete` | ohne Checkpoint: DB / WAL | nach `wal_checkpoint(TRUNCATE)`: DB / WAL |
| --- | --- | --- |
| OFF | gefunden / gefunden | gefunden / leer |
| FAST | gefunden / gefunden | **gefunden** / leer |
| ON | gefunden / sauber | **sauber / leer** |

Unter `ON` liegt der Vorzustand bis zum Checkpoint noch in der Hauptdatei, weil die genullten
Seiten zunächst nur im WAL stehen. Erst `ON` zusammen mit dem Checkpoint erfüllt das
Akzeptanzkriterium.

## Goals / Non-Goals

**Goals:**
- Geschwärzte Werte sind nach dem Purge-Lauf physisch weg, aus der Hauptdatei und aus dem WAL
  (Spec `aufbewahrung`, „Physische Entfernung geschwärzter Werte“).
- Bestehende Installationen werden einmal bereinigt.
- Die Performance-Wirkung ist gemessen und eingeordnet.

**Non-Goals:**
- Sicherungen nachträglich schwärzen oder automatisch löschen (s. Entscheidung 4).
- Spuren unterhalb von SQLite: Dateisystem-Journal, SSD-Wear-Leveling, Swap. Dafür ist
  Datenträgerverschlüsselung des Betreibers zuständig, das wird dokumentiert.
- Die Karenz-Semantik von Phase A ändern (Restore einer Sicherung von vor der Vormerkung, s.
  Risiken).
- Neue Endpunkte, DTOs oder Migrationen.

## Decisions

### 1. `secure_delete = ON` je Verbindung in `db::connect`

`SqliteConnectOptions::pragma("secure_delete", "ON")`. sqlx setzt das PRAGMA auf jeder neuen
Pool-Verbindung, und ein Test pinnt es analog `connect_enables_wal_and_foreign_keys`.
`test_pool_datei` bekommt es auch, damit der Pool die Produktionsparität behält.

- *Verworfen: `FAST`.* Laut Probe lässt `FAST` die Freelist-Seiten eines gelöschten BLOBs
  ungenullt, und genau das sind die Anhänge, also der größte PII-Block.
- *Verworfen: nur in der Schwärzungs-Transaktion umschalten.* Das PRAGMA gilt pro Verbindung.
  Ein Umschalten auf einer ausgeliehenen Pool-Verbindung bliebe an ihr hängen oder bräuchte ein
  Zurücksetzen, das bei einem Fehler ausbleibt. Löschungen im laufenden Betrieb (Anhang
  entfernen, Verwaisten-Sweep, Phase C) würden zudem weiter Altbytes hinterlassen.
- *Verworfen: Compile-Flag `SQLITE_SECURE_DELETE` über `libsqlite3-sys`.* Ein Test kann es
  nicht direkt sehen, es greift nur im gebündelten Build, und das PRAGMA leistet dasselbe
  sichtbar.

### 2. `wal_checkpoint(TRUNCATE)` nach erfolgreicher Phase B, mit Nachholen

Neue Hilfe `db::wal_zurueckschreiben(pool) -> Result<bool, sqlx::Error>`
(`src/db/physisch.rs`): Sie führt `PRAGMA wal_checkpoint(TRUNCATE)` aus und liefert `true`
nur bei `busy = 0`. Der Purge-Scheduler ruft sie nach Phase B auf, sobald mindestens ein
Einsatz geschwärzt wurde.
Bleibt der Rückschrieb unvollständig, merkt sich die Scheduler-Schleife das
(`rueckschrieb_ausstehend`, im Speicher, über `tick_mit_rueckschrieb`) und versucht es in jedem
Tick erneut, bis es gelingt. Die Schleife startet mit `true`, der erste Tick läuft sofort.
Zusätzlich läuft ein TRUNCATE-Checkpoint beim Serverstart (Entscheidung 3). Das deckt einen
Absturz zwischen Schwärzung und Rückschrieb ab, denn ein verwaister WAL wird beim Öffnen
wiederhergestellt und beim Start zurückgeschrieben.

- *Warum nicht in `schwaerze_einsatz` selbst:* Die Funktion ist eine Transaktion auf dem Pool.
  Der Checkpoint muss nach dem Commit laufen, und bei mehreren Einsätzen in einem Tick genügt
  einer.
- *Warum nicht jeder Tick:* TRUNCATE hält beim Warten auf Lesende die Schreibsperre, bis zu
  `busy_timeout`. Alle 10 Minuten bis zu 5 s Schreibstau im laufenden Einsatz wären ein
  schlechter Tausch. Nach einer Schwärzung passiert das einmal je Einsatz-Lebensdauer.
- *Warum ein Flag im Speicher statt in der DB:* Nach einem Neustart erledigen der
  Start-Checkpoint und der erste Tick (Flag startet mit `true`) dasselbe, ein persistierter
  Merker brächte nur Schema.

### 3. Einmaliges `VACUUM` beim Serverstart für den Altbestand

Nach `migrate` und vor dem Router: Fehlt in `app_meta` der Schlüssel
`physisch_bereinigt_lfh725`, läuft `VACUUM`. Danach setzt der Server den Schlüssel und
schreibt mit TRUNCATE-Checkpoint zurück. Ein Fehler, etwa eine volle Platte, wird per
`tracing::error!` gemeldet, der Server startet trotzdem, und der nächste Start versucht es
erneut (Spec „Altbestand vor der physischen Entfernung“). `VACUUM` baut jede Seite neu auf und
entfernt damit Freeblocks und Freelist. Auf einer frischen DB dauert das Millisekunden.

- *Verworfen: nur Doku oder CLI-Befehl.* Bei einem Betreiber, der den Hinweis nicht liest,
  blieben die Altbytes früherer Schwärzungen dauerhaft stehen. Der DSGVO-Befund bestünde für
  den Altbestand also weiter.
- *Verworfen: VACUUM bei jedem Start.* Auf einer großen DB mit Anhängen auf dem Pi wären das
  Minuten Startzeit ohne Nutzen, denn `secure_delete` hält die Datei ab da sauber.

### 4. Sicherungen: dokumentieren, nicht löschen (Empfehlung, Freigabe nötig)

Sicherungen von vor einer Schwärzung tragen die PII weiter. Die DSGVO verlangt keine sofortige
Schwärzung in Sicherungen. Gefordert ist, dass sie mit begrenzter Laufzeit herausrotieren und
ein Restore die Löschung erneut anwendet. Beides lässt sich hier belegen:

- **Auto-Sicherungen** rotieren nach `--backup-behalten` × `--backup-intervall-minuten` heraus,
  mit den Vorgaben 7 × 6 h ≈ 42 h. Gezählt wird Betriebszeit mit gelingenden Sicherungen: der
  Scheduler rotiert erst nach einer erfolgreichen neuen Sicherung, und ein früheres
  Zielverzeichnis rotiert gar nicht mehr. Die Doku nennt die Formel und diese Grenzen.
- **Downloads (`/api/backup`, CLI `backup`) und externe Kopien** verwaltet der Betreiber. Die
  Doku sagt, dass solche Kopien nach der Karenz zu vernichten sind.
- **Restore:** Ist der Einsatz in der Sicherung schon vorgemerkt, schwärzt der nächste
  Purge-Lauf ihn erneut, weil `geloescht_at` aus der Sicherung gilt. Ein Test belegt das (Spec
  „Rückspielen einer Sicherung von vor der Schwärzung“).

*Alternative (nicht empfohlen): Auto-Sicherungen nach einer Schwärzung verwerfen und sofort
eine frische ziehen.* Das wäre strenger, löscht aber bis zu 42 h Wiederherstellungspunkte, und
das ausgerechnet in einem Moment, in dem gerade irreversibel geschrieben wurde. Den
Altbestand bei Downloads und externen Kopien erreicht es trotzdem nicht.

### 5. Messung

Ein `#[ignore]`-Test `secure_delete_messung` in `src/db/physisch.rs`, aufrufbar mit
`cargo test --release --lib secure_delete_messung -- --ignored --nocapture`. Er fährt drei Lasten
mit OFF und mit ON auf einem Datei-Pool: ETB-artiges Anhängen, Personen-Scrub mit
Anhang-Löschung und den Checkpoint danach. Er gibt die geschriebenen WAL-Bytes (Dateigröße vor
dem Checkpoint) und die Laufzeit aus. Die WAL-Bytes sind die hardwareunabhängige Größe; sie
übertragen sich auf den Pi über dessen Schreibrate.

**Messung (`secure_delete_messung`, Release-Build, Container mit 4 Xeon-Kernen à 2,1 GHz und
Cloud-Platte, 01.10.2026):**

| Last | WAL OFF | WAL ON | Zeit OFF | Zeit ON |
| --- | --- | --- | --- | --- |
| 5000 Anhäng-Transaktionen | 22,9 MB | 22,9 MB | 2,24 / 2,63 s | 2,63 / 2,35 s |
| Schwärzung 2000 Personen + 50 MB Anhänge (eine Tx) | 0,5 MB | 50,8 MB | 0,02 s | 0,16 s |
| Rückschrieb danach (50 MB) | – | – | 0,00 s | 0,15 s |
| Schwärzung 2000 Personen + 500 MB Anhänge (eine Tx) | 0,9 MB | 504,1 MB | 0,15 s | 1,47 s |
| Rückschrieb danach (500 MB) | – | – | 0,01 s | 1,21 s |

Eine Vormessung mit Python/SQLite 3.45 ergab dasselbe Bild.

Einordnung: Auf dem Anhäng-Pfad, also ETB, Meldungen und Lage, kostet `ON` nichts. Die
WAL-Bytes sind gleich, die Zeiten streuen in beide Richtungen, weil dort nichts frei wird.
Beim Löschen schreibt `ON` die freigewordenen Bytes einmal genullt nach. Der Mehraufwand ist
proportional zur gelöschten Menge, rund 1 MB WAL je MB gelöschter Daten. Für den Pi zählt
seine Schreibrate. Mit einer SD-Karte (~20 MB/s) dauert eine Schwärzung mit 50 MB Anhängen
geschätzt ~2,5 s, eine mit 500 MB ~25 s, dazu kommt jeweils der Rückschrieb. Mit einer SSD
über USB 3 (~200 MB/s) bleiben 500 MB unter 3 s. Das passiert einmal je Einsatz, im
Hintergrund-Purge.

## Risks / Trade-offs

- [Lange Schreibsperre bei großen Anhangsmengen: Die Schwärzung ist atomar, und unter `ON`
  wächst ihre Commit-Zeit mit der Anhangsgröße. Gemessen: 500 MB in 1,47 s auf der Cloud-Platte.
  Hochgerechnet auf einen Pi mit SD-Karte sind es ~25 s. Gleichzeitige Schreibende
  (`busy_timeout` 5 s, `write_retry!` bis 4 × 5 s) bekämen in der Zeit 503.] → Befund am
  Review-Checkpoint. Betroffen ist nur ein Pi mit SD-Karte, mit sehr vielen Anhängen an einem
  geschwärzten Einsatz, und nur, wenn gleichzeitig ein anderer Einsatz schreibt. Abhilfe ohne
  Spec-Änderung gibt es nicht, denn genullt werden muss jedes Byte. Abhilfe mit Spec-Änderung:
  die Anhang-BLOBs vor der atomaren Schwärzung in Einzeltransaktionen leeren und so die
  Atomarität für Anhänge lockern. Das ist ein eigener Task (LFH-905).
- [Erster Start nach dem Update dauert länger und braucht freien Platz bis zur doppelten
  DB-Größe (temporäre Kopie und WAL).] → Fehler blockieren den Start nicht. Die Doku nennt den
  Platzbedarf, und das Log meldet Beginn, Dauer und Ergebnis.
- [Restore einer Sicherung von **vor** der Vormerkung: Phase A merkt den Einsatz neu vor, und
  die Karenz läuft weitere 30 Tage.] → Die Doku nennt das. Der Fall ist auf manuelle
  Sicherungen begrenzt, die älter als die Karenz sind (Auto-Sicherungen im Dauerbetrieb
  ≈ 42 h). Ihn zu schließen hieße die Karenz-Semantik zu ändern, das ist ein eigener Task (LFH-906).
- [Spuren unterhalb von SQLite (Dateisystem, SSD).] → Die Doku empfiehlt
  Datenträgerverschlüsselung. Außerhalb dessen, was die Anwendung leisten kann.

## Migration Plan

Keine Schemamigration. Mit dem Update gilt `secure_delete` sofort für alle Verbindungen. Der
erste Start verdichtet einmal (Entscheidung 3). Ein Rollback auf eine ältere Version ist
unschädlich: Der `app_meta`-Schlüssel bleibt liegen und wird ignoriert, nur `secure_delete`
fehlt dann wieder.
