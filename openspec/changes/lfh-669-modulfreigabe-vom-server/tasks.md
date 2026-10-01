# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Commits und PR nennen `LFH-669`.

## 1. Backend: eine Auswertung, ein Endpunkt

- [x] 1.1 `src/einsatz/berechtigung.rs`: `ModulFreigabe { sichtbar, zugriff }` und die reine Funktion `modul_freigabe(overrides, org_defaults, key, benutzer)` nach design.md D2. `fordere_modul_zugriff` delegiert an `zugriff`, `erlaubte_module` filtert darauf, das Laden beider Maps liegt in einer gemeinsamen Hilfsfunktion. Verifiziert durch neue Unit-Tests je Spec-Szenario (Org-Vorgabe sperrt, Override geht vor, Führungskraft, nicht ausblendbar, ausgeblendet für Mitglied und Admin) und die unveränderten bestehenden Tests von `fordere_modul_zugriff`/`erlaubte_module`. Mutationsprobe: `sichtbar` testweise an den Admin koppeln, Test „ausgeblendet für Admin“ wird rot
- [x] 1.2 Handler `modul_freigaben_laden` in `src/routes/einsatz.rs` (`EinsatzLesezugriff`, kein Modul-Gate), Route in `src/app.rs`, `PFAD_KEY`-Eintrag mit `None` samt Kommentar wie bei `modul-zaehler`, `utoipa`-Pfad in `src/api_doc.rs`. Verifiziert durch einen Integrationstest in `tests/modul_freigaben.rs`: 200 mit allen `MODUL_KEYS`, Org-Vorgabe `fuehrungskraft` ergibt für ein Mitglied `zugriff: false` **und** 403 am Listen-Endpunkt desselben Moduls (Gleichlauf), 403 ohne Lesezugriff, 404 bei unbekanntem Einsatz. Dazu der Struktur-Guard `tests/einsatz_kontext_guard.rs` grün
- [x] 1.3 `scripts/check-typ-codegen.sh` ausführen, `frontend/src/api/openapi.json` und `frontend/src/api/types.generated.ts` mitcommitten, `ModulFreigabe`/`ModulFreigaben` im Barrel `frontend/src/api/types.ts`. Verifiziert durch das Skript ohne Diff

## 2. Frontend: Gate liest die Freigaben

- [x] 2.1 `api/einsaetze.ts`: `ladeModulFreigaben(id)`. `api/queryKeys.ts`: `EINSATZ_KEYS.modulFreigaben = 'einsatz-modul-freigaben'`, Accessor mit argumentlosem Prefix, Eintrag in `NICHT_LIVE_KEYS` mit Begründung, in `LAGEBILD_OFFLINE` statt `modulOverrides` (design.md D5). Verifiziert durch `queryKeys.test.ts` (Wire-Literal), `queryKeys.guard.test.ts` und `lagebildOffline.guard.test.ts` grün
- [x] 2.2 `einsatz/modulRegistry.ts`: Gate-Funktionen nach design.md D3 (`ModulFreigaben`, ohne `benutzer`, unbekannt heißt nicht freigegeben, Navigation bei unbekannt ungesperrt), `benoetigteRolle` aus `ModulEintrag` entfernen. Verifiziert durch umgebaute `modulRegistry.test.ts`: gesperrt, ausgeblendet, Admin mit ausgeblendetem Modul (`sichtbar: false, zugriff: true` gilt als nicht freigegeben und unsichtbar), unbekannt. `pnpm typecheck` listet danach die Konsumenten für Gruppe 3
- [x] 2.3 Rahmen: `EinsatzLayout.tsx`, `ModulPanel.tsx`, `useModulZaehler.ts`, `useAktiveWarnung.ts` auf `ladeModulFreigaben`/`ModulFreigaben` umstellen. Verifiziert durch `ModulPanel.test.tsx` (Modul mit `zugriff: false` zeigt Schloss und „Keine Berechtigung“, `sichtbar: false` fehlt), `EinsatzLayout.test.tsx` (Rail-Sprung überspringt gesperrtes Modul), `useModulZaehler.*.test.tsx`, `useAktiveWarnung.test.tsx` grün

## 3. Frontend: Konsumenten

- [x] 3.1 Sprungpalette: `useDatensaetze.ts`, `datensaetze.ts`, `befehle.ts`, `useBefehle.ts`, `useKoordinatenSprung.ts`, `typen.ts` (Kontextfeld `freigaben` statt `overrides`/`benutzer` fürs Gate). Vorher `frontend/src/command-palette/AGENTS.md` lesen. Verifiziert durch die Tests unter `command-palette/` grün, dazu ein neuer Fall: gesperrtes Modul liefert weder Befehl noch Datensatz
- [x] 3.2 Stab: `useStabFreigabe.tsx`, `werkzeuge.ts`, `VorbereitungPaneel.tsx`, `pages/StabPage.tsx`, `pages/FunkplanPage.tsx`, `pages/InfotelefonPage.tsx`. Vorher `frontend/src/stab/AGENTS.md` lesen. Verifiziert durch die Tests unter `stab/` und der drei Seiten grün
- [x] 3.3 Übrige Seiten: `pages/fuehrung/UeberblickPage.tsx`, `pages/lage-dashboard/LageDashboardPage.tsx`, `pages/VerpflegungPage.tsx`, `verpflegung/useBedarfsvorschlag.ts`, `verpflegung/VerpflegungDialoge.tsx`, `betreuung/useEvakuierungKennzahl.ts`, `pages/einsatzabschnitte/Organigramm.tsx`, `personen/VerbleibErfassung.tsx`. Verifiziert durch ihre Tests grün und `grep -rn "ladeModulOverrides" frontend/src --include=*.ts --include=*.tsx | grep -v test`, das nur noch `api/einsaetze.ts` und `pages/einstellungen/EinsatzModule.tsx` zeigt
- [x] 3.4 Invalidierung nach design.md D5: `pages/einstellungen/EinsatzModule.tsx` invalidiert `modulFreigaben(id)`, `EinsatzDefaults.tsx` den Prefix `modulFreigaben()`. Verifiziert durch je einen Test, der nach der Mutation die Invalidierung des Keys prüft

