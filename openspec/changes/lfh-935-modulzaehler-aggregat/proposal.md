# Proposal

## Why

Der Modulzähler des Einsatz-Navigationsrahmens zählt Meldungen, Aufträge, Erinnerungen und Chat
über die vollen Listenfunktionen. Jeder Abruf lädt damit alle Meldungen samt Text und
Benutzernamen, alle Aufträge samt Empfängern, alle Erinnerungen und den ganzen Chat-Bestand, nur
um daraus vier bis sieben Zahlen zu bilden. Der Zähler ist in jedem Einsatz-Tab gemountet und
lädt bei fast jedem Live-Ereignis neu. In einer Großschadenslage über mehrere Tage (etwa 1.500
Meldungen, 400 Aufträge, 5.000 Chat-Nachrichten, 25 offene Tabs) wächst die Last mit Bestand ×
Tabs × Ereignisrate. Auf einem schwachen Einsatzserver werden dann die Navigationszähler träge,
und Schreiber sehen Latenzspitzen.

## What Changes

- **Zählen statt Listen laden:** Der Server zählt jedes Kommunikationsmodul mit genau einer
  Abfrage, deren Zahl nicht vom Bestand abhängt. Er lädt dafür weder Meldungstexte noch
  Benutzernamen noch Auftragsempfänger.
- **Dieselben Prädikate wie die Listen:** „offen“, „überfällig“, „bestätigt“ (Meldung),
  „Bearbeitungsstatus“ und „überfällig“ (Auftrag), „fällig“ (Erinnerung) und „ungelesen“ (Chat)
  stehen je einmal als SQL-Fragment. Liste und Zählung setzen sich daraus zusammen. Die
  Zählregeln darüber bleiben die reinen Funktionen, die das gemeinsame Fixture an die
  Client-Regeln bindet.
- **Zählerabruf je Burst einmal:** Live-Ereignisse frischen den Modulzähler in einem eigenen
  Sammelfenster von 1 s auf. Die Listen bleiben beim Fenster von 300 ms. Ein Burst von
  Ereignissen kostet je Tab höchstens einen Zählerabruf je Sekunde.
- Die Zählwerte und die Antwort des Endpunkts bleiben unverändert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `modul-zaehler`: Der Zählerabruf lädt keine Listen und kommt mit einer festen Zahl an Abfragen
  aus. Live-Ereignisse frischen den Zähler höchstens einmal je Sekunde auf.
- `live-abgleich`: Das Sammelfenster der Modulzähler ist länger als das der Listen.

## Impact

- Backend: `src/einsatz/zaehler.rs`, `src/meldung/repo.rs`, `src/auftrag/repo.rs`,
  `src/erinnerung/repo.rs`, `src/chat/repo.rs`; Tests in `tests/modul_zaehler.rs`.
- Frontend: `frontend/src/live/liveInvalidierung.ts`, `frontend/src/live/useEinsatzLiveStream.ts`
  samt Tests.
- Regeln: `frontend/AGENTS.md` (Query-Key-Registry), `frontend/src/etb/AGENTS.md` (Modulzähler).
- Keine Migration, keine API- oder DTO-Änderung.
