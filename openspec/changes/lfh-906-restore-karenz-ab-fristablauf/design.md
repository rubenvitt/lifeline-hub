# Design

## Context

- Phase A des Purge-Laufs (`src/einsatz/purge_scheduler.rs`) wählt abgeschlossene Einsätze mit
  `jetzt >= retention_bis` und `geloescht_at IS NULL` und setzt in `repo::soft_delete_einsatz`
  `geloescht_at = jetzt`. Phase B schwärzt, sobald `jetzt >= geloescht_at + KARENZ_TAGE`.
  Beide laufen im selben Tick nacheinander (A vor B).
- Die Frist entsteht auf drei Wegen: Abschluss (`abgeschlossen_at + Dauer`, immer in der
  Zukunft), manuelle Frist (`repo::frist_setzen`, bestätigt auch in die Vergangenheit) und
  Wiederherstellen (`repo::wiederherstellen`, die Route verlangt einen künftigen Zeitpunkt
  oder `null`).
- Wann eine Frist gesetzt wurde, speichert die Datenbank heute nicht. Ein `retention_bis` in der
  Vergangenheit ohne Vormerkung kann deshalb drei Ursachen haben, die der Purge-Lauf nicht
  auseinanderhält: Sicherung von vor der Vormerkung, Stillstand des Servers über den
  Fristablauf, oder eine bestätigte Verkürzung in die Vergangenheit.
- Wiederherstellen (`geloescht_at > jetzt − KARENZ`) und `aufbewahrung::frist_sperre`
  (422 während der Karenz, 409 danach) sowie der Zustand der Übersicht leiten alles aus
  `geloescht_at` ab.

## Goals / Non-Goals

**Goals:**
- Ein Einsatz ist spätestens Frist + Karenz nach dem ursprünglichen Fristablauf geschwärzt,
  auch nach dem Rückspielen einer Sicherung von vor der Vormerkung und nach einem Stillstand.
- Eine bestätigte Verkürzung in die Vergangenheit behält die volle Karenz von 30 Tagen.
- Wiederherstellen, Friständerung und Zustand bleiben ohne eigene Änderung konsistent.

**Non-Goals:**
- **Datenkategorien** (Phase K1, `einsatz_aufbewahrung_kategorie.vorgemerkt_at`) haben dieselbe
  Lücke. Sie bekommen ein eigenes Ticket, damit diese Change bei der Einsatz-Frist bleibt.
- Kein Restore-Marker, keine Erkennung „diese Datenbank wurde zurückgespielt“.
- Keine Änderung an Phase B, an der Karenz-Dauer oder an der Karenz von Anträgen.

## Decisions

### D1: Karenz-Beginn = `max(retention_bis, Frist gesetzt am)`, höchstens `jetzt`

Phase A setzt `geloescht_at` nicht mehr auf `jetzt`, sondern auf den Zeitpunkt, ab dem die
Frist tatsächlich abgelaufen war: den späteren von `retention_bis` und dem Zeitpunkt, zu dem
diese Frist gesetzt wurde, gedeckelt auf `jetzt`. Das trennt die drei Ursachen ohne
Restore-Erkennung:

| Fall | Frist gesetzt am | Karenz-Beginn |
|---|---|---|
| Sicherung von vor der Vormerkung | vor `retention_bis` | `retention_bis` |
| Stillstand über den Fristablauf | vor `retention_bis` | `retention_bis` |
| Verkürzung in die Vergangenheit | nach `retention_bis` | Zeitpunkt des Setzens |
| normaler Betrieb (Lauf alle 10 min) | vor `retention_bis` | `retention_bis` (≤ 10 min früher als heute) |

Der Wert wird im bewachten `UPDATE` selbst berechnet (SQLite `MAX`/`MIN` auf Text, alle Werte im
kanonischen Format von `zeit::formatiere_utc`), damit Kandidatenliste und Schreiben nicht
auseinanderlaufen.

**Alternativen:**
- *`max(retention_bis, jetzt − KARENZ)`* (Vorschlag im Ticket): erfüllt das Akzeptanzkriterium,
  rechnet aber auch eine Verkürzung in die Vergangenheit ab `retention_bis`. Eine bestätigte
  Verkürzung um 60 Tage würde dann im selben Lauf schwärzen, ganz ohne Karenz. Verworfen.
