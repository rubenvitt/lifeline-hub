# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- Rust: `cargo test --test <datei>`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`.

## 1. Breite vor dem Bau messen (Akzeptanzkriterium, D4)

- [ ] 1.1 Messspec `e2e/funkplan-breite.spec.ts` (vorläufig, geht später in 7.2 auf):
  - Bei 1366 × 768 mit offenem Modulpanel die Contentbreite von `[data-lfh="seiten-inhalt"]`
    unter `stab` messen.
  - Die Breite des längsten gesäten Funkrufnamens bzw. der längsten Kurzbezeichnung in Mono
    (Schriftgrad der Tabelle) messen, dazu je eine TMO- und DMO-Sprechgruppe.
  - Die Werte als `test.info().annotations` ausgeben.
  - Nachweis: Die Spec läuft grün, und die Messwerte sind in `design.md` D4 als Nachtrag
    „Messung vor dem Bau“ eingetragen, samt den daraus gewählten Spaltenbreiten und der
    `mindestBreite`.

## 2. Backend: Anlegen mit Startinhalt (D9, Spec `dokument-uebernahme`)

- [ ] 2.1 Test zuerst in `tests/` für Lagebericht und Befehl (neue Datei oder neben den
  bestehenden Tests):
  - POST mit `abschnitte: [{schluessel:'text', text:'…'}]` → 201, der Text steht im Entwurf.
  - Unbekannter Schlüssel → 400, danach ist die Liste unverändert (kein Entwurf).
  - Doppelter Schlüssel → 400.
  - Ohne `abschnitte` → leeres Skelett wie bisher.
  - Ein Live-Hinweis.
  - Nachweis: rot belegt.
- [ ] 2.2 Umsetzung:
  - `AnlegenBody<A>` mit `#[serde(default)] abschnitte`
  - `pruefe_abschnitts_schluessel::<T>` in `routes/vorlagendokument.rs`, gerufen in `anlegen`
    und `aktualisieren`
  - `dok_repo::anlegen_tx`/`anlegen` mit `startinhalt: Option<&[A]>`
  - Demo-Import übergibt `None`
  - Lagebericht- und Befehlsroute auf `AnlegenBody<T::Abschnitt>`
  - Nachweis: Tests aus 2.1 grün, `cargo test` im Workspace grün (Server ohne Hülle).
- [ ] 2.3 Frontend-API:
  - `NeuerLagebericht.abschnitte?` (`api/lageberichte.ts`) und `NeuerBefehl.abschnitte?`
    (`api/befehle.ts`)
  - Nachweis: `pnpm exec tsc -b` grün.

## 3. Meldebild auf einen Aufruf umstellen (D9, Spec `dokument-uebernahme`)

- [ ] 3.1 `KraefteuebersichtPage.test.tsx` zuerst:
  - Die Übernahme ruft `legeLageberichtAn` genau einmal mit `abschnitte: [{schluessel:'text'}]`
    und nie `aktualisiereLagebericht`.
  - Bei Ablehnung steht der Fehler an der Seite (`SpeicherFehler`), `.ant-message` zählt 0.
  - Nachweis: rot belegt.
- [ ] 3.2 Umsetzung:
  - `uebernehmen` mit einem Aufruf
  - `onError`-Toast raus, `SpeicherFehler` an der Werkzeugzeile
  - `reset()` beim Start
  - Nachweis: Tests aus 3.1 und der Rest von `KraefteuebersichtPage.test.tsx` grün.
- [ ] 3.3 `abrufZustand` nach `api/abrufZustand.ts` ziehen, mit eigenem Vitest (403 →
  `gesperrt`, Fehler, Laden, Daten). Das Meldebild importiert von dort.
  - Nachweis: Vitest grün, `pnpm lint` grün.

## 4. Reine Ableitungen (D3, D6, Spec `stab-funkplan`)

