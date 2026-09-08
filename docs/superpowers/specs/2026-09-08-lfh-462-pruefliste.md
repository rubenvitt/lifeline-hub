# LFH-462 · Router-Umstellung und Befehlsentwurf

Ausgangsbasis: frisch geladenes `origin/main`, `fd435f50`. Auftrag:
[LFH-462](https://app.clickup.com/t/86cb87u35), Nachzug zu C7/N18.

## Router-Migration

`main.tsx` erzeugt den Browser-Data-Router einmal außerhalb von React. Der vollständige
Routenbaum aus `App.tsx` wird mit `createRoutesFromElements` übernommen. AuthProvider,
CommandPaletteProvider und Sitzungswache liegen im persistenten Root-Layout unter Query,
Theme und AntApp. Integrationstests verwenden dieselben Routen mit `createMemoryRouter`.

| Bereich | Prüfung / Ergebnis |
| --- | --- |
| Bestehende Routen | Innerer JSX-Routenbaum zwischen Login und Wildcard gegenüber der Basis identisch; Registry, Admin-Gruppen, Detailrouten und Settings-Kinder erhalten. |
| Anmeldung | Login kehrt mit Query und Hash zum ursprünglichen Ziel zurück; nach erneutem Routenwechsel bleibt Auth gemountet. |
| Sitzungsablauf | Root-Wache übernimmt nach Navigation die aktuelle vollständige Rückkehr-URL. |
| Lazy-Routen | `React.lazy` und vorhandene Suspense-Grenzen bleiben; Kräfteübersicht wird über den Data Router wirklich geladen. |
| Effekt-Navigation | Sitzungswache liest pathname/search/hash explizit. Die untersuchten Deeplink-Effekte lesen Parameter bzw. Auswahlzustand; kein Effekt hängt allein an einer wechselnden `navigate`-Identität. |
| Query-Deeplinks | `useQueryParamSelektion`, ETB, Personen, Schäden, UHS und Lagekarte behalten ihre bisherigen URL-Verträge. Query/Hash im selben Befehlseditor lösen keinen Verlassen-Dialog aus. |

Keine Loader-/Action-Umstellung: TanStack Query und die bestehenden API-Aufrufe bleiben
die Datenquelle. Der Data Router ermöglicht hier erstmals den Navigation-Blocker.

## Verlustschutz

Der Dialog liest den vorhandenen eigenen Änderungsmerker statt `form.isFieldsTouched()`.
„Speichern und weiter“ validiert und verwendet den vorhandenen Autosave. Ein erfolgreicher
aktueller Speicherstand setzt einen noch angehaltenen Wechsel fort. „Bleiben“ setzt den
Blocker zurück, sodass ein späterer Autosave-Erfolg nicht mehr navigiert. „Verwerfen“ führt
den Wechsel aus. Query-/Hash-Wechsel im selben Editor sind erlaubt.

Zwei im unabhängigen Review reproduzierte Speicherfälle sind zusätzlich geschlossen:

- Die Antwort eines älteren manuellen PATCH darf neue Eingaben nicht quittieren. Autosave,
  manueller Speicherknopf und Freigabe verwenden im Befehlseditor vorbereitete Quittungen
  mit dem vorhandenen Änderungszähler.
- PATCH-Aufträge desselben Editors werden in Reihenfolge ausgeführt. Noch nicht gestartete
  Aufträge entfallen nach dem Unmount, insbesondere nach „Verwerfen“. Bereits abgesandte
  Requests können weiterhin fertig werden; „Verwerfen“ ist kein serverseitiges Undo.

Fehlermeldungen halten die Autosave-Sperre nicht bis zum Schließen ihres antd-Thenables.
Der gemeinsame Hook bleibt routerunabhängig; der Lagebericht behält seinen bisherigen
Autosave-/beforeunload-Umfang.

## Prüfbelege

Alle Frontend-Kommandos verwenden `mise exec node@26.7.0 pnpm@11.10.0 -- pnpm -C frontend`.

- Baseline: `exec vitest run src/App.test.tsx src/pages/BefehlDetailPage.test.tsx src/entwurf/useEntwurfVerlustschutz.test.tsx --no-file-parallelism` → **28/28**, Exit 0.
- RED: neue Blocker-Fälle vor Implementierung → **6 fehlgeschlagen, 15 bestanden**, Exit 1; fehlender Dialog/sofortige Navigation.
- RED Review 1: `exec vitest run src/pages/BefehlDetailPage.test.tsx -t 'älteren manuellen'` → unerlaubte Navigation zur Liste, Exit 1.
- RED Reihenfolge: `exec vitest run src/pages/BefehlDetailPage.test.tsx -t 'in Reihenfolge'` → zwei gleichzeitige PATCH statt einem, Exit 1.
- RED Review 2: `exec vitest run src/pages/BefehlDetailPage.test.tsx -t 'vorgemerkten PATCH'` → zwei PATCH nach Verwerfen statt einem, Exit 1.
- GREEN gezielt: dieselben drei Dateien → **43/43**, Exit 0; Auth-Rückkehr, Lazy-Route, Blocker-Aktionen, Autosave, Validierung, Speicherfehler, Browser-Zurück und beide Review-Fixes.
- Browser: `exec playwright test e2e/befehl-navigation.spec.ts` → **2/2**, Exit 0; Persistenz nach Speicherfehler sowie Zurück/Bleiben/Verwerfen, Dialog bei 390 px mit mindestens 72 px hohen Aktionsknöpfen in Handschuh-Dichte.
- Skill: `quick_validate.py .agents/skills/dev-clickup-ausfuehren` → **Skill is valid**, Exit 0. Frischer Fetch und explizites `origin/main` als Basis sind ergänzt; ausdrückliche abweichende User-Basis bleibt möglich.

- Vollständige Vitest-Suite: **3.727/3.727 Tests in 323/323 Dateien**, Exit 0.
- Dependency-Check: **Exit 0**, keine bekannten Schwachstellen; die konfigurierte zugelassene Warnung betrifft `chacha20 0.10.1` (yanked).
- Vollständige Rust-Suite im Sammel-Gate: **2.198 bestanden, 5 ignoriert**, keine Fehler.
- Finaler Produktionsbuild (`build`, einschließlich `tsc -b`): **Exit 0**; Vite weist auf große Chunks hin.
- Frontend-Lint einschließlich der letzten Review-Änderung: **Exit 0**; antd-CLI 6.6.3 meldet an beiden UI-Dateien keine Befunde.

## Bestehende Browser-Testgrenze

Der erste vollständige Lauf von `./scripts/check-all.sh` endete mit **Exit 1** im letzten
Schritt: Playwright **136 bestanden, 2 fehlgeschlagen**. Alle vorherigen Gates bestanden.
Der Monitoring-Test blieb beim Anlegen seines Testeinsatzes auf der Auswahlseite; die drei
Tests in `e2e/meldebild-tabelle.spec.ts` bestanden anschließend isoliert ohne Codeänderung.
Die Ursache dieses einmaligen Setup-Fehlers ist damit nicht abschließend bestimmt.

Die zweite Abweichung in `e2e/uhs-hoehe.spec.ts` war reproduzierbar: nach Resize von
390 × 900 auf 390 × 844 in Handschuh-Dichte bleiben **371,34375 px**, während der bestehende
UHS-Vertrag **380 px Mindesthöhe** verlangt und Dokument-Scroll erlaubt. Der Test verlangte
trotzdem vollständiges Einpassen. Ein sauberer Archiv-Checkout von **`fd435f50`** mit eigenen,
per Frozen-Lockfile installierten Abhängigkeiten reproduzierte vor der Router-Umstellung
denselben Fehler: `exec playwright test e2e/uhs-hoehe.spec.ts -g '390px'` → **Exit 1,
8,65625 px** Abweichung.

Die Testkorrektur prüft die Unterkante gegen `max(Fenster − Polster, Oberkante + 380)` und
den Mindestboden separat. Bei ausreichendem Platz bleibt die Fenstergrenze geprüft; der
konkrete 390-px-Resize belegt ausdrücklich Platzmangel und 380 px tatsächliche Höhe. Der
UHS-Produktcode bleibt identisch. Unabhängiger Review: keine Befunde, Scroll-Korrektur und
Unterkantenprüfung bleiben wirksam. `exec playwright test e2e/uhs-hoehe.spec.ts` danach →
**4/4 bestanden, Exit 0**; Lint des geänderten Specs ebenfalls **Exit 0**.

Der zweite Volllauf bestand **137/138 Tests** und endete mit **Exit 1** an einer weiteren
Bestandsannahme in `e2e/gate1-ueberlauf.spec.ts`: Ein frisch angelegter Benutzer ohne
Verwaltungsrecht oder Einsatzmitgliedschaft hat korrekt **keine Einsätze**. Der Test wartete
auf ein sichtbares Raster; sichtbar ist dort nur die vorübergehende Skelett-Ladephase.
Auf der Basis `fd435f50` bestand der einzelne Test zunächst, scheiterte aber reproduzierbar,
nachdem vor der alten Rastererwartung ausdrücklich der fertige Leerzustand abgewartet wurde
(`exec playwright test e2e/gate1-ueberlauf.spec.ts -g '1024px komfortabel ohne Verwaltungsrecht'`,
**Exit 1**). Das Produkt blieb auch in diesem Vergleich unverändert.

Der Nicht-Admin-Zweig wartet jetzt auf „Keine Einsätze“. Die anschließenden Messungen von
Kopfzeile, Treffflächen und Überlagerung sowie die Rechteprüfung bleiben vollständig stehen.
Backend und Einsatzliste werden nicht geändert. Lint beider korrigierter Specs: **Exit 0**.

Der abschließende vollständige Browserlauf (`pnpm -C frontend e2e`, ohne Retry oder
Testauswahl) besteht **138/138 Tests, Exit 0**. Damit sind alle sieben Prüfbereiche des
Sammel-Gates bestanden; dessen ursprünglich fehlgeschlagener Browser-Schritt wurde nach
den belegten Testkorrekturen vollständig erneut ausgeführt. Die vorher bereits grünen
Rust-, Vitest- und Codegen-Prüfungen wurden für diese reinen E2E-Teständerungen nicht wiederholt.

Ein PR ist keine Integration; kein Merge ist beauftragt.

## API-Referenz

[useBlocker](https://reactrouter.com/api/hooks/useBlocker) und
[createBrowserRouter](https://reactrouter.com/api/data-routers/createBrowserRouter),
mit dem installierten React Router 8.3.0 abgeglichen.
