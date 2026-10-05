# Design

## Context

Motivation: `proposal.md`, „Why“. Stand nach LFH-725
(`openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md`):

- Jede Verbindung läuft mit `secure_delete = ON`. Wer eine Zeile löscht, schreibt ihre
  freigewordenen Seiten genullt in den WAL, rund 1 MB WAL je MB gelöschter Daten. Anhänge
  liegen als BLOB in `anhang.daten` (Overflow-Seiten), je Datei höchstens 26 MB
  (`DefaultBodyLimit` der Upload-Routen in `src/app.rs`).
- Drei Wege löschen Anhänge eines Einsatzes in **einer** Transaktion, alle im
  Purge-Scheduler (`src/einsatz/purge_scheduler.rs`), keiner in einem HTTP-Request:
  Phase A2 (`aufbewahrung::antrag::vollziehen_ergebnis` → `schwaerze_einsatz_auf_antrag_tx`),
  Phase K2 (`aufbewahrung_kategorie::schwaerzen` mit `Datenkategorie::Anhaenge`) und Phase B
  (`einsatz::repo::schwaerze_einsatz`). Die Zeile `anhang` ist in
  `schwaerzung_registry::TABELLEN` `ZeileLoeschen` der Kategorie `anhaenge`; die Linker
  `chat_nachricht_anhang` und `etb_eintrag_anhang` gehen per `ON DELETE CASCADE` mit, die
  übrigen (`einsatz_dokument`, `einsatz_schaden_anhang`, `einsatz_tier_anhang`, `uhs_anhang`,
  `einsatz_person_anhang`) löscht die Registry selbst.
- Danach schreibt `db::wal_zurueckschreiben` (`wal_checkpoint(TRUNCATE)`) den WAL zurück.
  TRUNCATE sperrt neue Schreibende, solange es läuft; bei 500 MB im WAL dauert das so lange
  wie die Schwärzung selbst.
- Schreibende im Betrieb warten am `BEGIN IMMEDIATE` bis `busy_timeout` 5 s und wiederholen
  bis zu 4-mal (`src/tx.rs`), Lesende scheitern nach `acquire_timeout` 10 s.

Messung LFH-725 (Cloud-Platte): 500 MB Anhänge → Schwärzung 1,47 s, Rückschrieb 1,21 s. Auf
einer SD-Karte mit ~20 MB/s hochgerechnet je ~25 s.

## Goals / Non-Goals

**Goals:**
- Keine einzelne Schreibtransaktion der Schwärzung gibt Platz von mehr als einem Anhang frei;
  die Sperre ist damit durch die Upload-Grenze gedeckelt (26 MB ≈ 1,3 s bei 20 MB/s), nicht
  mehr durch die Anhangsmenge des Einsatzes.
- Der Rückschrieb danach findet nur noch einen kleinen WAL vor.
- Die bestehenden Zusicherungen bleiben: atomarer Scrub der übrigen Daten, physische
  Entfernung nach dem Purge-Lauf, Idempotenz, kein Schema.

**Non-Goals:**
- Der Verwaisten-Sweep (`anhang::repo::sweep_verwaiste`) löscht weiter in einem `DELETE`.
  Verwaiste Uploads sind selten groß; bleibt das ein Befund, ist es ein eigener Task.
- `demo::entfernen` (Demo-Daten, klein) und das Löschen einzelner Anhänge im Betrieb bleiben.
- Die Sperre unterhalb eines Anhangs zu stückeln (etwa ein BLOB in Teilschritten zu nullen).

## Decisions

### 1. Nachlauf statt Vorlauf

Die atomare Schwärzung bleibt der Punkt ohne Rückkehr. Die Anhang-Zeilen löscht danach ein
Nachlauf, je Anhang eine Transaktion (`write_retry!`, `DELETE FROM anhang WHERE id = ?`).

- *Verworfen: Vorlauf* (Kandidat im Ticket: vor der atomaren Schwärzung je Anhang
  `UPDATE anhang SET daten = x''`). Der Vorlauf ist destruktiv, **bevor** die Schwärzung
  feststeht. Wird der Einsatz in den Sekunden des Vorlaufs wiederhergestellt oder der Antrag
  zurückgenommen, sind die schon geleerten Anhänge eines lebenden Einsatzes verloren, und
  scheitert die atomare Schwärzung danach, bleibt ein halb geleerter Einsatz stehen. Jeder der
  drei Wege bräuchte dafür einen eigenen Wächter mit genau seiner Bedingung. Der Nachlauf
  läuft erst, wenn `geschwaerzt_at` unwiderruflich gesetzt ist; ein Rennen mit der
  Wiederherstellung gibt es dort nicht mehr (Spec: „Eine Rücknahme MUST es nicht geben“).
- *Verworfen: hinnehmen und dokumentieren.* Betroffen wäre ein laufender Einsatz, dessen
  ETB-Schreibvorgänge im Hintergrund eines alten Einsatzes mit 503 scheitern, zu einem
  unvorhersehbaren Zeitpunkt. Das widerspricht dem Zweck des Systems mehr als ein Nachlauf
  der Spec.
