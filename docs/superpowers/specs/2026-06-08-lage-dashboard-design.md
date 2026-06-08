# Lage-Dashboard — Design (LFH-47)

**Status:** Freigegeben (Brainstorming abgeschlossen 2026-06-08)
**Modul:** `lage-dashboard` (Kategorie `lage`)
**Ziel:** Verdichtete Lageübersicht eines Einsatzes; Default-Landing-Page von `/einsaetze/:id`.

## Kontext & Zweck

Das Modul `lage-dashboard` ist in `frontend/src/einsatz/modulRegistry.ts:71` mit Status
`geplant` registriert. Es soll die verdichtete Lageübersicht des Einsatzes zeigen und ist das
gewünschte Default-Ziel der Route `/einsaetze/:id`. Der Default-Redirect
(`frontend/src/einsatz/DefaultModulRedirect.tsx`) nutzt `redirectZiel()`
(`modulRegistry.ts:103`), das auf `lage-dashboard` umschaltet, **sobald dessen Status `fertig`
ist** — bis dahin Fallback auf ETB. Das Setzen des Status + Registrieren der Page aktiviert die
Landing-Page also automatisch.

Da dies künftig die **erste Seite jedes Einsatzes** ist — auch eines brandneuen mit null Daten —
muss der Leerzustand absichtsvoll wirken und die Seite sich schnell anfühlen.

## Layout: Führungs-Cockpit

