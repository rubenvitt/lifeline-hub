# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Pfade ohne Präfix sind relativ zu `frontend/src/`, Backend-Pfade beginnen mit `src/`. Node und
pnpm laufen über `mise exec -- …`.

## 1. Server-Suche `q` der Aufträge (D9)

- [ ] 1.1 `like_muster` aus `src/schaden/repo.rs` an einen gemeinsamen Ort ziehen (Modul neben
  `routes::support` oder `db`). Die Schadenliste nutzt ihn von dort.
  Nachweis: die bestehenden Suchtests der Schadenliste bleiben grün, und ein Unit-Test des
  gemeinsamen Moduls maskiert `%`, `_` und `\`.
- [ ] 1.2 `src/auftrag/repo.rs`: `AuftragFilter.suche` und das Fragment über `#lfd_nr`,
  `auftrag_text` und `auftrag_empfaenger.snap_anzeige` in `filter_bedingung`. Es wirkt damit auch
  in `kennzahlen`.
  Nachweis: Repo-Tests für Treffer im Text, im Empfänger und über die Kennung „#12“; „50%“ trifft
  nur den wörtlichen Text; Groß-/Kleinschreibung bei ASCII; mit `phase=abgeschlossen` und
  `limit` liefert die erste Seite den ältesten von 150 Aufträgen, wenn nach seinem Text gesucht
  wird; die Kennzahlen zählen nur Treffer.
- [ ] 1.3 `src/routes/auftrag.rs`: `q` in `ListeParams` und `KennzahlenParams`. Der Begriff wird
  getrimmt, leer zählt als nichts, mehr als 200 Zeichen ergibt 422 über `support::hoechstens`.
  Nachweis: Routentests (`tests/`) für Treffer, Leerzeichen-Begriff gleich ohne Begriff, 201
  Zeichen gleich 422 mit Feldname `q`. `cargo test` für die betroffenen Module ist grün.
- [ ] 1.4 `src/AGENTS.md`: Die Suchregel der geblätterten Listen nennt die Auftragsliste und den
  gemeinsamen Ort von `like_muster`.
  Nachweis: `grep -n "like_muster" src/AGENTS.md`.
- [ ] 1.5 `api/auftraege.ts` reicht `suche` an `listeOffeneAuftraege`,
  `listeAbgeschlosseneAuftraege` und `ladeAuftragKennzahlen` weiter; leer sendet kein `q`.
  `api/queryKeys.ts`: `auftraegePhase(…, suche)` und `auftragKennzahlen(…, suche)`.
  Nachweis: `queryKeys.test.ts` und die Charakterisierung mit Literalen sind angepasst, ein
  Test in `api/auftraege` prüft die URL mit und ohne `q`, und die Guards
  `queryKeys.guard.test.ts` und `globalKeys.test.ts` sind grün.

## 2. Zufluss-Logik herauslösen (D8)

- [x] 2.1 Die Zustandsmaschine des Zuflusses aus `components/Datensicht.tsx` nach
  `components/useZuflussSchleuse.ts` ziehen: offen bzw. gefroren, Fokus- und Zeigerbedingung,
  Portal-Ausnahme, Bewegung statt `pointerenter`, Bannerwortlaut. Ohne Verhaltensänderung.
  Nachweis: alle `Datensicht*.test.tsx` laufen unverändert grün, und ein eigener
  `useZuflussSchleuse.test.tsx` prüft Fokus hält, Zeigerbewegung hält, Touch hält nicht und
  `focusout` ins Portal hält.

## 3. Baustein `ListeDetail` (D2, D7; Spec `liste-detail`)

- [x] 3.1 `kommunikation/KommKarte.tsx` bekommt `gewaehlt`, und `kartenGrund` nutzt die Folge
  alarm > hervorgehoben > gewählt > paneel. Die Linie oben und unten bleibt allein an
  `hervorgehoben`.
  Nachweis: `KommKarte.test.tsx` und `kartenKante.test.ts` prüfen die gewählte Karte auf
  `auswahlFlaeche` ohne Inset-Schatten, die gewählte und alarmierte Karte auf Alarmfläche und
  -kante, und die gewählte und hervorgehobene Karte auf Bedienfläche und Linie.