- *Verworfen: `auto_vacuum = INCREMENTAL` mit `incremental_vacuum(n)` in Schritten.* Braucht
  einen `VACUUM` jeder bestehenden Datenbank, kürzt die Datei statt zu nullen (die Bytes
  bleiben im Dateisystem) und ändert die Seitenverwaltung für alles andere mit.
- *Verworfen: Anhänge als Dateien neben der Datenbank.* Richtig groß, betrifft Sicherung,
  Restore und Auslieferung; für diese Sperre unverhältnismäßig.

### 2. Im atomaren Vorgang unerreichbar machen

Die Schwärzung löscht in ihrem Vorgang **jede Verknüpfung** der betroffenen Anhänge: den
Chat-Linker und alle Tabellen aus `anhang::repo::MODUL_LINKER` (darunter `etb_eintrag_anhang`).
Die Zeile `anhang` selbst bleibt bis zum Nachlauf stehen. Dazu bekommt die Registry eine
Strategie `ZeileEinzelnLoeschen` für `anhang`: `scrubbe_aus_registry` löscht für sie die
Linker-Zeilen statt der Zeile, der Guard-Test der Registry bleibt vollständig. Ein Linker, der
neu ins Register kommt, ist damit automatisch erfasst.

Danach ist der Anhang aus keiner Liste mehr erreichbar. Phase B und A2 sperren den ganzen
Einsatz ohnehin (`darf_lesen`, `geloescht_at`). Für K2 bleibt der Einsatz lesbar; ein Anhang
ohne Linker wäre über `GET /anhaenge/{aid}` noch für die hochladende Person abrufbar (LFH-117).
Den Abruf sperrt eine Prüfung „zur Entfernung vorgesehen“ (s. 3) in den Lese-Funktionen von
`anhang::repo` mit 404.

- *Verworfen: Anhang-Spalten im atomaren Vorgang überschreiben* (etwa den Dateinamen).
  SQLite schreibt dabei den ganzen Datensatz neu, Overflow-Seiten eingeschlossen; das kostet
  so viel wie das Löschen.

### 3. Was zu entfernen ist, steht im dauerhaften Zustand

Ein Anhang ist zur Entfernung vorgesehen, wenn sein Einsatz `geschwaerzt_at` trägt oder dessen
Kategorie `anhaenge` in `einsatz_aufbewahrung_kategorie` geschwärzt ist; zusätzlich muss der
Einsatz `abgeschlossen` sein. Das ist genau: Uploads verlangen einen aktiven Einsatz
(`EinsatzSchreibzugriff`, `fordere_aktiv`), und ein abgeschlossener Einsatz wird nicht wieder
aktiv. Ein Merker, eine Spalte oder eine Migration ist deshalb nicht nötig, und ein Absturz
zwischen Schwärzung und Nachlauf heilt sich im nächsten Lauf.

### 4. Wo der Nachlauf läuft

- `schwaerze_einsatz`, `aufbewahrung_kategorie::schwaerzen` (nur bei `Anhaenge`) und
  `antrag::vollziehen_ergebnis` (bei `Vollzug::Einsatz`) rufen nach ihrem Commit den Nachlauf
  für ihren Einsatz. Ihre Aufrufer und Tests sehen weiter einen vollständig geschwärzten
  Einsatz. Scheitert der Nachlauf, melden sie trotzdem den Erfolg der Schwärzung und loggen
  den Rest; die Schwärzung ist ja festgeschrieben.
- Der Purge-Tick ruft nach Phase B einen Nachlauf über **alle** Einsätze (Absturz, Fehler im
  Nachlauf eines Weges) und zählt gelöschte Anhänge als Anlass für den Rückschrieb.
- Phase D (`skelett_loeschung::faellige`) übergeht Einsätze, an denen noch ein Anhang steht.
  Sonst löschte die Kaskade beim Skelett die Reste wieder in einer Transaktion.

Zwischen zwei Anhängen gibt der Nachlauf die Sperre ab. SQLites automatischer Checkpoint
(PASSIVE, ab 1000 Seiten) schreibt dabei den WAL fortlaufend zurück, ohne Schreibende zu
sperren; der TRUNCATE-Rückschrieb am Ende findet nur noch den Rest vor.

### 5. Beleg ohne Uhr: WAL-Wachstum je Transaktion

Ein Test misst nicht Zeit, sondern Bytes: Nach der atomaren Schwärzung eines Einsatzes mit
6 × 5 MB Anhängen ist der WAL kleiner als 1 MB; nach dem Nachlauf ist er kleiner als zwei
Anhänge (der automatische Checkpoint setzt ihn zwischen den Anhängen zurück). 5 MB liegen über
seiner Schwelle von 1000 Seiten (≈ 4 MB), damit er nach jedem Anhang greift; mit 1-MB-Anhängen
stünde der WAL bis zur Schwelle und unterschiede einen Nachlauf nicht von wenigen großen
Transaktionen. Das ist hardwareunabhängig und überträgt sich über die Schreibrate auf den Pi.

### 6. Messung

