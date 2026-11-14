# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/r11nl4cvufnygba40muips46 (LLH-1852, Weg mit Ruben am
13.11.2026 abgestimmt)

## Why

Das Lebensende `geloescht` erreicht einen Spiegel nur, wenn der löschende Führer auch der
Ursprung des Einsatzes ist. Übernimmt der Hub einen Einsatz des ELW (Notübernahme, Übergabe,
Verwahrung mit Rückfall) und löscht ihn später endgültig, bleibt der Spiegel am ELW stehen, bis
Phase R ihn abräumt; im umgekehrten Fall bleibt der Spiegel am Hub für immer. Grund sind zwei
Präfixprüfungen: Der Löschende belegt das Ende nur für Kennungen mit eigenem Präfix
(`spiegel::lebensende::ist_geloescht`), der Spiegel nimmt es nur für Kennungen mit dem Präfix
des Absenders an (`geloescht_uebernehmen`). Seit LLH-1699 liegt mit dem Löschvermerk ein Beleg
vor, der auch fremde Präfixe trägt; er wird für Spiegel noch nicht genutzt.

Dazu kommt eine falsche Meldung im Bestand: `ist_geloescht` zählt jeden Eintrag im
Löschprotokoll, auch einen abgeräumten Spiegel (Art `spiegel`). Eine Instanz, deren Einsatz an
einen anderen Führer ging und deren Spiegel nach der Nachbereitung abgeräumt wurde, meldet ihn
als gelöscht, obwohl er beim Führer weiterlebt.

## What Changes

- **Senden:** Stände und Akten bekommen denselben Beleg. Eine Instanz meldet einen genannten
  Stand als `geloescht`, wenn ein Löschvermerk das Ende belegt (auch bei fremdem Präfix) oder,
  für Löschungen von vor dem Vermerk, das Löschprotokoll mit eigenem Präfix, einer Org der
  fragenden Kopplung und einer Art außer `spiegel`. In beiden Fällen stehen hier weder Einsatz
  noch Akte mit der Kennung. `ist_geloescht` entfällt.
- **Annehmen:** Ein Spiegel endet auf `geloescht` nur, wenn er zu dieser Kopplung gehört und der
  Absender sein Führer ist: Mit eingeschalteter Führung je Einsatz und einer Akte zur Kennung
  entscheidet allein die Akte (sie nennt den Absender als Führer), auch gegen ein passendes
  Präfix. Ohne Schalter oder ohne Akte gilt wie bisher das Präfix des Absenders.
- **Ohne Führung je Einsatz** entsteht kein Spiegel mit fremdem Präfix (Prüfung der Aufgabe,
  Begründung in design.md); dort ändert sich am Ergebnis nichts außer dem engeren Altbeleg.
- Neue ADR für die Regel „ein Spiegel endet nur auf Meldung seines Führers, mit Beleg“;
  `src/AGENTS.md` (Lebensende) zieht nach.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `instanz-fuehrung`: „Gelöscht meldet eine Instanz nur mit Beleg“ gilt auch für die Stände von
  Spiegeln und schließt einen abgeräumten Spiegel als Beleg aus; neu „Ein Spiegel endet nur auf
  Meldung seines Führers“.

## Impact

- Code: `src/instanz/spiegel/lebensende.rs` (`geloeschte`, `ist_geloescht`,
  `geloescht_uebernehmen`), Aufrufe in `src/instanz/spiegel/abgleich.rs` (Pull und Push).
- Tests: `src/instanz/spiegel/lebensende/tests.rs`, `tests/instanz_lebensende.rs`,
  `tests/instanz_fuehrung.rs`.
- Doku: neue ADR unter `docs/architektur/entscheidungen/`, `src/AGENTS.md` (Instanzkopplung,
  Lebensende und Akten ohne Spiegel).
- Protokoll: unverändert (`instanz::PROTOKOLL` bleibt, kein neues Feld). Gemischter Betrieb:
  eine ältere Instanz nimmt `geloescht` mit fremdem Präfix weiter nicht an; der Spiegel bleibt
  dort wie heute.
- Keine Migration.
