# Prüfliste LFH-820: Layout-Gates × Modulsperre per Override

Nachtrag zum Inventar von LFH-435
(`openspec/changes/archive/2026-09-30-lfh-435-e2e-gates-nicht-privilegiert/pruefliste.md`, eingefroren).
Dort stehen `nav-schmal` und `lage-dashboard-schmal` als „nicht rollenabhängig (Override-Achse)“.
Diese Liste ersetzt für beide Specs dieses Verdikt.

Sperre: `PUT /api/einsaetze/{id}/modul-overrides/{key}` mit `{ sichtbar: true, benoetigte_rolle: 'admin' }`,
Betrachter: Beobachter aus `e2e/rollen-kern.ts`. Für den Admin ist kein Modul gesperrt
(Admin-Ausnahme, `src/einsatz/berechtigung.rs`).

## Inventar

| Spec | Sperrzweig (Fundstelle) | gesperrt | Durchgang | Verdikt |
|---|---|---|---|---|
| nav-schmal | gesperrte Modulzeile und Sprungmarke: `disabled`, `title="Keine Berechtigung"`, Schloss statt Pfeil (`src/einsatz/ModulPanel.tsx`, `ModulListe`); im Drawer über `ModulAkkordeon.tsx`, inline über das Modulpanel (`data-lfh="modul-panel"`) | `auftraege` (Zeile „Aufträge/Befehle“), `etb` (Sprungmarke „Entscheidungen“), beide in der Kategorie Führung, die auf dem Überblick offen steht | 390 px Drawer, 1024 px inline | erfüllt |
| lage-dashboard-schmal | Kennzahlplatz „—“ mit Notiz „nicht freigegeben“ ohne Link (`src/pages/lage-dashboard/LageDashboardPage.tsx`, gesperrter Zweig im Band; `NICHT_FREIGEGEBEN` in `fuehrungsZahlen.ts`); Paneele mit „Modul … nicht freigegeben.“ (`LagePaneele.tsx`) | `personen` (Plätze „Verbleib offen“, Betroffene, Vermisste; Sichtung), `gefahrenzonen` (Matrix), `etb` (Meldungsstrom) | 1366, 1024, 390 px | erfüllt |

## Mutationsproben

Je Durchgang eine Mutation nur am Sperrzweig. Erwartung: der Durchgang mit Sperre wird rot, der
Admin-Durchgang derselben Spec bleibt grün. Die Mutation wird nie committet.

Befehle (03.10.2026, Cloud-Sitzung, Debug-Build): Mutation per Skript eingespielt, die ganze
Spec mit `playwright test <spec> --project=chromium` gefahren (Sperr- und Admin-Durchgänge
zusammen), danach `git checkout -- frontend/src`, `git diff --stat frontend/src` leer. Die
Rot-Ursache ist aus der Fehlermeldung zugeordnet.

| Durchgang | Mutation | mit Sperre | Admin |
|---|---|---|---|
| nav-schmal 390 + 1024 (N1) | Schloss-Hülle im gesperrten Zweig von `ModulListe` (Modulzeile und Sprungmarke) `minWidth: 2000` | rot: 390 „Drawer-Körper: Inhalt breiter als der Kasten (2045/280 px)“, 1024 „Navigationsrahmen ragt auf 1024 px über“ | 4 grün |
| nav-schmal 390 + 1024 (N2) | `disabled={gesperrt}` → `disabled={false}` (beide Stellen) | rot an der Vorbedingung („Aufträge/Befehle“ gesperrt) | 4 grün |
| lage-dashboard-schmal 1366/1024/390 (D1) | gesperrter Kennzahlplatz: Wert als Span mit `minWidth: 2000` | rot ×3 („Band: Inhalt breiter als die Fläche“) | 3 grün |
| lage-dashboard-schmal 1366/1024/390 (D2) | `return z === 'gesperrt' ? (` → `return false ? (` | rot ×3 an der Vorbedingung („drei Plätze ohne Freigabe“) | 3 grün |

**Befund aus N1, behoben im Test:** In der ersten Fassung blieb der 390-px-Durchgang unter N1
grün. Der Drawer-Körper klippt (`overflow-x` ≠ `visible`), deshalb überging `messeUeberlauf` die
Schloss-Hülle. Ein Knopf mit `width: 100%` wächst außerdem nicht mit seinem Inhalt, also
bestand auch der Vergleich der Knopfkante mit dem Drawer. Jetzt misst der Durchgang innen
(`keinInnererUeberlauf`: Drawer-Körper und jede gesperrte Zeile, `scrollWidth` ≤ `clientWidth`
+ 1), der 1024-px-Durchgang ebenso für Modulpanel und Zeilen. Ein Produktfehler lag nicht vor.

## Laufzeit

Befehl: `playwright test <beide Specs> --project=chromium --workers=2 --reporter=dot`. „Vorher“
sind die Specs aus `origin/alpha` (`1fcd591`), als Kopie im selben Lauf-Umfeld gefahren.

| Stand | Tests | Dauer |
|---|---|---|
| vorher (`origin/alpha`) | 7 grün | 35,3 s |
| nachher | 12 grün | 57,7 s |

Plus rund 22 s für fünf Tests: Jeder legt einen Einsatz und einen Benutzer an und wechselt die
Sitzung. Die Maschinenlast lag bei 4 Kernen um 6, die Zahlen sind deshalb nur grob vergleichbar.
Die Shard-Zahl bleibt.

## Läufe

- Sperr-Durchgänge wiederholt: `nav-schmal` `--repeat-each=3` (6 von 6 grün),
  `lage-dashboard-schmal` `--repeat-each=2` (6 von 6 grün).
- Beide Specs vollständig: 12 von 12 grün.
- Browser in der Cloud-Sitzung: vorinstalliertes Chromium 1194 über einen Symlink-Pfad
  (`PLAYWRIGHT_BROWSERS_PATH` im Scratchpad), weil das Repo Playwright 1.62 (Chromium 1234) pinnt.
  Den Gesamtlauf `check-all.sh` mit dem gepinnten Werkzeugstand trägt die CI des PRs.