## 4. Lagekarte: Kartenquellen hinter der Modulgrenze

- [x] 4.1 `pages/lagekarte/personenEbene.ts` und `betreuungEbene.ts` auf `ModulFreigaben` (ohne `benutzer`), `rechteBekannt` = Freigaben liegen vor, 403-Netz bleibt. Den Satz „Strukturelle Lösung: LFH-669“ ersetzen. Vorher `frontend/src/pages/lagekarte/AGENTS.md` lesen. Verifiziert durch umgebaute `personenEbene`-/`betreuungEbene`-Tests, darunter der Fall „Freigabe sagt frei, Server 403“ (weiter „gesperrt“)
- [x] 4.2 `useLagekarteDaten.ts`: jede modulgebundene Live-Quelle nach der Tabelle in design.md D4 nur bei freiem Modul abfragen. Gesperrte Quellen liefern keine Rohdaten und keinen Ausfalleintrag, ein Fehler der Freigaben erscheint als Quelle „Berechtigungen“. Verifiziert durch Hook-Tests: (a) `schaeden` mit `zugriff: false` → kein Aufruf von `listeSchaeden`, kein Eintrag „Schäden“ im Ausfallhinweis; (b) Freigaben laden noch → keine modulgebundene Liste angefragt; (c) Freigaben-Fehler → „Berechtigungen“ im Ausfallhinweis; (d) `schaeden` frei, Abruf scheitert → „Schäden“ im Ausfallhinweis wie bisher. Mutationsprobe: `enabled` einer Quelle zurück auf `liveAn` → (a) rot
- [x] 4.3 `frontend/src/pages/lagekarte/AGENTS.md`: Regel „Kartenquellen eines fremden Moduls laden nur bei Freigabe des Servers, gesperrt ist kein Ausfall“ mit Verweis auf diese Change. Verifiziert durch `prettier --check frontend/src/pages/lagekarte/AGENTS.md`

## 4b. Review-Nachträge

- [x] 4b.1 `pages/lage-dashboard/useLagebild.ts` (Lage-Dashboard, Stab-Vorbereitung) nach design.md D4b: jede modulgebundene Quelle nur bei Freigabe; gesperrt kein Ausfall, Freigaben-Fehler sichtbar. Verifiziert durch Tests (gesperrt → keine Anfrage, kein Hinweis; Freigaben laden → keine Anfrage; Freigaben-Fehler → Hinweis; freies Modul mit 500 → Ausfall wie bisher) und eine Mutationsprobe
- [x] 4b.2 `pages/fuehrung/UeberblickPage.tsx` und `pages/FunkplanPage.tsx` nach design.md D4b. Verifiziert durch dieselben vier Testfälle je Seite und eine Mutationsprobe
- [x] 4b.3 Lagekarte: der Datenstand zählt nur freigegebene Quellen (gesperrte Quelle mit Altstand im Cache). Verifiziert durch den Hook-Test „gesperrtes Modul mit Altstand im Cache“ (vorher rot: 1000 statt jünger)
- [x] 4b.4 Warnsperre fail-safe: `useAktiveWarnung` meldet bei gescheiterten Freigaben die Warnung, ohne die Gefahrengebiete abzufragen (design.md, Risks). Verifiziert durch den Test „Freigaben gescheitert → keine Anfrage, aber die Sperre hält“ (vorher rot)
- [x] 4b.5 Gleichlauf-Test im Backend gegen eine unabhängige Referenz der alten Entscheidung statt gegen `fordere_modul_zugriff` (das inzwischen delegiert). Verifiziert durch `cargo test --lib einsatz::berechtigung` und eine Mutationsprobe in `modul_freigabe`

## 5. Aufräumen und Verifikation

- [x] 5.1 Verweise nachziehen: `grep -rn "istModulGesperrt kennt\|Org-Defaults nicht\|benoetigteRolle" frontend/src src` ohne veraltete Aussagen, und die Rahmenzeile „Freigaben“ in `frontend/src/offline/AGENTS.md` nennt den neuen Key. Verifiziert durch die Grep-Ausgabe
- [x] 5.2 e2e-Nachweis der Akzeptanz: Org-Vorgabe `fuehrungskraft` für `lagemeldungen` (Kartenquelle, die kein anderer Spec mit Nicht-Admin-Rolle bedient; die Org-Vorgabe gilt in der geteilten e2e-Datenbank für jeden Einsatz und wird im `finally` zurückgesetzt), normales Mitglied öffnet Einsatz und Lagekarte. Navigation zeigt „Lagemeldungen“ gesperrt, kein Request an `/lage/meldungen`, kein Ausfallhinweis. Spec unter `frontend/e2e/` (vorher `frontend/e2e/AGENTS.md` lesen). Verifiziert durch den grünen e2e-Lauf und eine Mutationsprobe (Gate in `useLagekarteDaten` testweise aus → rot)
- [ ] 5.3 `./scripts/check-all.sh` grün. Verifiziert durch den Exit-Code bzw. die CI des PRs
