# Tasks

Jede Aufgabe per `superpowers:test-driven-development` (erst rot, dann grün). Vitest über
`mise exec -- pnpm -C <abs>/frontend test -- <datei>`; vor „fertig" `verification-before-completion`
und `requesting-code-review`.

## 1. Schiedsrichter: Mehrdeutigkeit (D1)

- [x] 1.1 `klickziel.test.ts`: Test „oberste Fläche gewinnt" aus LFH-764 auf das neue Verhalten umschreiben (Zone über Abschnitt → `mehrdeutig`, Reihenfolge Zone, Abschnitt); neue Fälle: Zone + DWD-Fläche → `mehrdeutig` mit Zone zuerst, auch wenn die Fachebene oben liegt; Zone über `zonen-fill` + `zonen-line` → direkt `zone`; zwei Kachel-Duplikate einer Fachebenen-Meldung ohne `id` → direkt `fachebene`; Trefferzone bzw. Punktziel über zwei Flächen → Marker bzw. Punktziel. Rot belegen.
- [x] 1.2 `entscheideKlickziel` um `{ art: 'mehrdeutig'; flaechen }` und `Flaechenziel` erweitern (Entdoppelschlüssel, Gruppierung eigene vor Fachebene); Tests aus 1.1 grün, übrige `klickziel.test.ts` unverändert grün.

## 2. Kennung und Eintragsstil (D3, D4)

- [x] 2.1 `fachebeneTitel(quelle, props)` aus `FachebenenInspector.tsx` als reine Funktion (ohne Emoji) herausziehen, Inspector setzt sein Zeichen selbst davor; Vitest für DWD-Ereignis, NINA, `titel`/`name`, Rückfall; `FachebenenInspector.test.tsx` unverändert grün.
- [x] 2.2 `typ` als Merkmals-Eigenschaft in `ZoneFeature`, `baueZonenFc` und `useLagekarteDaten` (`zonenFeatures`) ergänzen; Vitest in `kartenLayer`-Tests prüft `properties.typ`.
- [x] 2.3 `pages/lagekarte/flaechenwahl.ts`: `flaechenKennung(ziel, kontext)` und `flaechenwahlEintragStil(token)`; `flaechenwahl.test.ts` für Zone mit/ohne Label (Typbezeichnung aus `ZONE_TYPEN`), Abschnitt, Fachebene mit/ohne Titel, kein Emoji, keine ID im Text, Stilböden 30/48/72 als Literale.

## 3. Menü-Bauteil (D3)

- [x] 3.1 `FlaechenwahlMenue.test.tsx` zuerst: Einträge in übergebener Reihenfolge mit Kennung; ArrowDown+Enter wählt den zweiten und ruft `onSchliessen`; Esc schließt ohne Wahl; Fokus geht an das übergebene Ziel zurück; `escGehoertOverlay` ist bei offenem Menü `true`. Rot belegen.
- [x] 3.2 `pages/lagekarte/FlaechenwahlMenue.tsx` bauen (Punktanker, gesteuertes antd-`Dropdown`, `autoFocus`, `aria-label="Fläche wählen"`, Eintragsstil aus 2.3); Tests aus 3.1 grün; `dichte.guard.test.ts` grün (kein `size="small"`).

## 4. Karte verdrahten (D2, D5)

- [x] 4.1 `Kartenflaeche.tsx`: Prop `flaechenwahl` (Ref), globaler Klick-Hörer öffnet bei `mehrdeutig` das Menü, `movestart` schließt es, Wahl über gemeinsame Hilfsfunktion auf `onZoneKlick`/`onFlaecheKlick`/`onFachebeneKlick` (Fachebenen-Auswertung mit dem Fachebenen-Hörer geteilt), Fokus zurück an den Kartencontainer; bestehende Vitests der Lagekarte grün.
- [x] 4.2 `LagekartePage.tsx`: `flaechenwahl={!exklusiverModusAktiv}` durchreichen; Vitest oder bestehender Seitentest belegt, dass die Prop im exklusiven Modus `false` ist.

## 5. e2e unter Touch (D7)

- [x] 5.1 `lagekarte-touch.spec.ts` (Touch, 1024 px): Zone und Abschnitt überlappend per API anlegen, Tipp in die Überschneidung (Trefferwache `elementFromPoint`) → Menü mit beiden, Abschnitt tippen → Abschnitts-Inspector; Menüeintrag-Bounding-Box ≥ `controlHeight` der Stufe.
- [x] 5.2 Gleiche Spec: DWD per `page.route` mit Warnfläche über der Zone stubben, Ebene einschalten, Tipp → Menü „Zone" vor „Wetterwarnungen (DWD)", Warnung tippen → Fachebenen-Detail.
- [x] 5.3 Gleiche Spec: Marker in der Zone, Tipp in seinen Ring → Marker-Inspector, kein Menü (`[role="menu"]` abwesend).
- [x] 5.4 Mutationsprobe: `mehrdeutig`-Zweig aus (oberste Fläche zurückgeben) → 5.1/5.2 rot, zurückdrehen → grün; Befund in der Prüfliste (6.1) festhalten.

## 6. Prüfliste und Doku

- [x] 6.1 `docs/superpowers/specs/2026-09-29-lfh-812-pruefliste.md` nach dem Muster von LFH-712: 15 Kriterien der Einsatztauglichkeit, je Zeile Verdikt (erfüllt / offen → Ticket / nicht anwendbar), Mutationsprobe aus 5.4.
- [x] 6.2 `CLAUDE.md`, Abschnitt Lagekarte: eine Zeile zum Flächen-Auswahlmenü (Träger `klickziel.ts` `mehrdeutig`, `FlaechenwahlMenue.tsx`, Sperre über `flaechenwahl`); `check-fmt.sh` grün.

## 7. Integration

- [x] 7.1 `./scripts/check-all.sh` (eigenes `CARGO_TARGET_DIR` im Scratchpad) vollständig grün, Log nach „ÜBERSPRUNGEN" durchsehen.
  Stand 29.09.2026 nach dem Umsetzen auf `alpha` (LFH-764 gemergt): Schritte 1–6 und 8–12 grün,
  kein Schritt übersprungen. Schritt 7 (e2e) 405/407; die zwei roten Fälle (`kopfzeile-schmal`
  „Ton blockiert", `lagekarte-betreuung` Fachmodul-Link) liefen im Nachlauf 45/45 grün
  (`--repeat-each=3`). Ein früherer Lauf unter Last: Nachzug LFH-823.
