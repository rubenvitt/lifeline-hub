# Tasks

## 1. Abbaureihenfolge (D1)

- [x] 1.1 `frontend/src/pages/lagekarte/messZeichnung.test.ts` und `zeichnen.test.ts`: `zerstoeren()` übersteht einen werfenden `draw.stop()`; in `zeichnen.ts` läuft `zuruecksetzen()` trotzdem (Stand gemeldet). Prüfen: rot vor 1.2 — Ergebnis: rot vor 1.2 (Wurf aus `stop()` schlug durch), danach grün.
- [x] 1.2 `messZeichnung.ts`, `zeichnen.ts`: `zerstoeren()` mit `try`/`finally` absichern, Kommentar mit Verweis auf `lagekarte/AGENTS.md`, „Zeichnen und Messen“. Prüfen: 1.1 grün — Ergebnis: grün.
- [x] 1.3 `Kartenflaeche.tsx`: Controller und Bildgriffe im Cleanup des Karten-Effekts vor `map.remove()` abbauen und nullen, separaten Abbau-Effekt entfernen, Kommentar mit Regelverweis. Prüfen: Vitest der Lagekarte grün — Ergebnis: grün; zusätzlich `Kartenflaeche.ressourcen.test.tsx` (Messen, Abschnitt, Zone und Griffe vor `map.remove()`). Die Griffe räumt ihr eigener Effekt nur noch ab, wenn sie noch dran sind.
- [x] 1.4 e2e (eigene Spec `frontend/e2e/lagekarte-modulwechsel.spec.ts`): Messen, Zone und Abschnitt je starten, einen Punkt setzen, ohne „Beenden“ über die Rail ins ETB; erwartet ETB-Inhaltsanker, keine Fehlerseite, kein `pageerror`. Messen zusätzlich als Beobachter (`e2e/rollen-kern.ts`) bei 390 und 1440 px. Kein `networkidle`. Prüfen: grün; Mutationsprobe: mit dem alten Abbau-Effekt (Reihenfolge zurückgedreht) rot — Ergebnis: 5 Fälle grün; mit zurückgedrehtem Abbau rot (Fehlerseite, `TypeError … setData`).

## 2. Warteschlange je Karte und Schlüssel (D2, D3)

- [x] 2.1 `kartenDaten.test.ts`: 50 Aufrufe mit demselben Schlüssel bei unbereiter Karte → genau ein `render`-Hörer, nur das letzte `anwenden` läuft; zwei Schlüssel laufen in der Folge ihrer letzten Anmeldung; bereit, aber Schlange nicht leer → hinten anreihen; bereit heißt `style._loaded`, nicht `isStyleLoaded()`; ohne `style` (entfernte Karte) nie bereit. Bestehende Fälle auf die neue Signatur. Prüfen: rot vor 2.2 — Ergebnis: rot vor 2.2, 9 Fälle.
- [x] 2.2 `kartenDaten.ts`: Warteschlange nach D2/D3, Kommentar mit dem Prüfergebnis zu `_loaded` (maplibre 6.11.2). Prüfen: 2.1 grün — Ergebnis: grün.
- [x] 2.3 Aufrufer auf Schlüssel umstellen (`Kartenflaeche.tsx`, `kartenLayer.ts`), Kommentare zur Vertagung nachziehen. Prüfen: `tsc`, Vitest der Lagekarte grün — Ergebnis: `tsc` sauber, Vitest der Lagekarte grün.

## 3. Bild-URLs (D4)