Gewählte Richtung (von 3 Mockups): **Leitzahlen-Leiste oben (der „Puls"), darunter thematische
Bereiche mit voller Aufschlüsselung.** Kacheln sind Deep-Links ins jeweilige Fachmodul.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Lage-Kopf: Bezeichnung · Stichwort · Status · EL · seit HH:MM (Dauer)  │
├──────────────────────────────────────────────────────────────────────┤
│  Kräfte │ Patienten │ Vermisst │ Warnstufe │ Schäden offen │ UHS aktiv │  ← Leitzahlen-Leiste
├──────────────────────────────────────────────────────────────────────┤
│ Betroffene (SK-Split + Status) │ Kräfte-Status │ Infrastruktur (UHS/   │
│                                │               │ Schäden/Tiere)        │
├──────────────────────────────────────────────────────────────────────┤
│ Aktueller Lagebericht          │ Aufträge (Platzhalter)                │
└──────────────────────────────────────────────────────────────────────┘
```

UI auf **Ant Design v5** (wie der Rest der App). `Statistic`, `Card`, `Tag`, `Space`. Konsistenz,
Informationsdichte und Status-Farb-Legibilität haben Vorrang vor eigenständigem Stil.

## Integration

- **`modulRegistry.ts:71`**: Status `geplant` → `fertig`. Aktiviert `redirectZiel()` → Default-Route.
- **`App.tsx:42` (`MODUL_ELEMENTE`)**: Eintrag `'lage-dashboard': <LageDashboardPage />`,
  lazy via `Suspense` (Muster wie `lagekarte`/`kraefteuebersicht`, `App.tsx:55–64`).
- **Routing**: keine manuelle Route nötig — `modulRegistry.map(...)` (`App.tsx:83`) erzeugt sie.
- **Berechtigung**: keine `benoetigteRolle` (read-only, wie übrige Lage-Module). Keine Mutationen.

## Komponentenstruktur

Verzeichnis `frontend/src/pages/lage-dashboard/`:

| Komponente | Aufgabe | Abhängigkeiten |
|---|---|---|
| `LageDashboardPage.tsx` | Orchestriert Queries + `useEinsatzLiveStream`, Loading/Error/Permission, rendert Bereiche | React Query, API-Clients, Verdichtung |
| `KennzahlenLeiste.tsx` | Leitzahlen-Leiste, jede Zahl Deep-Link | Verdichtungs-View-Model, `useNavigate` |
| `BetroffeneKachel.tsx` | SK-Split (I–IV/tot/unverletzt) + Personen-Status | SK-Farben aus `PersonenPage` |
| `KraefteKachel.tsx` | Stärke F/UF/M, Status-Kategorie, Einheiten/Abschnitte | `kraeftebild.ts` |
| `InfrastrukturKachel.tsx` | UHS Anzahl/Status, Schäden, Tiere | — |
| `LageberichtKachel.tsx` | Aktuellster Lagebericht (Titel/Zeitstand/Status/Ersteller) | — |
| `AuftraegeKachel.tsx` | Platzhalter „kommt mit Aufträge-Modul" | — |
| `lageVerdichtung.ts` | **Reine Funktionen**: Rohdaten → View-Model. Isoliert unit-testbar | nur Typen |

Jede Kachel ist klein, fokussiert und einzeln verständlich. Die Verdichtungslogik ist von der
Darstellung getrennt (reine Funktionen) — Kern der Testbarkeit.

## Datenquellen & Verdichtung

Alle Daten existieren bereits im T1-Frontend; das Dashboard ist eine **Zusammenstellung +
Aggregation** vorhandener Queries. Query-Keys **müssen identisch** zu denen in
`useEinsatzLiveStream` sein, damit Live-Invalidierung greift.

| Leitzahl / Bereich | Quelle | Verdichtung |
|---|---|---|
| Einsatz-Kopf | `ladeEinsatz` (`einsatz`) | Stammdaten direkt |
| Kräfte (Stärke F/UF/M, Status) | `einsatz-personal`, `einsatz-fahrzeuge`, `einsatz-einheiten`, `einsatz-material` | Wiederverwendung `kraeftebild.ts` |
| Einheiten / Abschnitte (Anzahl) | `einsatz-einheiten`, `einsatz-abschnitte` | Zählung |
| **Patienten** (Leitzahl) | `einsatz-personen` | Personen mit `aktuelle_sichtung ∈ {sk1,sk2,sk3,sk4}` |
| SK-Split | `einsatz-personen` | Zählung je `aktuelle_sichtung`; `tot`/`unverletzt` separat |
| **Vermisst** (Leitzahl) | `einsatz-personen` | `status === 'vermisst'` |
| Personen-Status | `einsatz-personen` | Zählung je `status` |
| Tiere | `einsatz-tiere` | Zählung je `status` (aktiv/vermisst/abgeschlossen). **Nicht live** (s. u.) |
| UHS (Anzahl + Status) | `einsatz-uhs` | Zählung gesamt + je Status. **Keine Platz-Belegung** (vermeidet N+1) |
| Schäden | `einsatz-schaeden` | Zählung je Status (offen/uebergeben/abgeschlossen); `offen` als Leitzahl |
| **Höchste Warnstufe** (Leitzahl) | `gefahrenmatrix` | Maximum ordinal `keine<niedrig<mittel<hoch<akut` |
| Gefahren-/Absperrzonen (Anzahl) | `einsatz-zonen` | Zählung |
| Aktueller Lagebericht | `einsatz-lageberichte` | Neuester nach `erstellt_at` |
| **Aufträge** | — | **Keine Datengrundlage** → Platzhalter-Kachel |

### Domänen-Enums & Farben (wiederverwenden, nicht neu definieren)

- **Sichtungskategorie**: `sk1|sk2|sk3|sk4|tot|unverletzt`. Farb-/Label-Mapping aus
  `frontend/src/pages/PersonenPage.tsx:15` (SK I rot, SK II gold, SK III grün, SK IV blau,
  tot schwarz, unverletzt default). Mapping in geteiltes Modul ziehen, damit Dashboard +
  PersonenPage dieselbe Quelle nutzen.
- **PersonStatus**: `erfasst|vermisst|betroffen|verstorben|abgemeldet` (`PersonenPage.tsx:45`).
- **Warnstufe**: `keine|niedrig|mittel|hoch|akut`. Farben aus
  `frontend/src/pages/gefahren/gefahrenSchema.ts:55`.
- **StatusKategorie**: `verfuegbar|gebunden|nicht_verfuegbar` (grün/orange/rot,
  `StatusKatalogTab.tsx`).
- **SchadenStatus**: `offen|uebergeben|abgeschlossen`; **Ausmass**: `gering|mittel|gross|katastrophal`.
- **TierStatus**: `aktiv|vermisst|abgeschlossen`.

## Verhalten

- **Live-Aktualisierung**: `useEinsatzLiveStream(einsatzId)` invalidiert die Query-Keys; React
  Query refetcht; Zahlen aktualisieren sich reaktiv. **Kein** manueller Refresh-Button. Dezenter
  „Stand HH:MM"-Indikator.
- **Eine SSE-Verbindung pro Einsatz** (Pflicht, HTTP/1.1-6-Limit) — `useEinsatzLiveStream` deckt
  das ab; keine zusätzlichen EventSource-Streams öffnen.
- **Tiere nicht live**: `useEinsatzLiveStream` kennt kein `tier`-Event und invalidiert
  `einsatz-tiere` nicht (Backend-Lücke). Die Tiere-Zahl aktualisiert sich daher nur bei
  Mount/Refetch, nicht in Echtzeit. Bewusst nicht im Scope dieses Tasks — bräuchte ein
  Backend-`tier`-Event; bis dahin ist das Cockpit für alle übrigen Kacheln live, für Tiere nicht.
- **Leerzustand** (neuer Einsatz, null Daten): Nullzahlen bzw. „—" dezent, **kein Sonder-Layout**.
  Wirkt wie ein sauberes leeres Cockpit, nicht kaputt.
- **Fehler-Resilienz**: Einsatz-Stammdaten sind der Anker — schlägt diese Query fehl,
  Vollseiten-Fehler. Einzelne Domänen-Query-Fehler betreffen **nur die jeweilige Kachel** („—"/
  Fehlerhinweis); der Rest des Dashboards bleibt stehen. (Eine Landing-Page darf nicht komplett
  leer werden, weil z.B. die Gefahrenmatrix-Query scheitert.)
- **Navigation**: Kacheln/Leitzahlen sind Deep-Links via `useNavigate` relativ (`../<route>`),
  z.B. Betroffene → `personen`, Kräfte → `kraefteuebersicht`, Warnstufe → `gefahren`, Schäden →
  `schaeden`, UHS → `unfallhilfsstellen`, Tiere → `tiere`, Lagebericht → `lageberichte`.

## Tests (TDD)

- **Unit `lageVerdichtung`**: SK-Zählung, Warnstufen-Ordinalität (Maximum), neuester Lagebericht,
  Kräfte-Aggregation, Schäden/Tiere/UHS-Zählung — inkl. **Leer-/Null-Fälle** (keine Personen,
  keine Gefahren, keine Lageberichte).
- **Komponente `LageDashboardPage`**: Loading, Vollseiten-Fehler (Einsatz-Anker), befüllter
  Zustand, Leerzustand, einzelner Kachel-Fehler bei sonst intakter Seite, Deep-Link-Klick navigiert.
- **`modulRegistry.test.ts`**: `redirectZiel()` liefert `lage-dashboard` bei Status `fertig`
  (bestehenden Test anpassen).
- Testsuite-Gate unter Last via `--no-file-parallelism` (Projekt-Konvention).

## Nicht im Scope

- **Aufträge-Kachel mit echten Daten** — kein Backend (`auftraege`-Modul `geplant`). Nur Platzhalter.
- **UHS-Platz-Belegung** (belegte/freie Plätze gesamt) — vermeidet N+1; bleibt im UHS-Modul.
  Falls später gewünscht: Backend-Aggregat-Endpoint als eigener Task.
- Keine neuen Backend-Endpoints; rein Frontend-Aggregation bestehender Queries.
- Keine PDF-/Export-Funktion.

## Offene Detailpunkte für die Umsetzung

- Konkretes Styling/Spacing der Cockpit-Leiste (innerhalb antd) — beim Bauen festzurren.
- Exaktes Format des „Stand"-Indikators und der Einsatzdauer-Anzeige.
