# Proposal

## Why

Wer nach 20 Minuten an den Führungsplatz zurückkommt, muss Überblick, Lagebild und Meldebild
nacheinander lesen, um zu wissen, was brennt (LLH-1743, Thema 3 der UI/UX-Analyse vom 12.11.2026).
Jede Seite kennt nur einen Teil:
- Das Lagebild zeigt eine vermisste Person rot, der Überblick nicht.
- Rückmeldung und Ausfall stehen nur im Überblick, eine frische Sofortmeldung erreicht das Lagebild
  gar nicht.
- Der Lagemonitor kennt nur die Zahl der Sofortmeldungen.

Dazu stehen fünf Kennzahlen auf beiden Übersichten doppelt, und keine der beiden Seiten hat
eine klare Aufgabe.

## What Changes

- **Neu: Alarmzeile „Was brennt“** ganz oben auf Überblick, Lagebild und Lagemonitor.
  - Ein Eintrag je Art, nach Dringlichkeit sortiert, mindestens 16 px (Monitor 28 px), mit Sprung zur
    Stelle.
  - Alarmrolle: Sofortmeldungen ab Eingang, Bestätigung überfällig, Rückmeldung überfällig, Ausfall,
    Vermisste, Abschnitt „kritisch“, Auftrag überfällig.
  - Achtungsrolle, immer nach den roten: dringende Meldungen, fällige Erinnerungen, überfällige
    Nachforderungen. „Angespannt“ gehört nicht hinein.
  - Die Zeile hat eine feste Höhe und steht immer da.
    - Ohne Eintrag zeigt sie „Nichts brennt“.
    - Mit unvollständigen Quellen sagt sie das, statt Ruhe vorzutäuschen.
    - Was nicht passt, steht als „+n“.
- **Neu: Baustein `AlarmZeile`** in `components/instrument/`, mit einer Karte im Design System.
- **Neu: Ableitung `wasBrennt()`**. Sie kommt aus den vorhandenen Heimat-Funktionen und ist
  dieselbe für Überblick und Lagebild.
- **Modulzähler:** Er zählt offene Sofortmeldungen und dringende Meldungen, damit beide
  Übersichten diese Zahlen aus derselben Heimat lesen wie die übrigen Meldungszahlen.
- **Lagemonitor:**
  - Die Verdichtung liefert die Zählfelder der Zeile ohne Personenbezug: Zahlen sowie Namen von
    Einheiten und Abschnitten, keine Meldungs-, Auftrags- oder Erinnerungstexte.
  - Eine neue Sofortmeldung erreicht den Monitor über den Live-Kanal, nicht erst mit dem Abruftakt.
- **Rollen der Übersichten:**
  - Der Überblick heißt „Führen: was ist zu tun“. Er gibt Betroffene, Kräfte und Einsatzdauer ab;
    sein Band wird zum Führungsstand mit Aufträgen, Meldungen und Abschnitten.
  - Das Lagebild heißt „Lage: was ist los“. Es gibt die Aufträge und Meldungen seines Fußbands ab.
  - Jede Seite verweist auf die andere.
  - Die Regel kommt in `frontend/AGENTS.md`.

## Capabilities

### New Capabilities
- `lage-alarmzeile`: die Zeile „Was brennt“ mit Quellen, Rollen, Reihenfolge, fester Höhe, Daten-
  zuständen und Sprüngen, auf Überblick, Lagebild und Lagemonitor.

### Modified Capabilities
- `lage-verdichtung`:
  - Die Handlungsmengen zeigt künftig der Überblick und die Alarmzeile, nicht mehr das Fußband des
    Lagebilds.
  - Neue Anforderung: eine Heimat je Kennzahl zwischen Überblick und Lagebild (Seitenrollen).
- `modul-zaehler`: Meldungen zählen zusätzlich offene Sofortmeldungen und offene dringende Meldungen.
- `navigation-zuletzt-besucht`: Das Szenario „Kennzahl auf dem Überblick“ nennt „Offene
  Aufträge“ statt „Betroffene“; ein Eintrag der Alarmzeile zählt als Ziel auf dem Überblick.
- `einsatztauglichkeit-layout`: „Kennzahlenband hält seine Höhe“ nennt im Überblick das Band
  „Führungsstand“.
- `lagemonitor`:
  - Neue Anforderung: Alarmzeile ohne Personenbezug.
  - Neue Anforderung: Sofortmeldungen erreichen den Monitor sofort.
- `grossbild-ansicht` (Nachtrag beim Merge von LLH-1747): Das Großbild des Lagebilds zeigt
  Lagebericht und UHS aktiv unter „Stand“, ohne Aufträge und Meldungen (design.md, D8).

## Impact

- **Frontend:**
  - `components/instrument/AlarmZeile.tsx` (neu)
  - `lage/wasBrennt.ts` und `lage/useWasBrennt.ts` (neu)
  - `pages/fuehrung/UeberblickPage.tsx`, `pages/lage-dashboard/LageDashboardPage.tsx`,
    `geraet/LagemonitorPage.tsx`
  - `api/queryKeys.ts` (Monitor-Invalidierung)
  - Design-System-Generator (`PREVIEWS`) und erzeugte Dateien unter `docs/design/design-system/project/`
- **Backend:**
  - `src/einsatz/zaehler.rs`, `src/meldung/repo.rs`
  - `src/routes/lagemonitor.rs` (neue Felder)
  - `src/live/mod.rs` (Sofortmeldung an den Monitor)
  - Fixture `tests/fixtures/verdichtung/regeln.json` (Ausfall und Alarmzählung beider Sprachen)
  - Typ-Codegen: `openapi.json`, `types.generated.ts`
- **Doku und Regeln:**
  - `frontend/AGENTS.md` (Seitenrollen, Baustein, Zeile ganz oben)
  - `frontend/src/geraet/AGENTS.md` (neue Monitorfelder)
  - Anwenderkapitel Überblick, Lagebild und Lagemonitor samt Bildern
- **Keine Migration.** Die öffentliche API v1 und das Lagebild für Externe bleiben unverändert.
- **Überschneidungen:**
  - LLH-1746 (Monitor): Die Kachel „Achtung“ geht in der Zeile auf; Zonen und Überbelegung bleiben
    dort.
  - LLH-1748: Kennzahlenband des Überblicks.
