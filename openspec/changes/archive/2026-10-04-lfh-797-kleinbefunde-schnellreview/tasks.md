# Tasks

Nachtrag beim Merge von `alpha` (04.10.2026): LFH-825 hatte dieselbe Konstante parallel als
`FREIE_SKIZZE_VORGABEFARBE` eingeführt; deren Name gilt, `FREIE_SKIZZE_VORGABE` unten meint sie.

Jede Aufgabe per TDD: erst der rote Test (bzw. die Mutationsprobe), dann die Änderung.

## 1. `nosniff` an jeder Antwort (D1, Spec `http-schutzkoepfe`)

- [x] 1.1 Integrationstest `tests/schutzkoepfe.rs`: `nosniff` an einer JSON-Route, an einer
  401, an 404 unter `/api/`, am Frontend-Fallback und genau einmal an einem Anhang-Download; der
  Download des Karten-Hintergrundbilds als `download_setzt_nosniff` in
  `tests/karte_hintergrundbild.rs` (dort liegt der Upload-Harness). Prüfen: rot vor 1.2 (außer
  dem Anhang-Fall) — fünf rot, einer grün.
- [x] 1.2 Feature `set-header` an `tower-http` in `Cargo.toml`; in `src/app.rs`
  `SetResponseHeaderLayer::if_not_present(X_CONTENT_TYPE_OPTIONS, nosniff)` als äußerste Schicht
  mit Kommentar zur Lage. Prüfen: `cargo test --test schutzkoepfe` grün, `Cargo.lock` unverändert;
  Mutationsprobe (Schicht entfernt) → Test rot; `appending` statt `if_not_present` → der
  Anhang-Fall rot (doppelter Kopf).
- [x] 1.3 `src/AGENTS.md`: kurzer Abschnitt „Schutzköpfe“ (jede Antwort `nosniff` über die
  Schicht in `app.rs`, Routen dürfen ihn zusätzlich setzen, `if_not_present`), Anhang-Zeile
  verweist darauf. Prüfen: Wurzel-`AGENTS.md`-Tabelle nennt „Schutzköpfe“; `cargo fmt --check`.

## 2. Einsatzpfade nur aus `routing/deeplinks.ts` (D2, Spec `deeplink-quelle`)

- [x] 2.1 `routing/inlinePfade.guard.test.ts` auf ganz `frontend/src/` (ohne Tests, ohne
  `routing/deeplinks.ts`), Kommentar „rot geboren“ ersetzt. Das Muster greift am Anfang des
  Literals (`` `/einsaetze/${ ``), damit Server-Pfade der API-Clients (`/api/einsaetze/${…}`,
  `${BASIS}/einsaetze/${…}`) draußen bleiben. Prüfen: Guard rot mit genau den fünf Dateien.
- [x] 2.2 `etb/Schnellerfassung.tsx` → `lageberichtePfad(einsatz.id)`;
  `pages/uhs/UhsDetailPage.tsx`, `pages/bereitstellungsraum/BrDetailPage.tsx`,
  `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`, `pages/UnfallhilfsstellenPage.tsx`
  → `einsatzPfad(einsatzId)` und `einsaetzePfad()`. Prüfen: Guard grün; Seitentests der fünf
  Dateien grün; neuer Test „springt aus Typ Lage in die Lageberichtsliste“ in
  `Schnellerfassung.test.tsx` (Mutationsprobe falsche Einsatz-ID → rot). Die Brotkrumen-Ziele
  sichern die Builder-Tests in `routing/deeplinks.test.ts` (`einsatzPfad(7)` → `/einsaetze/7`).

## 3. Farbwerte an eine Quelle (D3, Specs `lagekarte-zeichnen`, `lagekarte-taktische-zeichen`)

- [x] 3.1 Zonen: `FREIE_SKIZZE_VORGABE` aus `pages/lagekarte/zonenStil.ts` exportiert (ersetzt
  `FREIE_SKIZZE_FALLBACK`), genutzt in `ZonenInspector.tsx` (Entwurf, Reset, Blur-Vergleich) und
  `Sidebar.tsx` (Fläche, Linie). Prüfen: Test in `ZonenInspector.test.tsx` „Blur ohne Änderung
  an farbloser Skizze schreibt nichts“ (Mutationsprobe: Vergleich gegen abweichende Kopie → rot);
  `grep -rn "1677ff" frontend/src/pages` außerhalb von Tests nur noch die Definition.
- [x] 3.2 Freie Zeichen: `FREIES_ZEICHEN_TINTE` aus `pages/lagekarte/marker.ts` exportiert,
  genutzt in `FreiesZeichenPicker.tsx` (Vorgabe Farbfeld) und `marker.ts`; die Kachel im
  `FreiesZeichenInspector.tsx` nimmt ohne eigene Farbe `rollen.text2`. Prüfen: Test in
  `FreiesZeichenInspector.test.tsx` (Kachel farblos ≠ `#333333`, mit Farbe = Farbe);
  `grep -rn "333333" frontend/src` nur noch in `marker.ts`.
- [x] 3.3 Palettenmaske: `paletteMaske` in `theme/tokens.ts` (modusunabhängig, Begründung im
  Kommentar), `CommandPalette.tsx` importiert sie. Prüfen: kein `rgba(` mehr in
  `command-palette/*.tsx`; Palettentests grün.

## 4. Abschluss

- [x] 4.1 `./scripts/check-all.sh` grün. Lokal (Cloud-Sitzung, 04.10.2026): Bündel `schnell`,
  `rust` (4109 Tests, Hülle eingeschlossen) und `frontend` grün. `e2e` belegt die CI des PRs:
  im Container fehlen die Playwright-Browser der gepinnten Version.
