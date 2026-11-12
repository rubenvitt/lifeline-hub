# Proposal

## Why

Eine Führungsakte ohne lokalen Einsatz (`einsatz_fuehrung.einsatz_id IS NULL`, etwa ein Einsatz,
der beim Koppeln schon abgeschlossen war) erfährt nie, dass ihr Einsatz beim Führer gelöscht ist:
Das Lebensende `geloescht` meldet der Führer nur für Kennungen, die das Gegenüber als Stand eines
Spiegels nennt, und belegen kann er es nur für Kennungen mit eigenem Präfix. Die Akte steht dann
dauerhaft unter „Einsätze beim Gegenüber“ (LLH-1699, abgespalten aus LLH-1675). An einem Hub mit
mehreren ELW trifft das auch jede ELW, die den Einsatz einer anderen nur über den Hub kennt, und
die Akten eines widerrufenen ELW, solange die Org an einem anderen hängt.

## What Changes

- **Löschsignal für Akten ohne Spiegel im Abgleich:** Wer solche Akten hält, nennt ihre Kennungen
  in einem neuen, abwärtskompatiblen Feld des Abgleichs. Das Gegenüber antwortet für jede, deren
  Einsatz es endgültig nicht mehr hat, mit dem Lebensende `geloescht`; die Akte wird gelöscht und
  verschwindet aus „Einsätze beim Gegenüber“.
- **Nur mit Beleg:** Gemeldet wird eine Kennung nur, wenn die antwortende Instanz ihr Ende
  festgehalten hat (Löschprotokoll oder Löschvermerk) und weder Einsatz noch Akte dazu hält. Eine
  aus einer Sicherung zurückgekehrte Instanz meldet nichts.
- **Löschvermerk je Kennung (neue Tabelle):** Jede endgültige Löschung eines Einsatzes mit
  Kennung und jede auf ein Signal hin gelöschte Akte hinterlässt einen Vermerk. Damit belegt eine
  Instanz das Ende auch für Kennungen mit fremdem Präfix (der Hub löscht einen verwahrten Einsatz
  `elw1/…`) und reicht es an weitere Gegenüber derselben Org weiter.
- **Wer was annimmt:** Die erreichte Seite löscht eine Akte nur, wenn sie den Absender als Führer
  nennt; ein ELW kann am Hub keine Akte eines anderen ELW löschen. Die meldende Seite nimmt das
  Signal der erreichten für jede Akte ohne Spiegel einer Org der Kopplung an.
- **Widerruf:** Endet eine Org-Zuordnung, löscht die Instanz die Akten ohne Spiegel, die das
  widerrufene Gegenüber führt, und vermerkt sie. Bei einer neuen Zuordnung kommen die Akten des
  Gegenübers wie bisher neu.
- **Doku:** Im Anwenderkapitel „Instanzkopplung“ entfällt der Satz, ein beim Gegenüber gelöschter,
  nie gespiegelter Einsatz bleibe stehen; `src/AGENTS.md` nennt die Regel beim Lebensende.

Nicht Teil der Change:

- Ein *gespiegelter* Einsatz mit fremdem Präfix bekommt weiterhin kein `geloescht`, wenn der
  löschende Führer nicht der Ursprung ist (LLH-1852). Der Weg über die Stände bleibt unverändert.
- Ein ELW an zwei Hubs behält Akten Dritter, die über den widerrufenen Hub kamen, solange die Org
  am anderen Hub hängt: Über welche Kopplung eine Akte kam, ist nicht gespeichert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `instanz-fuehrung`: neue Anforderungen zum Ende einer Akte ohne Spiegel (Löschung beim
  Gegenüber, Beleg, Annahme, Weitergabe über die erreichte Seite, Widerruf).

## Impact

- Backend:
  - `src/instanz/spiegel/paket.rs` (Feld und Grenzen), `abgleich.rs` (Nennen, Antworten, beide
    Richtungen), `lebensende.rs` (Beleg und Annahme)
  - `src/instanz/fuehrung/` (Löschvermerk, Akten ohne Spiegel, Widerruf in
    `repo::release_nach_widerruf`)
  - `src/einsatz/abraeumen.rs`, `src/einsatz/skelett_loeschung.rs` (Vermerk in der Transaktion der
    Löschung)
  - Migration `0336` (neue Tabelle, ohne Marker), Einordnung in den Tabellen-Wächtern
  - Tests: `tests/instanz_fuehrung.rs` (zwei und drei Instanzen), Unit-Tests am Paket und am Beleg
- Leitung: `POST /api/instanz/spiegel` bekommt ein Feld mit `serde(default)`; `PROTOKOLL` bleibt.
  Ältere Gegenüber überlesen es und bekommen nichts, was sie nicht kennen.
- Doku: `docs/anwender/kapitel/instanzkopplung.md`, `src/AGENTS.md`, Kommentar an
  `fuehrung::repo::list_fremde_der_org`.
- Kein Frontend-Code, keine Änderung an Response-DTOs (kein Typ-Codegen).
