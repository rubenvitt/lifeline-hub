# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/rwfa43cyna7ft2bpwj0kclvc (LLH-1744, Teil von LLH-1717
„Was brennt“, Welle 3)

## Why

Für denselben Abschnitt zeigen die Flächen verschiedene Stärken. Der Unterabschnitt „UHS Turnhalle“
(EA 1.1) zeigt in Gliederung und Organigramm „0/0/0//0 · 1 Einheit direkt“. Die Sanitätsgruppe UHS,
die dort arbeitet, steht im Meldebild mit 0/1/1//2, und Lagebild und Monitor nennen „3 Kräfte“.
Im Meldebild steht außerdem „20 von 20 Kräften“ neben „12 Kräfte“.

Ursachen (am Code bestätigt):

- Ein Abschnitt zählt heute nach der **Unterstellung**: Eine Untereinheit zählt beim Abschnitt ihrer
  obersten Einheit (Spec `lage-verdichtung`). Die Sanitätsgruppe gehört zum Zug in EA 1 und zählt
  deshalb dort, obwohl sie in EA 1.1 eingesetzt ist. Die Einheitenzahl am Knoten zählt dagegen die
  eigene Zuordnung. Wer EA 1.1 führt, sieht so null Kräfte, obwohl zwei dort arbeiten.
- „20 von 20 Kräften“ zählt Personal und Fahrzeuge zusammen (12 + 8); überall sonst sind „Kräfte“
  Köpfe.
- „3 Kräfte“ ist eine andere Achse: Personal, das an einer UHS arbeitet, darunter der Notarzt der
  Rettungsstaffel. Das Lagebild zählt dabei nur aktive UHS, der Monitor auch geplante.

## What Changes

- **Ein Abschnitt zählt, wer in ihm steht** (Entscheidung 16.11.2026). Jede aktive Einheit zählt mit
  ihrer **eigenen** Stärke bei ihrem wirksamen Abschnitt, also dem eigenen oder, ohne eigenen, dem
  ihrer nächsten Obereinheit. Das ist dieselbe Regel wie im Bereitstellungsraum (LLH-1289). EA 1.1
  zeigt dann 0/1/1//2. „Stärke inkl. Unterabschnitte“ von EA 1 bleibt gleich. Die Stärke von EA 1
  allein sinkt um die Gruppe. **BREAKING** für die gezeigten Zahlen eines Abschnitts, dessen
  Einheiten einer Einheit in einem anderen Abschnitt unterstellt sind.
- Gliederung, Abschnittsdetail, Abschnittsvorschau, Abschnittsansicht am Gerät, Organigramm,
  Meldebild und Überblick rechnen die Abschnittsstärke aus **einer** Funktion.
- **Meldebild:** Eine Untereinheit, die in einem anderen Abschnitt steht als ihre Obereinheit
  („abgestellt“), steht als eigene Zeile unter ihrem Abschnitt, mit dem Zusatz „aus <Obereinheit>“.
  Die Zeile der Obereinheit zählt sie nicht mehr mit. So ergibt sich jede Abschnittszeile weiter aus
  ihren Kindern, und jede Kraft steht einmal. Der Filter „Abschnitt“ folgt dem wirksamen Abschnitt
  der Einheit statt dem ihrer obersten Einheit.
- **Abschnittsdetail:** „Zugeordnete Einheiten“ listet die Einheiten mit diesem wirksamen Abschnitt.
  Jede steht mit ihrer eigenen Stärke da, sodass die Liste die Stärke des Abschnitts ergibt. Die
  Zahl „n Einheiten direkt“ am Gliederungsknoten zählt dieselbe Menge.
- **Meldebild-Zeile:** „12 von 12 Kräften · 8 von 8 Fahrzeugen“ statt „20 von 20 Kräften“.
- **UHS-Kräfte zählen nur an aktiven UHS**, im Lagebild wie im Monitor (eine Funktion). Das Lagebild
  nennt sie „n Kräfte an UHS“.
- Projektregel „Eine Heimat je Zahl“ (`frontend/AGENTS.md`) und Anwenderdoku nachgezogen.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lage-verdichtung`: Die Anforderung „Stärke zählt jede Einheit höchstens einmal“ wechselt von der
  Unterstellung zum wirksamen Abschnitt. Neu ist die Anforderung „Kräfte heißt Köpfe, UHS-Kräfte nur
  an aktiven UHS“.
- `kraeftebaum`: Eine abgestellte Untereinheit steht im Meldebild unter ihrem eigenen Abschnitt, nicht
  unter ihrer Obereinheit.

## Impact

- Frontend:
  - `pages/einsatzabschnitte/abschnittStaerke.ts`, `pages/EinsatzabschnittePage.tsx`,
    `pages/einsatzabschnitte/AbschnittKnoten.tsx`, `pages/einsatzabschnitte/fuehrungsorganisation.ts`
  - `kraefte/kraeftebaumKern.ts` (`einheitenBaum`, `abschnittDerObersten` entfällt) und
    `kraefte/kraeftebild.ts` (Baum, Filter)
  - `pages/KraefteuebersichtPage.tsx` (Zeile „n von m“)
  - `pages/lage-dashboard/lageVerdichtung.ts`, `pages/lage-dashboard/LageDashboardPage.tsx`
  - `geraet/LagemonitorPage.tsx`
  - `pages/fuehrung/ueberblickDaten.ts` folgt über `baueKraeftebild` ohne eigenen Code
- Tests: Fixture `tests/fixtures/verdichtung/regeln.json` (`erwartet_abschnitte`, neu
  `abgestellt`), `lage/verdichtungFixture.test.ts`, `kraeftebild.test.ts`, `kraeftebaumKern.test.ts`,
  `abschnittStaerke`-, Organigramm-, Lagemonitor- und Dashboard-Tests. Die Rust-Seite der Fixture
  prüft nur `ist_kumuliert`, ihre Erwartung bleibt.
- Regeln: `frontend/AGENTS.md` („Eine Heimat je Zahl“, „Eine Baumlogik der Kräfte“, Organigramm).
- Anwenderdoku: `meldebild.md`, `einsatzabschnitte.md`, `lagebild.md` (falls die Notiz dort steht),
  Bilder, wo die Zahl sichtbar ist.
- Kein Backend, keine Migration, keine API-Änderung.