- [x] 3.1 `frontend/src/pages/lagekarte/useKartenbilder.test.tsx` (neu): Download auflösen lassen, nachdem der Effekt neu gelaufen ist → kein zweiter `fetch` für dieselbe ID, URL übernommen; nach dem Aushängen bzw. Einsatzwechsel → `revokeObjectURL` für die späte URL, Abbruchsignal gesetzt; Bild verlässt die Liste vor Ankunft → URL sofort freigegeben. Prüfen: rot vor 3.2/3.3 — Ergebnis: 6 Fälle, rot vor 3.3.
- [x] 3.2 `frontend/src/api/kartenbilder.ts`: `ladeBildBlobUrl(einsatzId, id, signal?)` mit `AbortSignal.any([signal, AbortSignal.timeout(15_000)])`. Prüfen: `kartenbilder.test.ts` grün — Ergebnis: grün; der Ersatz ohne `AbortSignal.any` meldet seine Hörer nach dem Download ab (eigener Fall, Mutationsprobe rot).
- [x] 3.3 `useKartenbilder.ts`: `imFlug`, Ref der aktiven IDs, `AbortController` je `einsatzId`, Entscheidung bei Ankunft, Abbruch ohne Fehlermeldung. Prüfen: 3.1 grün — Ergebnis: grün.

## 4. Abschnittsflächen (D5)

- [x] 4.1 Vitest mit Karten-Mock (`Kartenflaeche`): `setData` auf `abschnitte` zählen — Rerender mit inhaltsgleichen Flächen und eine neue Eigenposition lösen keins aus, eine echte Änderung genau eins. Prüfen: rot vor 4.2 — Ergebnis: rot vor 4.2.
- [x] 4.2 `Kartenflaeche.tsx`: Inhaltsschlüssel vor `setData`; `flaechenDatenRef` bleibt Quelle der Neuanlage. `LagekartePage.tsx`: `useMemo` und `LEER_FLAECHEN`. Prüfen: 4.1 grün; Mutationsprobe: Vergleich entfernt → rot — Ergebnis: grün; Mutationsprobe rot. `LagekartePage.test.tsx` prüft die gleichbleibende Referenz.

## 5. Liegezeit KRITIS/Energie (D6)

- [x] 5.1 `useFachebenen.test.tsx`: bbox mehrfach wechseln, nach 5 min (Fake-Timer) höchstens der aktuelle KRITIS- und Energie-Eintrag im Cache; Rückkehr innerhalb von 5 min ruft KRITIS nicht neu ab. `new QueryClient()` bzw. Observer (Testfalle `frontend/AGENTS.md`). Prüfen: rot vor 5.2 — Ergebnis: rot vor 5.2.
- [x] 5.2 `useFachebenen.ts`: `BBOX_ABFRAGE_GC_MS` mit Begründung für beide Abfragen. Prüfen: 5.1 grün — Ergebnis: grün.

## 6. Regel und Gesamtlauf

- [x] 6.1 `frontend/src/pages/lagekarte/AGENTS.md`, „Zeichnen und Messen“: Abbaureihenfolge „Controller vor `map.remove()`“ als Regel; Abschnitt LFH-668/Kartengrundlage: `wendeKartenDatenAn` mit Schlüssel, bereit ab Style-JSON. Prüfen: Prettier über `frontend/` grün — Ergebnis: Prettier grün.
- [x] 6.2 e2e der Lagekarte mitlaufen lassen (`lagekarte-touch`, `lagekarte-kartengrundlage`, `lagekarte-kachelpfad`, `lagekarte-smoke`, `fachebenen-*`, Lagemonitor der Geräte). Prüfen: grün oder in der Umgebung auf `alpha` genauso rot (Gegenprobe dokumentieren) — Ergebnis: `fachebenen-*`, `geraet-lagemonitor`, `lagekarte-*` (Chromium, 2 Worker): 86 grün, 1 übersprungen (`lagekarte-offline-precache` braucht das Prod-Bundle, das Schritt 7 baut).
- [x] 6.3 `./scripts/check-all.sh` (Bündel, die in der Cloud-Sitzung laufen), Vitest voll, Typecheck, Lint. Prüfen: grün oder umgebungsbedingt rot wie auf `alpha`; voller Lauf über die CI des PRs — Ergebnis: `--nur schnell` grün; `tsc`, ESLint und Prettier über die geänderten Dateien sauber; Vitest der Lagekarte, der Geräte und der Lagekarten-Seite (87 Dateien) grün bis auf die zwei ODL-Fälle in `FachebenenInspector.test.tsx`, die in dieser Umgebung auf `alpha` genauso rot sind. Der volle Lauf (`--nur frontend` und alles übrige) läuft über die CI des PRs.
