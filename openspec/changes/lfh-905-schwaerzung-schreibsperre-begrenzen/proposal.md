# Proposal

## Why

Seit LFH-725 nullt SQLite (`secure_delete = ON`) jedes freigewordene Byte. Die Schwärzung eines
Einsatzes löscht seine Datei-Anhänge in derselben Transaktion wie den übrigen Scrub, und diese
Transaktion hält die Schreibsperre der ganzen Datenbank, bis der Commit 1 MB WAL je gelöschtem
MB Anhang geschrieben hat. Auf einem Pi mit SD-Karte (~20 MB/s) sind das bei 500 MB Anhängen
rund 25 s, danach noch einmal so lange für den Rückschrieb. In dieser Zeit bekommen
Schreibende **laufender** Einsätze nach `busy_timeout` und `write_retry!` eine 503: Eine
ETB-Meldung im Einsatz scheitert, weil im Hintergrund ein alter Einsatz geschwärzt wird.

## What Changes

- Die atomare Schwärzung (Phase B, Vollzug eines Einsatz-Antrags, Kategorie `anhaenge`) löscht
  die Anhang-Zeilen nicht mehr selbst. Sie macht die Anhänge in ihrem Vorgang unerreichbar
  (Verknüpfungen weg, Umfang als geschwärzt markiert) und bleibt sonst unverändert atomar.
- Ein **Nachlauf** löscht danach jeden betroffenen Anhang in einer eigenen kurzen Transaktion.
  Die Schreibsperre hält damit höchstens so lange, wie das Nullen **eines** Anhangs dauert
  (Upload-Grenze 26 MB, auf SD-Karte ~1,3 s), und zwischen zwei Anhängen kommen andere
  Schreibende zum Zug.
- Welche Anhänge noch zu löschen sind, ergibt sich aus dem dauerhaften Zustand (Einsatz oder
  Kategorie `anhaenge` geschwärzt, Anhang noch da). Jeder Purge-Lauf holt Reste nach, auch nach
  einem Absturz oder Neustart, vor dem WAL-Rückschrieb.
- Die Messung `secure_delete_messung` bekommt den Nachlauf als dritten Modus und gibt die längste
  einzelne Transaktion aus, damit dieselbe Messung auf dem Pi die Sperrdauer belegt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung`: „Unwiderrufliche Schwärzung“ nimmt die Datei-Inhalte aus dem atomaren
  Vorgang (nur noch unerreichbar machen), „Physische Entfernung geschwärzter Werte“ gilt nach
  dem Nachlauf; neu ist „Entfernung der Datei-Inhalte in Einzelschritten“ mit der Grenze, dass
  kein Schreibvorgang der Schwärzung Platz von mehr als einem Anhang freigibt.

## Impact

- Backend: `src/einsatz/repo.rs` (`schwaerze_einsatz`, `schwaerze_einsatz_auf_antrag_tx`),
  `src/einsatz/schwaerzung_registry.rs` (Strategie für `anhang`),
  `src/einsatz/aufbewahrung_kategorie.rs` (`schwaerzen`), `src/aufbewahrung/antrag.rs`
  (Vollzug), `src/einsatz/purge_scheduler.rs` (Nachlauf vor dem Rückschrieb),
  `src/anhang/repo.rs` (Nachlauf-Löschung, Download-Sperre), `src/db/physisch.rs` (Messung).
- Keine Migration, keine API- oder DTO-Änderung, kein Frontend.
- Spec `aufbewahrung-kategorien` verweist für die physische Entfernung bereits auf
  `aufbewahrung` und bleibt unverändert.