- [x] 3.2 `components/ListeDetail.tsx` mit Grid ab `lg` (Detail-Paneel `sticky`) und Detail unter
  der gewählten Karte darunter; Auswahlziel als `<button>` samt `aria-current` bzw.
  `aria-expanded`/`aria-controls`; freie Kartenfläche wählt, Links bedienen sich allein;
  Vorauswahl ab `lg`; Zuklappen unter `lg`.
  Nachweis: `ListeDetail.test.tsx` deckt die Szenarien „Erstes Objekt ab lg“, „Zuklappen auf dem
  Handschirm“, „Wechsel der Wahl“, „Tastatur“ (Enter und Leertaste), „Zustand ohne Farbe“ und
  Klick auf einen Kennungs-Link wählt nicht. Die Breite wird über einen `matchMedia`-Stub
  gesetzt.
- [x] 3.3 Zustände in `ListeDetail`: Skelett bei erster Lieferung, `SeitenFehler` ohne Bestand,
  `SeitenStandVeraltet` bei Bestand, `SeitenLeer` mit Aktion.
  Nachweis: Vitest für die Szenarien „Erste Lieferung“, „Leer mit Schreibrecht“ (genau ein Knopf
  mit dem Wortlaut des Kopfes) und „Abgleich scheitert“.
- [ ] 3.4 Deeplink-Sprung: `hervorgehoben` und Scroll in den Sichtbereich einmal je Sprung; eine
  Wahl von Hand räumt die Markierung.
  Nachweis: Vitest „Deeplink bei aktivem Filter“ (zusammen mit dem Aufrufer, siehe 4.4) und „Wahl
  von Hand“.
- [x] 3.5 Zufluss über `useZuflussSchleuse` und `flachZufluss`, Sammelbanner in der
  Standzeile über der Liste.
  Nachweis: Vitest „Neuer Eintrag unter dem Zeiger“, „Banner einfügen“ und „Ohne Zeiger und
  Fokus“; Touch hält nicht.
- [x] 3.6 Gewähltes Objekt entfällt: Der Baustein hält das zuletzt gesehene Objekt und reicht
  `entfallen: true` an `detail`; ein Wechsel der Ansicht löst die Wahl.
  Nachweis: Vitest „Auftrag wird abgenommen“ (Objekt verschwindet aus `eintraege`, Detail bleibt
  mit `entfallen`) und „Andere Wahl“.
- [x] 3.7 Gruppen und Ausschnitt: `gruppen` mit Augenbraue je Gruppe; `fenster` über
  `useFensterAusschnitt` mit Anker auf die Wahl, auch mit aufgeklapptem Detail unter `lg`.
  Nachweis: Vitest mit 120 Einträgen, gewähltem Eintrag 90 und Schmal-Breite (Eintrag und
  Detail im DOM, Platzhalter oben > 0).
- [x] 3.8 `frontend/AGENTS.md`, „UI-Form-Leitlinie“: Zeile **Liste + Detailpaneel** nach D12;
  „Deeplink-Muster“: `?befehl=` als Auswahl in der Liste, die Item-Route bleibt. Prettier über
  `frontend/`.
  Nachweis: `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md` ist grün, und der
  Abschnitt nennt `components/ListeDetail.tsx` und Spec `liste-detail`.

## 4. Reiter „Einzelaufträge“ (D3, D4, D10; Spec `auftraege-befehle`)

- [ ] 4.1 `AuftragKarte.tsx` in `AuftragKopf`, `AuftragEmpfaenger`, `AuftragSchema`,
  `AuftragHandlungen` und `AuftragZeit` zerlegen; `AuftragKarte` setzt sie wie bisher zusammen.
  Nachweis: `AuftragKarte.test.tsx`, `AuftragListe.test.tsx`, `AuftragVorschau.test.tsx`,
  `command-palette/Vorschau.test.tsx`, `geraet/GeraetAbschnitt.test.tsx` (rendert die
  Geräteansicht mit `AuftragListe`) und `kommunikation/wortlaut.guard.test.ts` laufen unverändert
  grün.
- [ ] 4.2 `auftraege/AuftragListenKarte.tsx` (`memo`): Zeitspalte, Kopf ohne ETB-Sprung, Text
  auf drei Zeilen, Empfänger und „q/n quittiert“, keine Knöpfe.
  Nachweis: Vitest prüft „Überfälliger Auftrag“ (Alarmkante, Wort), „Langer Auftragstext“ (Klasse
  bzw. Stil des Zeilenschnitts, voller Text im zugänglichen Namen) und „Keine Handlung in der
  Karte“ (kein `button` außer dem Auswahlziel).
- [ ] 4.3 `auftraege/AuftragDetail.tsx`: Kopf, ganzer Text, `AuftragHandlungen` direkt unter dem
  Text, `AuftragEmpfaenger` mit Quittieren, `AuftragSchema` offen, Vollzugsvermerk, Verlauf
  aufsteigend, Sprung zum ETB-Eintrag, Hinweis „Nicht mehr in dieser Ansicht“ bei `entfallen`.
  Nachweis: Vitest „Quittieren im Detail“, „Ohne Schreibrecht“, „Abgeschlossener Auftrag“
  (Verlaufsfolge) und „Abgelehnte Abnahme“ (Grund über den Handlungen, kein Toast).
