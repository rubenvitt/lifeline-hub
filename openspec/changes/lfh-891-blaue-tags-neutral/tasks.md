# Tasks

## 1. Guard und Umstellung

- [ ] 1.1 Guard 3 in `frontend/src/theme/statusVertrag.guard.test.ts` anlegen (design.md D4): ein `describe` „kein Preset `blue` an `Tag` (LFH-891)“ mit einer Befundfunktion, die die vorhandenen Bausteine nutzt, dazu Attrappen für Literal (`color="blue"`), Ausdruck (`color={x ? 'blue' : 'default'}`), Nachbar-Prop (`icon={<Icon color="blue" />}` ohne eigenes `color` meldet nichts), Kommentar und Zeichenkette (melden nichts). Den Dateikopf um Guard 3 ergänzen. Prüfen: Der Baum-Test läuft ROT und nennt genau die acht Fundstellen aus proposal.md (ohne DMO), die Attrappen sind grün
- [ ] 1.2 Die Marken auf `Tag` ohne `color` umstellen: „ad-hoc“ in `FahrzeugePage`, `PersonalPage`, `MaterialPage`; `BesatzungsStaerkeBadge` ohne Soll samt Kommentar (D2); Halter in `TierePage` und `TiereDetailPage`; TMO und DMO in `FunkErreichbarkeit` (D3); „Führungskraft“ in `BenutzerMenu`. Prüfen: Guard 3 grün, Guard 1/2 grün
- [ ] 1.3 Bestehende Vitest-Tests der berührten Komponenten und Seiten laufen lassen und Erwartungen auf Farbklassen (`ant-tag-blue`, `ant-tag-geekblue`) anpassen, falls vorhanden. Prüfen: `mise exec -- pnpm -C frontend vitest run` für die berührten Dateien grün, `pnpm lint` und `tsc` ohne Befund
- [ ] 1.4 `frontend/AGENTS.md`, Farbachsen, Satz „Nie `color="black"` an antds `Tag`“ um Blau ergänzen: Kennzeichnungen ohne Status sind neutral wie die Demo-Marke, Blau bedient (LFH-891, Spec `farbrollen-kontrast`, Guard 3 in `theme/statusVertrag.guard.test.ts`). Prüfen: Prettier über `frontend/` grün

## 2. Browser-Nachweis

- [ ] 2.1 `frontend/e2e/marken-kontrast.spec.ts` (design.md D5), Tag und Nacht, angemeldet als Admin: Einsatz, Ad-hoc-Kraft und Ad-hoc-Fahrzeug per API seeden, in Personal- und Fahrzeugliste die Marke „ad-hoc“ mit `pruefe` gegen Tag ≥ 7 und Nacht ≥ 5 messen (Böden als Literale). Prüfen: Spec grün in light und dark. Mutationsprobe: an einer Fundstelle `color="blue"` zurücksetzen → Messung rot mit dem Wert aus proposal.md

## 3. Nachzug und Gesamtlauf

- [ ] 3.1 Übrige Kontrast-Specs laufen lassen, die die berührten Seiten treffen (`kraefte-kontrast`, `hellmodus-kontrast`, `deeplink-hervorhebung-kontrast`). Prüfen: grün
- [ ] 3.2 Die übrigen Presets an `Tag` (design.md Non-Goals) einmal im Browser stichprobenartig messen und als Nachzug auf dem Entwicklungsboard erfassen (vorher nach Duplikaten suchen), Ticketnummer hier eintragen. Prüfen: Nachzug angelegt
- [ ] 3.3 `./scripts/check-all.sh` (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt). Prüfen: Ausgabe ohne roten Schritt