- [ ] 4.1 `stab/funkplan.test.ts` zuerst, gegen `baueFunkplan`:
  - Baum Abschnitt → Unterabschnitt → Einheit → Untereinheit → Fahrzeug
  - verwaister Unterabschnitt an der Wurzel
  - Einheit ohne Abschnitt und Fahrzeug ohne Einheit im Knoten `sammel` (als letzter)
  - TMO/DMO getrennt aus `sprechgruppen[]`, nie aus den Altfeldern
  - Fahrzeugführer aus Personal mit `staerke_position = 'fuehrer'`
  - Personal nicht `daten` → Führerzelle mit Zustand statt Name
  - fehlende Quelle → Ebene fehlt
  - Schlüssel eindeutig über alle Ebenen
  - Nachweis: rot belegt, dann grün.
- [ ] 4.2 `stab/luecken.test.ts` zuerst, gegen die vier Lückenfunktionen:
  - Treffer
  - Leerfall mit Zahl 0 nur bei `daten`
  - Zustände `laden`/`fehler`/`gesperrt` bringen keine Zahl
  - „ohne Zuordnung“ nimmt den schlechtesten Zustand von drei Quellen
  - nur `einsatz_lokal`
  - Nachweis: rot belegt, dann grün.
- [ ] 4.3 `rendereFunkplanMarkdown(zeilen, stand, luecken)`, Tests zuerst in
  `stab/funkplan.test.ts`:
  - Überschrift „# Funkplan“, Stand
  - eingerückte Liste in Baumreihenfolge mit Rufname/OPTA, Leiter/Führer, TMO, DMO,
    Kommunikationsmittel
  - Abschnitt „Lücken“ mit Zahlen bzw. „—“ und dem Gegenstellen-Hinweis
  - **keine Erreichbarkeit** (gesäter Wert taucht nicht auf)
  - kein `\p{Extended_Pictographic}`
  - Nachweis: grün.
- [ ] 4.4 `kommunikationsmittelLabel` aus `components/FunkErreichbarkeit.tsx` exportieren.
  - Nachweis: bestehende Tests von `FunkErreichbarkeit` grün, neuer Vitest für die drei Schlüssel
    und für Unbekanntes.

## 5. Seite, Route, Einstieg (D1, D2, D4, D5, D7)

- [ ] 5.1 `funkplanPfad(einsatzId)` in `routing/deeplinks.ts`.
  - Nachweis: Vitest in der Deeplink-Testdatei (Pfad `/einsaetze/7/stab/funkplan`), und
    `inlinePfade.guard.test.ts` grün.
- [ ] 5.2 `pages/FunkplanPage.test.tsx` zuerst, Rendering mit gemockten APIs:
  - Zeilen und Spalten
  - Kennung „Stelle“ menschenlesbar
  - Lücken-Paneel mit Zahlen und Verweisen
  - Gegenstellen-Hinweis
  - Einheiten 403 → „—“ mit „nicht freigegeben“, keine „0“
  - Personal 403 → Führerzellen „—“ mit Grund
  - Übernahme-Knopf nur mit Schreibrecht
  - Übernahme ruft `legeLageberichtAn` einmal ohne gesäte Erreichbarkeit und navigiert
  - Fehler an der Seite
  - Verweis in der Stelle-Zelle navigiert, ohne den Knoten umzuschalten (D7)
  - Nachweis: rot belegt.
- [ ] 5.3 `pages/FunkplanPage.tsx` bauen:
  - `EinsatzSeite` (Titel „Funkplan“, `h1`), Lücken-`Paneel`
  - `Datensicht form="tabelle" baum={…}` mit `spaltenFuer<FunkplanZeile>()` und
    `karte.titel.ziel`
  - Werkzeugzeile außerhalb der Sicht: `DruckKnopf vorbereiten={alleAufklappen}` und
    „In Lagebericht übernehmen“
  - `abBreite: 'xl'` an der Erreichbarkeit nur ohne `useDruckModus()`
  - Nachweis: Tests aus 5.2 grün. Falls der Knoten beim Verweisklick umschaltet, bekommt
    `Datensicht` den Riegel `closest('a')` im Baumzweig, mit eigenem Test in
    `Datensicht.test.tsx`.
- [ ] 5.4 Route `stab/funkplan` in `App.tsx` (Geschwister von `etb/druck`, lazy wie das Meldebild)
  und Verweis „Funkplan“ in der S6-Zeile von `pages/StabPage.tsx` (`stabZeilenzielStil`).
  - Nachweis: Vitest in `StabPage.test.tsx`, dass die Zeile S6 den Verweis auf
    `funkplanPfad(id)` trägt und andere Zeilen nicht; App-Routentest, dass der Stab in der
    Navigation aktiv ist.
