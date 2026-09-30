# Tasks

## 1. Backend: Abrufzeitpunkt im Umschlag

- [ ] 1.1 `FachebeneAntwort.abgerufen: Option<String>` in `src/karte/typen.rs` mit `#[serde(default, skip_serializing_if = "Option::is_none")]`; `ok()` setzt den Zeitpunkt (RFC 3339, UTC, Sekunden), `offline()` lässt ihn weg. Nachweis: Unit-Tests in `typen.rs` (ok trägt einen Zeitpunkt nahe jetzt; offline serialisiert **ohne** Schlüssel, geprüft per `contains_key`)
- [ ] 1.2 Rückfall in `src/karte/cache.rs`: `eintrag`, `frisch` und `stale` füllen ein fehlendes `abgerufen` aus `gespeichert_at`, ein vorhandenes bleibt. Nachweis: Tests mit einem per SQL eingelegten Eintrag ohne Feld und zurückdatiertem `gespeichert_at` (Wert = dieser Zeitpunkt) sowie Round-Trip mit Feld (Wert unverändert)
- [ ] 1.3 Stale-Serving bleibt: Test in `src/karte/quellen.rs`, der über `liefere_mit_swr` einen 30 h alten Eintrag bei scheiterndem `erneuere` ausliefert und `status: ok` plus das alte `abgerufen` prüft (kein „jetzt“)
- [ ] 1.4 Energie: `baue_energie_antwort` nimmt das ältere `abgerufen` der nicht-offline Teile. Nachweis: Tests „beide Teile“ (älterer gewinnt), „nur OSM“, „nur MaStR“, „keiner“ (fehlt) neben den bestehenden Energie-Tests
- [ ] 1.5 KRITIS: `kritis::bestand::abfrage` setzt `abgerufen` aus `meta.importiert_at`, auch nach `bestaetige_unveraendert`; `stand` bleibt das Extrakt-Datum. Nachweis: Test in `bestand.rs`
- [ ] 1.6 Route: Integrationstest gegen `GET /api/karte/fachebenen/{quelle}` mit vorbefülltem Cache (ok mit `abgerufen`, offline ohne den Schlüssel, HTTP 200 in beiden Fällen)
- [ ] 1.7 Typ-Codegen: `scripts/check-typ-codegen.sh` ausführen und `frontend/src/api/openapi.json` sowie `types.generated.ts` mitcommitten; das Skript ist danach grün

## 2. Frontend: Einstufung und Datenfluss

- [ ] 2.1 `useMinutenTakt` aus `components/Kopfleiste.tsx` nach `components/useMinutenTakt.ts` verschieben, `Kopfleiste` importiert von dort. Nachweis: bestehende Kopfleisten-Tests grün, `pnpm lint` grün
- [ ] 2.2 `FachebeneDef.veraltetNachMin` je Ebene nach der Tabelle in `design.md` (D3) und reine Funktion `fachebeneAlter(key, abgerufen, jetztMs)` in `pages/lagekarte/fachebenen.ts`. Nachweis: Tests in `fachebenen.test.ts` für die Grenze (genau auf der Schwelle nicht veraltet, eine Minute darüber veraltet), Zukunftswert (Alter 0), fehlender und unlesbarer Zeitpunkt (`null`) und eine Registry-Probe, dass jede Ebene eine Schwelle trägt
- [ ] 2.3 `useFachebenen` liefert `fachebenenAbgerufen` aus `q.data?.abgerufen`, auch bei `isError`. Nachweis: Test in `useFachebenen.test.tsx`, dass nach einem gescheiterten Folgeabruf Status `offline` **und** der alte Zeitpunkt anliegen

## 3. Frontend: Anzeige

- [ ] 3.1 Sidebar-Zeile (`pages/lagekarte/Sidebar.tsx`): Mono-Zeile „Stand …“ (`formatZeitKurz`) unter Label und Geltung bei zugeschalteter Ebene mit Zeitpunkt; jenseits der Schwelle „⧖ veraltet ·“ in `rollen.achtungText`, ⧖ `aria-hidden`. Nachweis: Tests in `Sidebar.test.tsx` für heute („Stand 1430“), Vortag, veraltet (Wort im zugänglichen Text), ausgeschaltet (nichts), Server-offline ohne Zeitpunkt (nichts), offline mit gehaltenem Zeitpunkt (beides), Fortschreiten über die Schwelle unter Fake-Timern ohne neuen Abruf
- [ ] 3.2 Inspector: Prop `abgerufen` an `FachebenenInspector`, Zeile „Ebene abgerufen“ mit `taktischeDtgVoll` und gegebenenfalls „veraltet“; `LagekartePage` reicht den Wert durch. Nachweis: Test in `FachebenenInspector.test.tsx` (Hochwasser-Pegel mit altem Stand zeigt Meldeklasse, DTG und „veraltet“; ohne Prop keine Zeile)
- [ ] 3.3 Prüfliste Einsatztauglichkeit (15 Kriterien) für die geänderte Panelzeile und den Inspector ausfüllen, jede Zeile mit Verdikt, abgelegt als `openspec/changes/lfh-591-fachebenen-datenalter/pruefliste.md`

## 4. Dokumentation

- [ ] 4.1 `docs/fachebenen-quellen.md`: Umschlag um `abgerufen` ergänzen (Abgrenzung zu `stand`), Offline-Absatz um die Altersanzeige, Schwellen-Tabelle je Ebene samt Begründung und den KRITIS-Hinweis zum konfigurierbaren Intervall. Nachweis: die Tabelle deckt sich mit `veraltetNachMin` in `fachebenen.ts` (Durchsicht im Review)

## 5. Integration und Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (bzw. mit Verweis auf den CI-Lauf des PRs abhaken), insbesondere Gate 1 und `lagekarte-leiste-dichte.spec.ts` mit der höheren Panelzeile
- [ ] 5.2 Change per `/opsx:archive` im selben Branch archivieren (Spec-Sync nach `openspec/specs/lagekarte-fachebenen/`, Verweise nachziehen), `scripts/check-openspec-archiv.sh` grün
