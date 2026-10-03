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
| nav-schmal | gesperrte Modulzeile und Sprungmarke: `disabled`, `title="Keine Berechtigung"`, Schloss statt Pfeil (`src/einsatz/ModulPanel.tsx`, `ModulListe`); im Drawer über `ModulAkkordeon.tsx`, inline über das Modulpanel (`data-lfh="modul-panel"`) | `auftraege` (Zeile „Aufträge/Befehle“), `etb` (Sprungmarke „Entscheidungen“), beide in der Kategorie Führung, die auf dem Überblick offen steht | 390 px Drawer, 1024 px inline | offen |
| lage-dashboard-schmal | Kennzahlplatz „—“ mit Notiz „nicht freigegeben“ ohne Link (`src/pages/lage-dashboard/LageDashboardPage.tsx`, gesperrter Zweig im Band; `NICHT_FREIGEGEBEN` in `fuehrungsZahlen.ts`); Paneele mit „Modul … nicht freigegeben.“ (`LagePaneele.tsx`) | `personen` (Plätze „Verbleib offen“, Betroffene, Vermisste; Sichtung), `gefahrenzonen` (Matrix), `etb` (Meldungsstrom) | 1366, 1024, 390 px | offen |

## Mutationsproben

Je Durchgang eine Mutation nur am Sperrzweig. Erwartung: der Durchgang mit Sperre wird rot, der
Admin-Durchgang derselben Spec bleibt grün. Die Mutation wird nie committet.

| Durchgang | Mutation | Befehl | mit Sperre | Admin |
|---|---|---|---|---|

## Laufzeit

| Stand | Befehl | Dauer |
|---|---|---|

## Läufe