- [ ] 5.5 `datensicht.guard.test.ts`: `FunkplanPage.tsx` in `KONSUMENTEN` und `NUR_TABELLE`
  (Pin 3 → 4, Begründung als Kommentar).
  - Nachweis: Guard grün; Gegenprobe mit `form="auto"` → rot.

## 6. Druck (D5, D8)

- [ ] 6.1 Formtest zuerst (`druck/druck.test.ts`): Die Tabellen-Neutralisierer stehen unter
  `[data-lfh='druckwurzel']` in `druck.css`, nicht mehr in `kraefteuebersichtPrint.css`
  (`kraefteuebersichtPrint.test.ts` angepasst).
  - Nachweis: rot, dann nach dem Umzug grün.
- [ ] 6.2 `pages/funkplanPrint.css` mit den Eigenheiten des Funkplans:
  - `.funkplan-no-print`
  - Seitenkopf aus
  - Druckwurzel `funkplan-print-root`
  - `Druckkopf dokumentart="Funkplan"` mit Stand und Umfang
  - Nachweis: Formtest `funkplanPrint.test.ts` grün.

## 7. e2e und Gates (D11)

- [ ] 7.1 `e2e/gate1-ueberlauf.spec.ts`: Route `stab/funkplan` mit Datenanker in `gate1Routen`
  aufnehmen.
  - Nachweis: grün bei 1366/1024/768/390, als Admin und als Beobachter.
- [ ] 7.2 `e2e/funkplan.spec.ts` (übernimmt die Messspec aus 1.1), mit Seeding per API und langen
  Werten:
  - Lücken im ersten Bild bei 1366 × 768 mit offenem Panel (`toBeInViewport`)
  - Fixspalte bei 390 px
  - Druckpfad bei 680 px mit selbst ausgelöstem `beforeprint`: alle Knoten offen, Erreichbarkeit
    vorhanden, rechts nichts abgeschnitten
  - Übernahme: genau ein POST auf `…/lageberichte`, kein PATCH, danach Lagebericht offen
  - Klick auf den Verweis einer Einheit öffnet ihre Detailseite
  - Nachweis: grün; Mutationsprobe „Erreichbarkeit im Druck mit `abBreite`“ → rot, Befund in 8.1.
- [ ] 7.3 `e2e/meldebild-tabelle.spec.ts` nach dem Umzug der Druck-Neutralisierer erneut fahren.
  - Nachweis: grün.

## 8. Prüfliste, Doku, Folgeticket

- [ ] 8.1 `openspec/changes/lfh-548-funkplan/pruefliste.md`: 15 Kriterien der
  Einsatztauglichkeit, je Zeile ein Verdikt (erfüllt / offen → Ticket / nicht anwendbar),
  Mutationsprobe aus 7.2, Messwerte aus 1.1.
- [ ] 8.2 Folgeticket „Eigene Gegenstelle (Führungsstelle) am Einsatz erfassen“ über
  `clickup-task-anlegen`; die Ticketnummer als Kommentar am Gegenstellen-Hinweis in
  `FunkplanPage.tsx`.
- [ ] 8.3 `CLAUDE.md`: kurzer Eintrag zum Funkplan (Ort `stab/funkplan`, Ableitung ohne Endpunkt,
  Erreichbarkeit Druck ja/Lagebericht nein, `AnlegenBody.abschnitte` als einziger
  Übernahmeweg).
  - Nachweis: `scripts/check-fmt.sh` grün.

## 9. Integration

- [ ] 9.1 `./scripts/check-all.sh` grün (bzw. die CI des PRs), vorher `openspec validate
  lfh-548-funkplan --strict`.
- [ ] 9.2 `/opsx:archive lfh-548-funkplan` im selben Branch: Spec-Sync nach `openspec/specs/`,
  Verweise auf den Change-Pfad (CLAUDE.md, Code-Kommentare) nachziehen, dann erst der PR gegen
  `alpha`.
