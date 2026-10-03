# Tasks

Jede Aufgabe läuft nach `superpowers:test-driven-development`: erst rot, dann grün. Vitest über
`mise exec -- pnpm -C <abs>/frontend test -- <datei>`. Vor „fertig“ kommen
`verification-before-completion` und `requesting-code-review`.

## 1. Gemeinsame Schale des Punktanker-Menüs (D1)

- [x] 1.1 `PunktankerMenue.test.tsx` zuerst schreiben, mit diesen Fällen, und rot belegen:
  - Einträge in Reihenfolge, `aria-label`
  - ArrowDown+Enter wählt und ruft `onSchliessen`
  - Esc schließt ohne Wahl
  - Fokus zurück an `fokusZiel`, auch beim Aushängen
  - `escGehoertOverlay` ist bei offenem Menü wahr
  - eine antd-Gruppe (Kopf) ist nicht wählbar
- [x] 1.2 `pages/lagekarte/PunktankerMenue.tsx` aus `FlaechenwahlMenue.tsx` herauslösen und
  `punktmenueEintragStil(token)` in die Schale verschieben. `flaechenwahlEintragStil` bleibt als
  Wiederexport, `FlaechenwahlMenue` wird zur Hülle. Fertig, wenn diese Tests grün sind:
  - Tests aus 1.1
  - `FlaechenwahlMenue.test.tsx` und `flaechenwahl.test.ts` unverändert
  - `dichte.guard.test.ts` und `menueAusloeser.guard.test.ts`

## 2. Ortsziel und Einträge (D2, D4)

- [x] 2.1 `klickziel.test.ts`: Fälle für `istOrtsziel` ergänzen und rot belegen.
  - wahr: `null`, `zone`, `abschnitt`, `mehrdeutig`, Fachebenen-Fläche (`fachebene-dwd-fill`)
  - falsch: `marker` (Zeichen und Trefferzone), `personenCluster`, Fachebenen-Punkt, -Bündel
    und -Trefferzone

  Danach `istOrtsziel` in `klickziel.ts` umsetzen, bis die Tests grün sind.
- [x] 2.2 `kontextmenue.test.ts`: Fälle zuerst, rot belegen.
  - mit Schreibrecht: `kopieren`, `messen`, `zeichen` in dieser Reihenfolge
  - ohne Schreibrecht: kein `zeichen`, auch nicht gesperrt
  - kein Eintrag mit `gefahr`
  - die antd-Items entstehen über `menueEintraege()` (LFH-365), Schlüssel und Texte in
    Reihenfolge; der Kopf (Koordinate) steht über `kopf` der Schale, nicht als Gruppe (D4)

  Danach `pages/lagekarte/kontextmenue.ts` umsetzen, bis die Tests grün sind.

## 3. Nachklick-Riegel (D3)

- [x] 3.1 `nachklickRiegel.test.ts` (jsdom) zuerst, rot belegen:
  - **ohne Scharfschalten** läuft `mousedown`, `click` und `contextmenu` am `window` durch
  - **scharf** nach `touchstart` + `contextmenu`: `contextmenu`, `mousedown`, `mouseup` und
    `click` erreichen einen später am `window` (Capture) angemeldeten Hörer nicht
  - nach `touchend` + 400 ms (Fake-Timer) läuft alles wieder durch
  - ein neues `touchstart` löst den Riegel sofort
  - ein Rechtsklick mit der Maus (`contextmenu` ohne liegenden Finger) schaltet nicht scharf
  - `abbauen()` entfernt alle Hörer
- [x] 3.2 `pages/lagekarte/nachklickRiegel.ts` umsetzen und die Tests aus 3.1 grün machen. Den
  Rückgabewert `quelle: 'maus' | 'touch'` für ein `contextmenu` als reine Funktion mit eigenem
  Test.

## 4. Startpunkt fürs Messen (D6)

- [x] 4.1 `messZeichnung.test.ts` zuerst, rot belegen: `setzeStartpunkt({lng,lat})` feuert am
  Kartenelement `pointerdown` und `pointerup` an der projizierten Bildschirmstelle (Canvas-Rect
  plus `map.project`). Ohne aktive Messung tut es nichts. Die terra-draw-Instanz und den Adapter
  dafür über `vi.mock` ersetzen, nach dem Muster vorhandener terra-draw-Tests (falls keiner
  existiert: Kartenattrappe mit `getCanvas`, `project`, `getContainer`).
