# Tasks

Jede Aufgabe per TDD: erst der rote Test (bzw. die Mutationsprobe), dann die Änderung.

## 1. `nosniff` an jeder Antwort (D1, Spec `http-schutzkoepfe`)

- [ ] 1.1 Integrationstest `tests/schutzkoepfe.rs`: `nosniff` an einer JSON-Route, an 404 unter
  `/api/`, an der Startseite, am Download des Karten-Hintergrundbilds und genau einmal an einem
  Anhang-Download. Prüfen: rot vor 1.2 (außer dem Anhang-Fall).
- [ ] 1.2 Feature `set-header` an `tower-http` in `Cargo.toml`; in `src/app.rs`
  `SetResponseHeaderLayer::if_not_present(X_CONTENT_TYPE_OPTIONS, nosniff)` als äußerste Schicht
  mit Kommentar zur Lage. Prüfen: `cargo test --test schutzkoepfe` grün, `Cargo.lock` unverändert;
  Mutationsprobe (Schicht entfernt) → Test rot.
- [ ] 1.3 `src/AGENTS.md`: kurzer Abschnitt „Schutzköpfe“ (jede Antwort `nosniff` über die
  Schicht in `app.rs`, Routen dürfen ihn zusätzlich setzen, `if_not_present`), Anhang-Zeile
  verweist darauf. Prüfen: Wurzel-`AGENTS.md`-Tabelle nennt `src/AGENTS.md` weiter passend;
  `cargo fmt --check`.

## 2. Einsatzpfade nur aus `routing/deeplinks.ts` (D2, Spec `deeplink-quelle`)

- [ ] 2.1 `routing/inlinePfade.guard.test.ts` auf ganz `frontend/src/` (ohne Tests, ohne
  `routing/deeplinks.ts`), Kommentar „rot geboren“ ersetzt. Prüfen: Guard rot mit genau den fünf
  Dateien.
- [ ] 2.2 `etb/Schnellerfassung.tsx` → `lageberichtePfad(einsatz.id)`;
  `pages/uhs/UhsDetailPage.tsx`, `pages/bereitstellungsraum/BrDetailPage.tsx`,
  `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`, `pages/UnfallhilfsstellenPage.tsx`
  → `einsatzPfad(einsatzId)` und `einsaetzePfad()`. Prüfen: Guard grün; bestehende Seitentests
  der fünf Dateien grün (Ziel der Brotkrume/des Sprungs, wo ein Test es prüft).

## 3. Farbwerte an eine Quelle (D3, Specs `lagekarte-zeichnen`, `lagekarte-taktische-zeichen`)

- [ ] 3.1 Zonen: `FREIE_SKIZZE_VORGABE` aus `pages/lagekarte/zonenStil.ts` exportiert (ersetzt
  `FREIE_SKIZZE_FALLBACK`), genutzt in `ZonenInspector.tsx` (Entwurf, Reset, Blur-Vergleich) und
  `Sidebar.tsx` (Fläche, Linie). Prüfen: Test in `ZonenInspector.test.tsx` „Blur ohne Änderung
  an farbloser Skizze schreibt nichts“; `grep -rn "1677ff" frontend/src/pages` leer.
- [ ] 3.2 Freie Zeichen: `FREIES_ZEICHEN_TINTE` aus `pages/lagekarte/marker.ts` exportiert,
  genutzt in `FreiesZeichenPicker.tsx` (Vorgabe Farbfeld) und `marker.ts`; die Kachel im
  `FreiesZeichenInspector.tsx` nimmt ohne eigene Farbe `rollen.text2`. Prüfen: Test in
  `FreiesZeichenInspector.test.tsx` (Kachel farblos ≠ `#333333`, mit Farbe = Farbe);
  `grep -rn "333333" frontend/src` nur noch in `marker.ts`.
- [ ] 3.3 Palettenmaske: `paletteMaske` in `theme/tokens.ts` (modusunabhängig, Begründung im
  Kommentar), `CommandPalette.tsx` importiert sie. Prüfen: kein `rgba(` mehr in
  `command-palette/*.tsx`; Palettentests grün.

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh` grün (Rust- und Frontend-Bündel).