- [ ] 4.4 `auftraege/AuftraegeListe.tsx` auf `ListeDetail` umbauen: Filterleiste (Ansicht, Suche
  entprellt, Richtung, Empfänger), Fälligkeitsgruppen in „Offen“, „Verlinkter Auftrag“ angeheftet,
  „Ältere laden“ als `fuss`, `fenster` in „Abgeschlossen“. Mutationen, optimistisches Quittieren,
  Rückgängig und Fehlerorte bleiben; die Handler hängen am Detail.
  Nachweis: `pages/AuftraegePage.test.tsx`, `.blaettern.test.tsx` und `.grosseListen.test.tsx`
  sind auf die neue Bedienung umgeschrieben (Karte wählen, dann im Detail handeln). Der
  Render-Zähler der Listenkarten (LFH-949) bleibt bei einem Live-Ereignis mit einem geänderten
  Auftrag auf eine Karte. „Deeplink bei aktivem Filter“ und „Rückgängig nach Bearbeitung
  beginnen“ sind grün.
- [ ] 4.5 Suche in den Aufträgen: Der entprellte Begriff geht als `suche` in alle drei Abrufe;
  Deeplink räumt auch die Suche.
  Nachweis: Vitest mit Fake-Timern (`fireEvent.change`) prüft genau einen Abruf mit `q` nach
  300 ms und die geräumte Suche nach einem Deeplink.
- [ ] 4.6 `auftraege/AuftragErteilenDialog.tsx` (Modal + `AuftragFormular card={false} serie`)
  ersetzt das Inline-Paneel; Kopfknopf und Leerzustand öffnen ihn.
  Nachweis: Vitest „Serie“ (Dialog bleibt offen, Feld leer, Fokus im ersten Feld), „Abgelehnt“
  (Grund im Dialog, Felder bleiben) und gesperrte Auswege während des Sendens.
  `AuftragFormular.test.tsx` bleibt grün.

## 5. Reiter „Einsatzbefehle“ (D5, D6; Spec `auftraege-befehle`)

- [ ] 5.1 `auftraege/BefehlLesefassung.tsx` aus dem freigegebenen Zweig von
  `pages/BefehlDetailPage.tsx` herauslösen; die Vollseite nutzt sie.
  Nachweis: `BefehlDetailPage.test.tsx`, `pages/befehlPrint.test.ts` und
  `e2e/druck-fluss.spec.ts` (Befehl) sind grün, und ein Vitest prüft „Leerer Abschnitt“ (`—`).
- [ ] 5.2 `auftraege/BefehlListenKarte.tsx`: `KommKarte` mit Zeitstand und `v<n>`, Status,
  Schema, Titel, Ersteller bzw. Freigabe.
  Nachweis: Vitest „Fortgeschriebener Befehl“ (zwei Karten, `v1` und `v2`) und „Keine Handlung
  in der Karte“.
- [ ] 5.3 `auftraege/BefehlDetail.tsx`: Einzelabruf erst für den gewählten Befehl, Angaben,
  Lesefassung, „Entwurf bearbeiten“, „Freigeben“ über `FreigabeDialog` und `gibBefehlFrei`,
  „Fortschreiben“ mit Sprung auf die Vollseite des neuen Entwurfs, Sprungzeile „↗ Vollansicht“.
  Nachweis: Vitest „Entwurf freigeben im Detail“, „Fortschreiben“ (Navigation auf die neue
  Kennung), abgelehnte Freigabe (Grund im Dialog, Dialog bleibt offen) und ohne Schreibrecht
  keine Handlung.
- [ ] 5.4 `auftraege/BefehlListe.tsx` auf `ListeDetail` umbauen: Segmente Entwürfe/Freigegeben
  mit Vorgabe nach D5, Suche über Titel und Schema im Client, Bereichskopf „n Entwürfe ·
  m freigegeben“, „Befehl entwerfen“ wie bisher. `components/datensicht.guard.test.ts`:
  BefehlListe verlässt `NUR_KARTE` und `KONSUMENTEN`, die gepinnten Längen sinken.
  Nachweis: `BefehlListe.test.tsx` ist umgeschrieben und deckt „Suche nach Schema“, die Vorgabe
  des Segments und „Befehl entwerfen“ samt Sprung ab; der Guard ist grün.
