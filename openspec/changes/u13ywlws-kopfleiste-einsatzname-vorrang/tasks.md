# Tasks

Pfade relativ zu `frontend/src/`, außer wo anders genannt. Jede Aufgabe per TDD: erst der Test,
der ohne die Änderung rot ist.

## 1. Wort genau bei Störung (D1)

- [x] 1.1 `SyncAnzeige` (`components/Kopfleiste.tsx`): Wort nur für `getrennt`, `offline`,
  `ausstehend`, `abgelehnt`; `verbunden` und `verbinde` als Symbol (`verbinde` in `achtung`), Name
  und `title` unverändert. `syncZeigtWort` und Props `ruheOhneWort`/`haeltStartPlatz` entfallen,
  Aufrufer in `einsatz/EinsatzLayout.tsx` und `components/AppLayout.tsx` nachgezogen.
  `components/Kopfleiste.test.tsx` deckt alle sechs Zustände ab und ist grün.
- [x] 1.2 `einsatz/AlarmZentrale.tsx`, breite Bauform: Benachrichtigung mit Wort nur bei
  `blockiert`, Ton nur bei `stumm`/`blockiert`, in jeder Breite und Dichte; Tooltip und
  `aria-label` nennen weiter Zustand und Handlung. `TON_WORT_LAENGSTES`-Platz, `tonHaeltPlatz`,
  `knapp` und die Dichte-Weiche entfallen. `AlarmZentrale*.test.tsx` umgestellt und grün.
- [x] 1.3 Gebündelte Bauform: Wort nur, wenn der gezeigte Zustand auffällig ist (auch am Handy);
  `sammelWortStil` bleibt für Störungswörter. Test: Handy im Ruhezustand ohne Wort, mit „Ton
  blockiert“ mit Wort.
- [x] 1.4 `WortPlatz` und `components/Kopfleiste.css` entfernen, `startWoerter` im Layout
  entfernen, Verweis im Kommentar von `components/BenutzerMenu.tsx` berichtigen; `tsc` und
  ESLint grün, `grep -rn "WortPlatz\|kopf-wort-platz" frontend/` leer.

## 2. Name vor Suche (D2, D3, D4)

- [x] 2.1 `einsatz/EinsatzSwitcher.tsx`: Name 16 px, Gewicht 500; Test prüft die Schriftgröße.
- [x] 2.2 `einsatz/EinsatzLayout.tsx`: ab `lg` Namensgruppe und Suchzelle in einem Raster
  (`minmax(min-content, max-content)` / `minmax(<Lupe>, 1fr)`), Behälter nimmt am Umbruch teil wie
  bisher beide Gruppen; Namenstext misst über `overflow-wrap: anywhere` und zeigt eine Zeile mit
  „…“. Unter `lg` unverändert. `kopfpolsterung.guard.test.ts` und `EinsatzLayout.test.tsx` grün.
- [x] 2.3 Suchzelle als Größen-Container; Hinweistext und Kürzel fallen unter der Mindestbreite
  weg (`components/CommandPaletteTrigger.tsx`). Test: Klassen/Struktur in Vitest, Wirkung in 2.5.
- [x] 2.4 Wortmarke und Trennstrich im Einsatz-Kopf nur bei `abBreite('xxl')`;
  `EinsatzLayout.test.tsx` prüft 1440 (keine) und 1600 (da).
- [x] 2.5 Neue e2e-Spec `frontend/e2e/kopfleiste-einsatzname.spec.ts`: Demo-Einsatz „ÜBUNG –
  Starkregen Musterstadt“ ungekürzt (Text nicht abgeschnitten: `scrollWidth ≤ clientWidth`) bei
  1280×800 `kompakt`, 1180×820 `handschuh`; bei 1024 `komfortabel` kürzt zuerst die Suche
  (Hinweistext weg, Lupe da), Kopf ohne waagerechten Überlauf. Lokal in Chromium grün.
- [x] 2.6 Wenn 2.5 in einem Fall rot bleibt: Rückfallweg aus D2 (`contain-intrinsic-inline-size`
  aus Messung) und dieselbe Spec grün. Sonst abhaken mit Vermerk „nicht nötig“. — Nicht nötig: rot
  war nur das geerbte `nowrap` (behoben) und `handschuh` 1180 px (dichteabhängige Basis, D2).

## 3. Kürzel und Plakette (D5, D6)

- [x] 3.1 `components/CommandPaletteTrigger.tsx`: `Tastenkuerzel` nur ohne `istBeruehrung`,
  `aria-keyshortcuts` bleibt; `CommandPaletteTrigger.test.tsx` deckt groben und feinen Zeiger ab.
- [x] 3.2 `alarm/EingaengeZahl.tsx`: Plakette mittig über dem Symbol; e2e-Fall in
  `kopfleiste-einsatzname.spec.ts` bei 390×844 mit „Ton blockiert“ und drei ungelesenen Eingängen:
  Plakette und Wort überlappen nicht, Knopfbreite gleich wie ohne Eingänge.

## 4. Bestehende Prüfungen nachziehen

- [x] 4.1 e2e-Specs an „Symbol im Ruhezustand“ anpassen, nicht abschalten:
  `kopfhoehe-tonpruefung`, `kopfzeile-start-cls`, `kopfzeile-schmal`, `gate1-ueberlauf`,
  `gate3-trefflaeche`, `alarmton-freischalten`, `orientierung`, Hilfen in `lauf-kern.ts` und
  `doku-bilder/kern.ts`; die betroffenen Specs lokal in Chromium grün.
- [x] 4.2 Design System neu erzeugen, falls der Wächter es verlangt
  (`mise exec -- pnpm -C frontend design-system`, `designSystem.guard.test.ts` grün).

## 5. Regel und Anwenderdoku

- [x] 5.1 `frontend/AGENTS.md`, Abschnitt „Rahmen“: Spiegelstrich „Kopfleiste“ (D7); Prettier grün.
- [x] 5.2 `docs/anwender/kapitel/einsatz-oberflaeche.md`: Weg zur Einsatzliste über „Alle Einsätze
  …“, Alarmzentrale und Verbindung als Symbol mit Wort bei Störung, Absatz „Auf schmalen
  Schirmen …“ und Satz „Benachrichtigung erlaubt“ berichtigt; `hilfe/anwenderdoku.guard.test.ts` grün.
- [ ] 5.3 Bilder des Kapitels neu erzeugen (`pnpm doku:bilder e2e/doku-bilder/einsatz-oberflaeche.bilder.ts`)
  und committen; was nicht läuft, als Folgeaufgabe auf dem Board und im PR genannt.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Ergebnis im PR unter „Geprüft“).
- [ ] 6.2 Bilder der Änderung vorher/nachher (1280 `kompakt`, 1180 `handschuh`, Handy mit Plakette,
  Tablet mit Finger) für PR und Meldung aufgenommen.

## Workflow follow-up

- Review vor dem PR (Agent mit frischem Kontext, Befunde gegengeprüft), Verbleib im PR.
- `/opsx:archive u13ywlws-kopfleiste-einsatzname-vorrang` im selben Branch, dann PR gegen `alpha`.
- Nach dem Merge das Design System veröffentlichen, falls 4.2 etwas erzeugt hat.