- [x] 4.2 `setzeStartpunkt` in `messZeichnung.ts` umsetzen und die Tests aus 4.1 grün machen.
- [x] 4.3 `useKartenInteraktion.ts`:
  - `onMessenAb(punkt)` startet `messen`/`strecke` und setzt `messStart {lng,lat,nr}`
  - beim Ende des Messens wird `messStart` geleert
  - `Kartenflaeche`: Prop `messStart`; der Messen-Effekt ruft nach `starten` einmal je `nr`
    `setzeStartpunkt` auf

  Belegt im Vitest des Hooks (falls vorhanden) oder in einem Reducer-Test: `messStart` gesetzt
  und wieder geleert.

## 5. Kontextmenü verdrahten (D2, D3, D5, D7)

- [x] 5.1 `ZeichenHierDialog.test.tsx` zuerst, rot belegen:
  - Titel „Zeichen hier setzen“
  - „Setzen“ ruft `onSetzen(spec)`
  - während `laeuft` ist „Setzen“ gesperrt, ein zweiter Klick ruft nichts
  - „Abbrechen“ und Esc rufen `onAbbrechen`, nicht `onSetzen`
  - Enter im Picker wirkt wie „Setzen“
  - `autoFokus` nur bei `quelle: 'maus'`

  Danach `pages/lagekarte/ZeichenHierDialog.tsx` umsetzen, bis die Tests grün sind.
- [x] 5.2 `useKartenInteraktion.ts`: `legeZeichenAnPunkt(spec, punkt)` als eigene Mutation
  (`legeFreiesZeichenAn` mit `ansicht_id`, `merkeZuletztVerwendet`, Invalidierung `freieZeichen`,
  Guard über `isPending` und `darfSchreiben`). Vitest mit gemockter API: ein Aufruf legt an und
  merkt das Zeichen, ein zweiter Aufruf während `isPending` legt nichts an.
- [x] 5.3 `Kartenflaeche.tsx`:
  - Prop `kontextmenue` (Ref) und `contextmenu`-Hörer mit `istOrtsziel`
  - Menüzustand `offenesKontextmenue`; `movestart` schließt, die Prop `null` schließt
  - Kontextmenü und Flächenwahl schließen sich gegenseitig
  - Riegel aus Aufgabe 3 beim Mounten anmelden, beim Unmount abbauen
  - `PunktankerMenue` mit `aria-label="Aktionen an dieser Stelle"` und Kopf direkt im Rahmen
    einhängen (keine eigene Hülle nötig)

  Bestehende Vitests der Lagekarte bleiben grün.
- [x] 5.4 `LagekartePage.tsx`:
  - `kontextmenue` nur ohne exklusiven Modus übergeben
  - `eintraege` aus `kontextEintraege({ darfSchreiben })` mit Kopf `formatKoordinate(lat, lon)`
  - `kopieren`: Zwischenablage und Quittung, Fehler mit Koordinate im Text
  - `messen` → `onMessenAb`
  - `zeichen` → `ZeichenHierDialog` öffnen, `onSetzen` → `legeZeichenAnPunkt`, danach schließen

  Belegt durch einen Seitentest (falls vorhanden) oder einen Vitest der Handler-Funktion für
  Kopieren mit gemocktem `navigator.clipboard`, für Erfolg und Ablehnung.

## 6. e2e: Touch und Maus (D9)

- [x] 6.1 `e2e/lagekarte-touch.spec.ts` (Touch, 1024 und 390 px). Einen Helper
  `langerDruck(page, x, y, ms = 700)` per CDP `Input.dispatchTouchEvent` bauen (`touchStart`,
  Warten, `touchEnd`). Ein langer Druck auf eine freie Stelle (Trefferwache `elementFromPoint`)
  muss belegen:
  - das Menü „Aktionen an dieser Stelle“ ist nach dem Abheben **offen**
  - der Kopf zeigt eine Koordinate
  - Mitte, Zoom, Neigung und Drehung sind unverändert (`__lfhKarte`)
  - jeder `menuitem` ist ≥ `controlHeight` hoch, in Stufe `handschuh` ≥ 72