- *Mindestens 24 Stunden Restkarenz* (`max(…, jetzt − KARENZ + 24 h)`): gäbe nach jedem Restore
  einen Tag zum Wiederherstellen, verfehlt aber das Akzeptanzkriterium um bis zu einen Tag und
  hält Daten, die im ursprünglichen Verlauf schon geschwärzt waren. Verworfen; bei Bedarf eine
  kleine Ergänzung.
- *Restore-Marker* (`restore_aus_datei` schreibt „zurückgespielt am“): erfasst weder ein von
  Hand kopiertes Backup noch den Stillstand. Verworfen.

### D2: Neue Spalte `einsatz.retention_gesetzt_at`

Jeder Schreibweg der Frist setzt sie im selben `UPDATE` mit:

- Abschluss: `abgeschlossen_at` (der Zeitpunkt, aus dem die Frist berechnet wird).
- `frist_setzen`: `jetzt` des Aufrufs; beim Aufheben (`NULL`) ebenfalls, der Wert ist dann
  belanglos.
- `wiederherstellen`: `jetzt`.

`NULL` heißt „unbekannt“: Phase A nimmt dann `jetzt`, das bisherige Verhalten. So bleiben
Einsätze, die Tests oder Werkzeuge roh ohne die Spalte einfügen, beim Alten.

### D3: Einmalige Befüllung in der Migration: `MIN(retention_bis, now)`

Die Migration setzt für jeden Einsatz mit Frist und ohne Vormerkung
`retention_gesetzt_at = MIN(retention_bis, datetime('now'))`. Eine künftige Frist gilt damit als
„jetzt gesetzt“, eine abgelaufene als „vor ihrem Ablauf gesetzt“. Weil die Migration auch beim
ersten Start auf einer zurückgespielten **alten** Sicherung läuft, deckt sie genau den Fall ab,
um den es geht: manuelle Sicherungen, die vor diesem Update entstanden.

Preis: Eine Verkürzung in die Vergangenheit, die kurz vor einer solchen alten Sicherung gesetzt
und noch nicht vorgemerkt wurde, rechnet ihre Karenz ab `retention_bis` statt ab dem Setzen. Im
laufenden Betrieb sind das höchstens die 10 Minuten bis zum nächsten Lauf; nur in einer alten
Sicherung bleibt so ein Zustand stehen.

### D4: ETB-Eintrag nennt den Karenz-Beginn

`soft_delete_einsatz` liest den gesetzten Wert zurück (`RETURNING geloescht_at`). Liegt er vor
`jetzt`, nennt der Audit-Text ihn: „Die Karenz … läuft seit <Zeitpunkt>.“ So
erklärt das ETB, warum eine Schwärzung schon kurz nach der Vormerkung folgt.

### D5: Wiederherstellen und Statuscodes bleiben, wie sie sind

Wiederherstellen und `frist_sperre` rechnen bereits aus `geloescht_at`. Mit dem früheren Wert
gilt automatisch: während der Restkarenz 422 bei Friständerung und Wiederherstellen möglich,
danach 409. Tests belegen das am Restore-Fall, Code ändert sich dort nicht.

## Risks / Trade-offs

- [Ein Notebook, das wochenlang aus war, schwärzt beim ersten Start sofort, ohne dass jemand
  die Vormerkung gesehen hat] → So verlangt es „Frist + Karenz“. Die Frist selbst ist
  angekündigt (Übersicht, Zustand `frist_laeuft`); die Betriebsdoku sagt es ausdrücklich.
- [Bestehende Tests fügen Einsätze roh mit weit vergangener Frist ein] → Sie tragen
  `retention_gesetzt_at = NULL` und behalten das alte Verhalten (D2); neue Tests setzen die
  Spalte ausdrücklich.
- [Textvergleich von Zeitpunkten in SQL] → Alle Schreibwege nutzen `formatiere_utc`; die
  Migration nutzt `datetime('now')` im selben Format (`YYYY-MM-DD HH:MM:SS`).

## Migration Plan

- Migration `0149_…` (Nummer größer als jede auf `alpha`, `scripts/check-migrationen.sh`):
  `ALTER TABLE einsatz ADD COLUMN retention_gesetzt_at TEXT` plus die Befüllung aus D3.
- Rücknahme: Code zurückdrehen genügt; die Spalte bleibt ungenutzt stehen.
