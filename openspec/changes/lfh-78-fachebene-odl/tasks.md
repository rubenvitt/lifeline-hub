# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst den roten
Test, dann den Code. Referenz für alle Berührpunkte ist der LFH-77-Commit `c2c7942c`.

## 1. Backend: Normalisierung und Stufen

- [ ] 1.1 In `src/karte/normalisierung.rs` einen Modul-Test `odl_tests` mit einem kleinen BfS-Rohfixture (je eine Sonde „in Betrieb", „defekt", „Testbetrieb") anlegen und `normalisiere_odl` bauen: Punkt-Features mit `id`, `name`, `wert` (µSv/h oder fehlend), `einheit`, `messende`, `betrieb`, `stufe`, `kategorie: "odl"`; verifiziert durch `cargo test --lib odl_tests`
- [ ] 1.2 Stufenfunktion mit den Bändern aus der Spec (≤ 0,2 `normal`, ≤ 0,6 `erhoeht`, darüber `stark_erhoeht`, kein Wert `keine_messung`) samt Grenzwert-Tests 0,2 / 0,21 / 0,6 / 0,61 und einem Test, der die vier Wire-Wörter wörtlich pinnt; verifiziert durch `cargo test --lib odl_tests`
- [ ] 1.3 Robustheit: Feature ohne Geometrie oder mit kaputter Koordinate wird verworfen, fehlende `features` ergeben eine leere Collection statt Panik; verifiziert durch je einen Test in `odl_tests`

## 2. Backend: Abruf und Route

- [ ] 2.1 In `src/karte/quellen.rs` `fetch_odl`/`erneuere_odl` nach DWD-Vorbild (`hole_json` auf `odlinfo_odl_1h_latest`, TTL 600 s, Attribution „Bundesamt für Strahlenschutz (BfS), dl-de/by-2-0", Cache-Schlüssel `odl`, Fehler → `None` mit `tracing::warn!`); verifiziert durch `cargo build`
- [ ] 2.2 `match`-Arm `"odl"` in `src/routes/karte.rs` und Integrationstest `fachebenen_odl_wird_bedient` in `tests/karte.rs` nach dem Muster von `fachebenen_hochwasser_wird_bedient` (Cache vorbelegt → 200, `quelle: "odl"`, Features durchgereicht); verifiziert durch `cargo test --test karte fachebenen_odl`

## 3. Frontend: Typen und Statusfarb-Vertrag

- [ ] 3.1 `api/fachebenen.ts`: `'odl'` in `FachebeneQuelle`, FE-lokaler Typ `OdlStufe` mit Doc-Kommentar zum Pin; `api/queryKeys.ts`-Kommentar ergänzen; Byte-Pin `globalKeys.fachebene('odl')` in `api/globalKeys.test.ts`; verifiziert durch `pnpm vitest run src/api/globalKeys.test.ts` und `tsc` (aus `check-typ-codegen.sh`)
- [ ] 3.2 `theme/statusFarben.ts`: Vertragskarte `odlStufe` (neutral / normal / achtung / alarm, Labels aus design.md) mit Kopfkommentar zur Projekt-Einteilung; Abdeckungstest in `statusFarben.test.ts` auf 17 heben und die Rollen je Stufe prüfen; verifiziert durch `pnpm vitest run src/theme`

## 4. Frontend: Ebene, Stil, Laden

- [ ] 4.1 Neues `pages/lagekarte/odlStil.ts` (`faerbeOdl`, `odlRadius`, `odlDarstellung`, Rückfall unbekanntes Wort → `keine_messung`) mit `odlStil.test.ts`: Radius streng steigend über die vier Stufen, Farbe aus dem Token je Modus, Wire-Wörter wörtlich gepinnt; verifiziert durch `pnpm vitest run src/pages/lagekarte/odlStil.test.ts`
- [ ] 4.2 `fachebenen.ts` (`FACHEBENEN.odl` mit Label, `#7cb305`, `pollMs: 600_000`, `geltung`; `fachebeneKeys()` hinter `hochwasser`), `fachebenenAuswahl.ts` (`odl: false`), `fachebenenLayer.ts` (`KATEGORIE_LABEL.odl`) samt Anpassung von `fachebenen.test.ts`/`fachebenenLayer.test.ts`; verifiziert durch `pnpm vitest run src/pages/lagekarte/fachebenen`
- [ ] 4.3 `useFachebenen.ts`: siebte Query in `useQueries` (Reihenfolge = `fachebeneKeys()`, `byKey` mitziehen) und `faerbeOdl` beim Zusammensetzen der aktiven Ebenen; Test in `useFachebenen.test.tsx`, dass ODL-Features `farbe`/`radius` tragen und die Attribution bei sichtbarer, nicht-offline Ebene erscheint; verifiziert durch `pnpm vitest run src/pages/lagekarte/useFachebenen.test.tsx`
- [ ] 4.4 `useKartenAnsicht.ts`: `odl: o.odl === true` als Aufzählung; Test in `useKartenAnsicht.test.tsx`, dass ein gespeicherter Stand ohne `odl` als „aus" gelesen wird und `odl: true` erhalten bleibt; verifiziert durch `pnpm vitest run src/pages/lagekarte/useKartenAnsicht.test.tsx`

## 5. Frontend: Inspector

- [ ] 5.1 `FachebenenInspector.tsx`: `OdlInhalt` mit Standortname, Wert (3 Nachkommastellen, de-DE, µSv/h; bei fehlendem Wert „kein Messwert"), Messende in Ortszeit, Betriebsstatus, `StatusTag` der Stufe und dem Hinweissatz „kein amtlicher Schwellenwert"; Tests in `FachebenenInspector.test.tsx` für eine erhöhte und eine defekte Sonde, inkl. Präsenz des Hinweissatzes; verifiziert durch `pnpm vitest run src/pages/lagekarte/FachebenenInspector.test.tsx`

## 6. Doku und Abschluss

- [ ] 6.1 `docs/fachebenen-quellen.md`: Tabellenzeile `odl` (Endpoint, Format, Lizenz GeoNutzV/dl-de/by-2-0, Attribution, TTL 600 s, Offline) und Abschnitt mit den Messbefunden aus design.md, der Bänder-Herkunft („Projekt-Einteilung, keine BfS-Schwelle"), dem Regen-Effekt und dem Grund gegen den Grundpegel (Zeitreihe = eine Sonde je Abruf); verifiziert durch Lesen des gerenderten Abschnitts und `prettier --check` in Schritt 6.3
- [ ] 6.2 Folgeticket „standortbezogener ODL-Grundpegel" über den Skill `clickup-task-anlegen` anlegen und in der Doku verlinken; verifiziert durch die Ticketnummer im Doku-Abschnitt
- [ ] 6.3 Voller Gate-Lauf `./scripts/check-all.sh` grün (fmt/Prettier, Lint, Typ-Codegen, `cargo test`, Vitest, e2e); verifiziert durch Exit-Code 0
- [ ] 6.4 Browser-Sichtprüfung auf der Lagekarte (Dev-Stack): Ebene zuschalten, Sonden erscheinen, Inspector zeigt Wert + Hinweis, Attribution unten rechts, Hell/Dunkel; verifiziert durch Screenshot