- [ ] 5.5 `routing/deeplinks.ts`: `auftraegePfad(…, { befehl })` setzt den Reiter `befehle`;
  `BefehlListe` wendet `?befehl=` über `useQueryParamSelektion` an. Der Ortspfad der
  `BefehlDetailPage` führt dorthin.
  Nachweis: `deeplinks.test.ts` mit Round-Trip, Vitest „Zurück aus der Vollseite“ (Befehl
  gewählt und markiert, Parameter geräumt).

## 6. Seite und Gleichheit beider Reiter (D11)

- [ ] 6.1 `pages/AuftraegePage.tsx`: `SeitenSkeleton` und `SeitenFehler` mit „Erneut abrufen“
  statt `Spin`/`Alert`.
  Nachweis: Vitest für Laden und Fehler (Ursache steht, Wiederholen ruft den Abruf).
- [ ] 6.2 Gleichheit der Reiter festhalten.
  Nachweis: Ein Vitest „Gleiche Leiste“ prüft in beiden Reitern Segmentleiste mit zwei Segmenten
  und Zahl plus Suchfeld, und „Empfängerfilter nur bei Aufträgen“.

## 7. e2e, Prüfliste und Anwenderdoku

- [ ] 7.1 Bestehende e2e auf die neue Bedienung ziehen: `auftraege-abgeschlossen`,
  `befehl-navigation`, `befehl-aktionsleiste`, `etb-folgeauftraege`,
  `deeplink-hervorhebung-kontrast` (Auftrag und neu Befehl), `palette-oeffnung`,
  `knopf-wortlaut`, `gate1-ueberlauf`, `gate3-trefflaeche`, `trefflaeche-pruefflaechen` und
  `nav-schmal`, soweit sie die Seite berühren.
  Nachweis: Alle genannten Specs laufen grün.
- [ ] 7.2 Neue e2e `frontend/e2e/auftraege-befehle-liste-detail.spec.ts` bei 1366 × 768 und
  390 px:
  - Auftrag erteilen, quittieren, Vollzug melden, abnehmen (Detail bleibt mit Hinweis).
  - Befehl entwerfen, auf der Vollseite schreiben, zurück, im Detail freigeben.
  - Kein waagerechtes Scrollen.
  - Detail ab `lg` sticky.
  - Handschuh-Treffflächen nach dem neuen Szenario in `einsatztauglichkeit-layout`.
  Nachweis: Die Spec läuft grün.
- [ ] 7.3 `openspec/changes/oxgob5gk-auftraege-befehle-angleichen/pruefliste.md`: Prüfliste
  Einsatztauglichkeit (15 Kriterien) für die umgebaute Seite, jede Zeile mit Verdikt (erfüllt /
  offen mit Zielticket / nicht anwendbar).
  Nachweis: Keine Zeile ist ohne Verdikt.
- [ ] 7.4 `docs/anwender/kapitel/auftraege-befehle.md` neu schreiben: Karte wählen, Detail,
  Dialog „Auftrag erteilen“, Befehl im Detail lesen, freigeben und fortschreiben, Suche. `quellen:`
  ergänzen. Die Bilder aus `e2e/doku-bilder/auftraege-befehle.bilder.ts` neu erzeugen: Der Lauf
  sucht nicht mehr `region 'Neuer Auftrag'`, sondern den Dialog; neues Bild `befehl-detail`.
  Nachweis: `hilfe/anwenderdoku.guard.test.ts` ist grün, und die Bilder hell und dunkel liegen
  im Kapitelordner.

## 8. Abschluss

- [ ] 8.1 `./scripts/check-all.sh` grün (ohne `| tail`). `scripts/check-typ-codegen.sh` bleibt
  ohne Diff, weil kein DTO wechselt.
  Nachweis: Ausgabe des Laufs bzw. CI des PRs.
- [ ] 8.2 `superpowers:requesting-code-review` und `verification-before-completion`. Hinweis an
  Ruben, dass das Design System „Lifeline Hub“ um den Baustein „Liste + Detailpaneel“ nachgezogen
  werden muss.
  Nachweis: Die Review-Befunde sind abgearbeitet, und der Hinweis steht im PR.

## Workflow follow-up

- `/opsx:archive oxgob5gk-auftraege-befehle-angleichen` im selben Branch vor dem PR (Spec-Sync für
  `liste-detail`, `auftraege-befehle`, `deeplink-hervorhebung`, `einsatztauglichkeit-layout`).
- PR gegen `alpha` mit Plan, Umsetzung und Archiv zusammen; Zunder-Aufgabe auf `review`.
