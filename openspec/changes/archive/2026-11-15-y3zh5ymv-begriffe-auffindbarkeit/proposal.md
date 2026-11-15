# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/y3zh5ymvlwmvgz6rdaandtik (LLH-1723, Thema 9 der
UI/UX-Analyse vom 12.11.2026) mit den Unteraufgaben LLH-1804, LLH-1803, LLH-1802 und LLH-1805.

## Why

Neue Kräfte raten, wo etwas steht. Die Sprungpalette findet zu „rtw“ die Benutzerverwaltung, zu
„kraefte“ den Bereitstellungsraum und zu „kräfteübersicht“ nichts. Das Modul heißt „Meldebild“,
ein Wort, nach dem niemand sucht und das in den Einsatzdaten etwas anderes meint. Wer einen
Funkspruch erfassen will, findet keinen Einstieg „Meldung erfassen“, und eine aus dem Chat
heraufgestufte Meldung landet nur im ETB, nicht im Meldungseingang. App und Hilfe gliedern die
Module verschieden, und die Rail kürzt zu „ERFASS.“.

Das Meldungsmodell selbst (eine Meldung mit dem Merkmal „lagerelevant“, Lagemeldungen als Sicht
darauf, ETB-Eintrag mit Verweis) steht seit LLH-1027 und bleibt. Diese Change schließt die
Lücken in Auffindbarkeit, Benennung und Gliederung.

## What Changes

- **Sprungpalette, Treffer (LLH-1804):** Ein eigener Abgleich ersetzt Fuse.js. Jedes Suchwort
  muss einen Wortanfang treffen oder ab drei Zeichen als Teilwort vorkommen; Umlaute und ihre
  Umschrift gelten gleich („kraefte“ = „Kräfte“). Eine bloße Buchstabenfolge trifft nicht mehr.
- **Sprungpalette, Datensätze:** Fahrzeuge sind auch über Fahrzeugtyp und Kennzeichen auffindbar,
  Personal auch über seine Funktion. „Hilfe“ öffnet die Anwenderhilfe.
- **Sprungpalette, Schnellaktionen:** neu „Meldung erfassen“, „Lagemeldung erfassen“, „Auftrag
  erteilen“, „Nachforderung stellen“ und „Fahrzeugstatus setzen“. Die Reihenfolge folgt der
  gemessenen Nutzung je Benutzer (serverseitig, wie „Zuletzt ausgeführt“); bei Gleichstand gilt eine
  feste fachliche Folge. **BREAKING** für die Spec-Zusage „bestehende Schnellaktionen behalten ihre
  Reihenfolge“.
- **Synonyme (LLH-1803):** Module tragen Schlagworte in der Modul-Registry (Kräfteübersicht:
  Meldebild, Stärke; ETB: Tagebuch; Unfallhilfsstellen: BHP …), die Palette sucht darüber.
- **Meldebild heißt sichtbar „Kräfteübersicht“ (LLH-1803):** Menü, Seite, Druckkopf,
  Lagebericht-Übernahme, Hilfe, Glossar und Website. Schlüssel, Route, Hilfe-Adresse
  `/hilfe/meldebild` und Bezeichner bleiben. „Sachverhalt / Meldebild“ in den Einsatzdaten bleibt
  (Begriff der Leitstelle). Löst LFH-965, Entscheidung D1, ab.
- **Ein Einstieg für Meldungen (LLH-1802):** Die Meldungsseite und die Lagemeldungen öffnen ihr
  Formular über `?neu=1`. Die Heraufstufung einer Chat-Nachricht vom Typ „Meldung“ oder „Lage“
  legt die Meldung im Meldungseingang mit an, solange „Auch in den Meldungseingang“ gewählt ist, wie die
  ETB-Schnellerfassung. Das Informationstelefon bleibt getrennt.
- **Eine Gliederung (LLH-1805):** Das ETB wandert in die Kategorie „Führung“ (mit der Marke
  „Entscheidungen“). Die Kategorie „Erfassung“ heißt „Betroffene & Schäden“. Die Hilfe gliedert ihre Kapitel
  nach den Kategorien der App; ein Wächter hält beide gleich.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `sprungpalette`: Trefferregel, Synonyme, Datensatz-Merkmale, neue Schnellaktionen, Reihenfolge
  nach Nutzung, Hilfe in der Palette.
- `modul-benennung`: „Kräfteübersicht“ statt „Meldebild“, ETB in „Führung“, Kategorie
  „Betroffene & Schäden“, Hilfe gliedert wie die Navigation.
- `modul-sprungmarken`: „Entscheidungen“ steht mit dem ETB in „Führung“.
- `meldungseingang`: Chat-Heraufstufung legt die Meldung an; `?neu=1` öffnet das Formular.
- `seiten-orientierung`: Kategoriename „Betroffene & Schäden“ und Seitenname „Kräfteübersicht“ in den
  Szenarien.
- `druck-dokumente`: Druckkopf nennt „Kräfteübersicht“.
- `fuehrungsorganisation`: Knopf „Aus Kräfteübersicht und Führungsorganisation übernehmen“.
- `lagevortrag-uebernahme`: „Kräfteübersicht“ statt „Kräftemeldebild“ im übernommenen Text.

## Impact

- **Frontend:** `command-palette/` (Abgleich, Schnellaktionen, Zähler, Datensätze),
  `einsatz/modulRegistry.ts` (Label, Schlagworte, Kategorie, Reihenfolge), `einsatz/sprungmarken.ts`,
  `hilfe/bereiche.ts`, `pages/MeldungenPage.tsx`, `pages/LagemeldungenPage.tsx`,
  `pages/AuftraegePage.tsx`, `chat/HeraufstufenModal.tsx`, Kräfteübersicht und
  Lagebericht-Übernahme; `fuse.js` entfällt, wenn nichts anderes es nutzt.
- **Backend:** `src/chat/` (Heraufstufung mit Meldung), `src/benutzer_einstellungen/` (neuer
  Schlüssel `schnellaktionen_zaehler`), `src/einsatz/modul.rs` (Reihenfolge `MODUL_KEYS`). Keine
  Migration, keine neue Route; das Feld `in_meldungseingang` am Heraufstufen-Body ist neu
  (Typ-Codegen).
- **Doku und Regeln:** `docs/anwender/` (Kapitelreihenfolge, Bereiche, Kapitel „Meldebild“, Bilder),
  `docs/architektur/12-glossar.md`, `website/` (Kopien), `frontend/AGENTS.md`,
  `frontend/src/command-palette/AGENTS.md`, `docs/anwender/AGENTS.md`, `src/AGENTS.md`.
- **Gespeicherte Zustände:** Kategorie-Schlüssel `erfassung` bleibt (Browserspeicher
  `lfh:nav:kategorie-modul`), Befehls-Ids der bestehenden Schnellaktionen bleiben (Gedächtnis).
