## 1. Server: aufsteigender Cursor (D2)

- [x] 1.1 Test zuerst (`src/etb/repo.rs`): `after_lfd_nr` liefert die Einträge direkt über dem Cursor absteigend, am oberen Ende die restlichen, mit Filter nur passende.
- [x] 1.2 Test zuerst (`tests/`): `GET …/etb?after_lfd_nr=…` liefert dieselbe Seite über die Route; `before_lfd_nr` und `after_lfd_nr` zusammen → 422; `zaehler`/`anzahl` ignorieren den Parameter.
- [x] 1.3 Test: In einem Einsatz wächst `id` mit `lfd_nr` (Grundlage von D4).
- [x] 1.4 `EtbAbfrageParams.after_lfd_nr`, `EtbFilter.after_lfd_nr`, `abfrage` (aufsteigend lesen, absteigend liefern), Validierung. Mutationsprobe: Umdrehen weglassen → 1.1 rot.

## 2. Frontend: Seitenfenster (D1, D3)

- [x] 2.1 Tests zuerst (`api/etb.test.ts` bzw. neues `etb/seitenfenster.test.ts`): Parameterfunktionen für Kopf, volle und kurze Seiten beider Richtungen, leere Seiten; `listeEtb` schickt `after_lfd_nr`.
- [x] 2.2 Test zuerst (`pages/EtbPage.test.tsx`): Deeplink 30 Seiten tief, danach ein `etb`-Ereignis → höchstens 5 Aufrufe von `listeEtb`.
- [x] 2.3 Test: „Neuere laden“ fehlt am Kopf, erscheint im tiefen Fenster und führt lückenlos bis zum neuesten Eintrag zurück.
- [x] 2.4 `api/etb.ts` (`after_lfd_nr`, Seitenparameter-Typ und -Funktionen), `EtbPage` (`maxPages`, `getPreviousPageParam`, Knopf „Neuere laden“). Mutationsprobe: `maxPages` entfernen → 2.2 rot.

## 3. Frontend: Sprung im Fenster (D4)

- [x] 3.1 Tests zuerst (`EtbPage.test.tsx`): Ziel 30 Seiten tief wird hervorgehoben und bleibt im Fenster; Ziel über einem tiefen Fenster lädt neuere Seiten und wird hervorgehoben; Ziel, das es nicht gibt, räumt den Parameter.
- [x] 3.2 Deeplink-Effekt mit Richtung aus der Kennung. Mutationsprobe: nur `fetchNextPage` → zweiter Fall aus 3.1 rot.

## 4. Frontend: gemerktes Rendern (D5)

- [x] 4.1 Tests zuerst (`etb/EtbZeitachse.test.tsx`, `pages/EtbPage.test.tsx`): Rerender mit unveränderten Einträgen rendert keine Zeile und kein `Markdown` neu (Zähler per `vi.mock`); ein neuer Eintrag parst nur seinen Text.
- [x] 4.2 `Markdown` mit `memo` und Modulkonstante; `EtbZeitachsenZeile` mit `memo`; `useMemo` für Zufluss, Gruppen, `eintraege`, `chronologie`; stabile Handler. Mutationsprobe: `memo` an der Zeile entfernen → 4.1 rot.

## 5. Frontend: Fensterung (D6)

- [x] 5.1 Klasse für die Stundengruppe mit `content-visibility: auto` und `contain-intrinsic-size`; Test, dass jede Gruppe sie trägt und Zeilenmarke, Zeilenklasse und `h2` bleiben.

## 6. Frontend: Viewport-Store (D7)

- [x] 6.1 Tests zuerst (`components/useViewport.test.tsx`): 100 `Zeitachseneintrag` registrieren höchstens 8 Hörer; nach dem Aushängen 0; Breiten- und Zeigerwechsel erreichen alle Fragenden; bestehende Fälle bleiben unverändert grün.
- [x] 6.2 Store in `useViewport.ts` (Abfragen aus `theme.getDesignToken()`, `useSyncExternalStore`, stabiler Snapshot). Mutationsprobe: Hörer je Abonnent statt je Store → 6.1 rot.

## 7. e2e und Messung

- [x] 7.1 Neues Gate (`e2e/etb-seitenfenster.spec.ts`): Deeplink auf einen alten Eintrag (mehr als 5 Seiten tief), Ziel im Bild und hervorgehoben, „Neuere laden“ erreichbar und klickbar; als Admin und als Beobachter über `e2e/rollen-kern.ts`; 390/820/1180/1440.
- [x] 7.2 `etb-chronologie`, `leisten-flaeche`, `fokus-verdeckung`, `lagebild-offline-deeplink` grün halten.
- [x] 7.3 Vorher/nachher messen (Listenabrufe je `etb`-Ereignis nach tiefem Sprung, Render-Dauer bei 1 000 Einträgen) und im PR festhalten; `maxPages` danach bestätigen oder anpassen.

## 8. Regeln und Abschluss

- [x] 8.1 `frontend/src/etb/AGENTS.md`: Seitenfenster, „Neuere laden“, Sprung mit Richtung; Dateikopf `useViewport.ts` und `frontend/AGENTS.md` zum Hörersatz, falls dort Regeln stehen.
- [x] 8.2 Lint, Typecheck, Vitest der berührten Dateien, Rust-Tests der ETB.
- [x] 8.3 `./scripts/check-all.sh` (Bündel `schnell`, Rust, Vitest; e2e der ETB-Specs).

## Messung (jsdom, 3 000 Einträge, Sprung auf Nr. 50; Render über 1 000 Einträge)

| | vorher | nachher |
| --- | --- | --- |
| Listenabrufe für den Sprung | 30 | 30 |
| Zeilen im DOM nach dem Sprung | 3 000 | 500 |
| Listenabrufe je `etb`-Ereignis danach | 30 | 5 |
| Erstes Rendern, 1 000 Zeilen | 6 813 ms | 5 590 ms |
| Rerender (Median), 1 000 Zeilen | 1 672 ms | 32 ms |
| `matchMedia`-Abfragen beim Rendern / Hörer | 9 000 | 8 / 8 |

`maxPages` bleibt bei 5. Mutationsproben: Umdrehen weglassen → 1.1 rot (2 Fälle); `maxPages`
entfernen → 2.2 rot; Sprung nur über `fetchNextPage` → 3.1 zweiter Fall rot; `Markdown` ohne
`memo` → 4.1 rot (beide Fälle); Hörer je Abonnent statt je Store → 6.1 rot.
