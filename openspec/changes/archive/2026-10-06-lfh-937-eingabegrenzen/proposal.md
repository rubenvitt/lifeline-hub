# Proposal

## Why

Mehrere Schreibendpunkte begrenzen weder Freitexte noch Listenlängen noch die Zahl der
GeoJSON-Stützpunkte; einzige Schranke ist das axum-Body-Limit von 2 MiB. Das Audit vom
01.10.2026 fand vier Befunde: Ein Request mit rund einer Million doppelter Sprechgruppen-IDs
hält die serverweite SQLite-Schreibsperre über Sekunden (L57). Ein Auftrag mit zehntausenden
Empfängern läuft mit drei Anweisungen je Empfänger unter der Sperre und schreibt ein
Megabyte-`an` ins unveränderliche ETB (L58). ETB- und Auftragstexte von Megabyte-Größe bleiben
für immer im ETB, im FTS-Index und im Offline-Lagebild (L59). Zonen und Abschnittsflächen sind
nur auf `type` geprüft und können je 2 MB an jeden Lagekarten-Client tragen (L60). Dazu kommen
die Freitexte von Infotelefon, Presse und Schaden aus zwei weiteren Befunden.

Im Code gibt es schon ein gutes Dutzend Einzelprüfungen „darf höchstens … Zeichen lang sein“,
jede von Hand geschrieben. Es fehlt ein gemeinsames Muster, das ein neues Feld mitnimmt.

## What Changes

- **Gemeinsames Muster (neue Regel):** `routes::support::pflicht_max` und `optional_max`
  trimmen, zählen Zeichen (`chars().count()`) und antworten über der Grenze mit 400
  „{Feld} darf höchstens {max} Zeichen lang sein“. Die Grenzen heißen `*_MAX` und stehen im
  jeweiligen Modul. Listen von außen werden sortiert, entdoppelt und gegen ein `*_MAX`
  geprüft, bevor eine Abfrage läuft. Die Regel steht in `src/AGENTS.md`.
- **ETB:** `inhalt` höchstens 20 000 Zeichen, `von`, `an`, `veranlassung` höchstens 500, auf
  jedem Weg, auf dem Text von außen 1:1 in diese Felder gelangt (Erfassung, Berichtigung,
  Heraufstufen aus dem Chat, Meldung, Nachforderung, Vollzugsmeldung). Die Chat-Nachricht
  selbst bekommt dieselbe Inhaltsgrenze, weil das Heraufstufen auf sie zurückfällt.
- **Auftrag:** höchstens 50 Empfänger, Dubletten zusammengeführt; `auftrag_text` höchstens
  10 000 Zeichen, `extern_bezeichnung` höchstens 200, die sieben Felder des Befehlsschemas
  höchstens 2 000. Labelkarte und Anzeigenamen entstehen einmal je Request. Das ETB-`an` wird
  auf 500 Zeichen gekappt („… und N weitere“).
- **Sprechgruppen und Qualifikationen:** entdoppelt, höchstens 32 Sprechgruppen je Ziel und
  64 Qualifikationen, darüber 400. Prüfen und Schreiben brauchen eine feste Zahl von
  Anweisungen (`json_each`), unabhängig von der Listenlänge. Die Qualifikations-PATCH läuft
  künftig in `write_retry!`. Die fremde Sprechgruppe bleibt 422.
- **GeoJSON:** eine gemeinsame Prüfung für Zonen und Abschnittsflächen: Geometrie-String
  höchstens 256 KiB, höchstens 10 Ringe und 5 000 Stützpunkte, jede Position ein endliches
  `[lon, lat]` im WGS84-Bereich. Verstöße geben 400; die bestehenden 422-Zweige bleiben.
- **Infotelefon, Presse, Schaden:** Grenzen in den Routen (Werte in `design.md`, D6).
- **Frontend:** dieselben Werte in einer Datei; Eingabefelder lassen nicht mehr zu. Eine
  Zählanzeige erscheint ab 80 % der Grenze. Die ETB-Erfassung prüft vor dem Senden und vor der
  Offline-Queue. Die Lagekarte warnt beim Zeichnen über 5 000 Punkten und speichert nicht.

## Capabilities

### New Capabilities
- `eingabegrenzen`: Obergrenzen für Freitexte, Listen und Geometrien an Schreibendpunkten,
  ihre Fehlerantwort und ihr Spiegel in den Eingabemasken.

### Modified Capabilities
- keine

## Impact

- Backend: `src/routes/support.rs`, `src/routes/etb.rs`, `src/routes/chat.rs`,
  `src/routes/meldung.rs`, `src/routes/nachforderung.rs`, `src/routes/auftrag.rs`,
  `src/auftrag/eingabe.rs`, `src/auftrag/repo.rs`, `src/sprechgruppe/repo.rs`,
  `src/routes/einsatzabschnitt.rs`, `src/routes/einsatz_einheit.rs`,
  `src/routes/einsatz_fuehrungsstelle.rs`, `src/personal/repo.rs`, `src/routes/personal.rs`,
  `src/lage_zone/mod.rs`, `src/routes/infotelefon.rs`, `src/presse/repo.rs`,
  `src/routes/einsatz_schaden.rs`; Tests unter `tests/`.
- Frontend: `src/api/eingabegrenzen.ts` (neu), `components/MarkdownEditor.tsx`,
  `etb/Schnellerfassung.tsx`, `etb/MetaChip.tsx`, `etb/RufnameAbfrage.tsx`,
  `auftraege/AuftragFormular.tsx`, `chat/HeraufstufenModal.tsx`,
  `infotelefon/AnrufErfassung.tsx`, `pages/PressePage.tsx`,
  `pages/schaeden/SchadenErfassenModal.tsx`, `pages/SchaedenDetailPage.tsx`,
  `pages/schaeden/GeschaedigtPicker.tsx`, `pages/lagekarte/ZeichnenSteuerung.tsx`,
  `pages/lagekarte/useKartenInteraktion.ts`, Meldungs-, Nachforderungs- und Chat-Eingabe.
- Regeln: `src/AGENTS.md`, `frontend/AGENTS.md`.
- Sichtbar: Eingabefelder hören an der Grenze auf, kurz davor zeigt ein Zähler den Stand. Eine
  Zone mit mehr als 5 000 Punkten lässt sich nicht speichern. Sonst ändert sich für normale
  Eingaben nichts. Keine Migration, keine Änderung an Response-DTOs.