`secure_delete_messung` (`src/db/physisch.rs`) bekommt einen dritten Modus `ON-einzeln`:
atomarer Scrub ohne Anhänge, dann ein `DELETE` je Anhang, und gibt neben der Summe die längste
einzelne Transaktion aus. Dazu schreibt während Schwärzung und Rückschrieb eine zweite
Verbindung fortlaufend kurze Transaktionen wie ein laufender Einsatz; ihre längste Wartezeit
(`warten max`) ist genau die Größe, um die es geht. Der Pool läuft dafür wie in Produktion mit
dem automatischen Checkpoint (LFH-725 maß ohne, um die WAL-Summe zu zeigen); `WAL` ist deshalb
der höchste Stand der Datei. Gemessen wird im Container und auf dem Pi mit SD-Karte und mit SSD
(`LFH725_MB=50,200,500 cargo test --release --lib secure_delete_messung -- --ignored
--nocapture`).

## Messung

**Container** (Release-Build, 4 Xeon-Kerne à 2,1 GHz, Cloud-Platte, 05.10.2026). `warten max`
ist die längste Wartezeit des nebenher Schreibenden, `WAL` der höchste Stand der Datei.

| Anhänge | Modus | Schwärzung gesamt | längste Tx | WAL | Rückschrieb | warten max |
| --- | --- | --- | --- | --- | --- | --- |
| 50 MB | OFF | 0,03 s | 0,03 s | 0,5 MB | 0,00 s | 0,02 s |
| 50 MB | ON | 0,22 s | 0,22 s | 50,8 MB | 0,13 s | 0,19 s |
| 50 MB | ON-einzeln | 0,39 s | 0,02 s | 6,2 MB | 0,02 s | 0,04 s |
| 200 MB | OFF | 0,11 s | 0,11 s | 0,6 MB | 0,04 s | 0,12 s |
| 200 MB | ON | 0,92 s | 0,92 s | 201,9 MB | 0,48 s | 0,83 s |
| 200 MB | ON-einzeln | 1,63 s | 0,03 s | 7,2 MB | 0,01 s | 0,04 s |
| 500 MB | OFF | 0,22 s | 0,22 s | 0,9 MB | 0,01 s | 0,23 s |
| 500 MB | ON | 2,22 s | 2,22 s | 504,2 MB | 1,12 s | 1,74 s |
| 500 MB | ON-einzeln | 3,96 s | 0,04 s | 7,2 MB | 0,01 s | 0,08 s |

Einordnung: Der Nachlauf braucht insgesamt etwas länger (je Anhang ein Commit mit `fsync`), die
Wartezeit eines anderen Schreibenden fällt aber von „wächst mit der Anhangsmenge“ (1,74 s bei
500 MB) auf „ein Anhang“ (0,08 s) und hängt nicht mehr von der Menge ab. Der WAL bleibt bei
gut 7 MB, der Rückschrieb am Ende ist praktisch leer. Auf der SD-Karte wächst `warten max` im
Modus ON mit der Schreibrate (hochgerechnet ~25 s bei 500 MB), im Modus ON-einzeln nur bis
zur Dauer eines Anhangs (1 MB ≈ 0,05 s, höchstens 26 MB ≈ 1,3 s bei 20 MB/s).

**Pi** (mit SD-Karte und mit SSD): offen.

## Risks / Trade-offs

- [Zwischen atomarer Schwärzung und Nachlauf steht der Anhang-Inhalt noch in der Datei,
  normalerweise Sekunden, nach einem Absturz bis zum nächsten Lauf.] → Er ist in der Zeit
  nicht abrufbar (Entscheidung 2). Dieselbe Lücke gab es schon vor dem Rückschrieb (LFH-725,
  Entscheidung 2); die Spec misst die physische Entfernung am Ende des Laufs.
- [Ein einzelner 26-MB-Anhang sperrt auf einer langsamen SD-Karte länger als gedacht.] →
  Gedeckelt durch die Upload-Grenze; liegt die Pi-Messung darüber, bleibt die Sperre trotzdem
  unter `busy_timeout`, solange die Karte mehr als ~6 MB/s schreibt.
- [Die SD-Karte ist während des Nachlaufs ausgelastet; Schreibende werden langsamer, aber
  nicht abgewiesen.] → Hingenommen: einmal je Einsatz, im Hintergrund.
- [Ein neuer Weg, der Anhänge in einer Transaktion löscht, umgeht den Nachlauf.] → Die
  Registry-Strategie trägt den Nachlauf; ein Weg ohne Registry fiele im WAL-Test nicht auf.
  Der Kommentar an `ZeileEinzelnLoeschen` nennt die Regel.

## Migration Plan

Keine Schemamigration. Ein Einsatz, den eine ältere Version schon geschwärzt hat, trägt keine
Anhänge mehr; der Nachlauf findet nichts. Rollback auf eine ältere Version: Anhänge, die ein
Nachlauf noch nicht gelöscht hat, löscht die alte Version nicht mehr (sie kennt den Nachlauf
nicht); sie bleiben unerreichbar stehen, bis wieder eine Version mit Nachlauf läuft.