- [x] 6.2 Gleiche Spec: „Messen ab hier“ per Tipp, danach Tipp an eine zweite Stelle. Belegt,
  wenn die Messsteuerung einen Streckenwert ≠ „—“ zeigt. Danach beendet Esc das Messen. Im
  Messmodus öffnet ein langer Druck kein Menü (`[role="menu"]` fehlt).
- [x] 6.3 Gleiche Spec, mit Schreibrecht: „Hier Zeichen setzen“ per Tipp, im Dialog eine
  Grundzeichen-Kachel per Tipp wählen, dann „Setzen“. Belegt, wenn das Zeichen per API an der
  Druckstelle liegt (Toleranz ein paar Meter) und auf der Karte erscheint.
- [x] 6.4 Gleiche Spec: Ein langer Druck in die Trefferzone eines Markers öffnet kein Menü,
  ebenso auf den DOM-Donut eines Kräfte-Clusters (Review 03.10.2026). Ein
  langer Druck in eine Zone öffnet das Menü, und nach dem Abheben zeigt der Inspector die Zone
  nicht.
- [x] 6.5 Mausfall (in `lagekarte-touch.spec.ts` als Block ohne `hasTouch` oder in
  `lagekarte-smoke.spec.ts`): Rechtsklick → Menü. „Koordinate kopieren“ mit Playwright-
  `clipboard-read`/`-write`: die Zwischenablage entspricht dem Kopf, die Quittung „Koordinate
  kopiert“ ist sichtbar. Esc schließt, der Fokus liegt auf dem Canvas.
- [x] 6.6 Mutationsproben, Befund in die Prüfliste (7.1):
  - Riegel abgeschaltet ⇒ 6.1 rot (Menü nach dem Abheben zu oder Zone gewählt)
  - Sperre `kontextmenue` im Modus entfernt ⇒ 6.2 rot
  - `istOrtsziel` immer wahr ⇒ 6.4 rot

  Danach jeweils zurückdrehen ⇒ grün.

## 7. Prüfliste, Regeln, Integration

- [x] 7.1 `openspec/changes/archive/2026-10-03-lfh-776-lagekarte-kontextmenue/pruefliste.md`: 15 Kriterien der
  Einsatztauglichkeit (Festlegung 7, `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`),
  je Zeile ein Verdikt mit Beleg. Dazu die Mutationsproben aus 6.6 und die offene Abnahme am
  echten Android-Tablet (natives `contextmenu`).
- [x] 7.2 `frontend/src/pages/lagekarte/AGENTS.md`: ein Punkt „Kontextmenü an der Kartenstelle“
  (Träger `contextmenu` in `Kartenflaeche`, `istOrtsziel`, `nachklickRiegel.ts`, Sperre über die
  Prop `kontextmenue`, Schale `PunktankerMenue`, Verweis auf die Change und später das Archiv).
  Prettier ist grün (`scripts/check-fmt.sh`).
- [x] 7.3 `./scripts/check-all.sh` vollständig grün, mit eigenem `CARGO_TARGET_DIR` im
  Scratchpad. Das Log nach „ÜBERSPRUNGEN“ durchsehen. Ist die Umgebung lokal nicht vollständig
  (Node-Pin, mise), mit Verweis auf die CI des PRs abhaken (`ci.yml` ruft `check-all.sh`).
  Stand 03.10.2026 (Cloud-Sitzung, mise mit Node 26.7.0):
  - `--nur schnell` grün.
  - `--nur frontend` grün: 670 Dateien, 9176 Tests.
  - `--nur rust` lokal nicht belegbar, weil das Plattenkontingent der Sitzung beim Linken
    ausging (`ld` Bus error). Kein Rust-Code geändert.
  - e2e Chromium mit dem vorinstallierten Browser (1194 statt 1234): 599 grün, 24 rot, alle
    außerhalb der Lagekarte. Gegen `origin/alpha` im selben Aufbau sind 21 davon ebenso rot.
    Von den drei übrigen sind ETB-Chronologie und UHS-Grundriss einzeln grün. Stab-Vorbereitung
    wackelt und ist auf `alpha` 3 von 3 rot.
  - Die fünf LFH-776-Fälle sind grün.

  Vollständig belegt durch die CI des PRs.
