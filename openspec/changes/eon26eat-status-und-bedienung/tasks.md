# Tasks

Jede Aufgabe mit Verhaltensänderung entsteht per TDD: zuerst der Test, der ohne die Änderung rot
ist. Pfade im Frontend relativ zu `frontend/src/`, im Backend zu `src/`. Entscheidungen D1–D11 in
`design.md`.

## 1. Entwurf (D11)

- [x] 1.1 Entwurf im Artifact-Typ „Design“ auf Grundlage des Design Systems „Lifeline Hub“: `Status` (klein, normal), `Marke` (mit und ohne Entfernen), Statusknopf (drei Dichten), Statusmenü mit Kopf (Handschuh zweispaltig), Tableau-Kachel (gross, mit und ohne Schreibrecht), Nacht und Tag; Ablage unter `docs/design/2026-11-18-status-baustein/`. Nachweis: Dateien liegen dort, Abweichungen von D1–D9 sind vorgelegt oder es gibt keine

## 2. l8zlpr35 (LLH-1779): Baustein `Status` und `Marke`

- [ ] 2.1 `Status` in `components/instrument/Status.tsx` nach D1 (Größen, Formzeichen nach Rolle, Mandantenpunkt, `data-lfh="status"`, `data-ton`), Tests in `components/instrument/Status.test.tsx` rot→grün (randlos, Höhe je Größe, Zeichen je Rolle, Wort als Titel bei `code`)
- [ ] 2.2 `Marke` in `components/instrument/Marke.tsx` nach D2, mit `onEntfernen` (Rahmen, Knopf ✕, Dichtehöhe); Tests rot→grün; Kontrastnachweis der Beschriftung in `theme/` (Tag ≥ 7, Nacht ≥ 5) grün
- [ ] 2.3 Codemod für `StatusTag`/`StatusChip` → `Status` (Skript im Scratchpad, nicht committet); Stellen umstellen, Größe `klein` in Tabellen und Rastern, `normal` in Kopf und Detail; `StatusTag.tsx` und `StatusChip` entfernen. Nachweis: `grep -r "StatusTag\|StatusChip" frontend/src` leer, `tsc` grün
- [ ] 2.4 Rohe `Tag` umstellen: Zustände → `Status`, Kennzeichnungen → `Marke`, Filter-Marken (`KraefteuebersichtPage`, `kraefte/SammelGruende.tsx`) → `Marke` mit `onEntfernen`; bestehende `*Marke`-Bausteine auf `Marke`. Nachweis: Tests der berührten Seiten grün
- [ ] 2.5 Farbige Mono-Wörter für Zustände („neu“, „offen“ u. a., per `grep` nach `color: rollen.*` an Statuswörtern) auf `Status klein`; Nachweis: Liste der Fundstellen im Commit, Tests grün
- [ ] 2.6 Sperre nach D5 in `eslint.config.js` mit Gegenprobe (eine Datei mit `import { Tag } from 'antd'` macht `pnpm lint` rot); `<Tag color>`-Prüfung in `theme/statusVertrag.guard.test.ts` entfernen, Vertragswächter bleibt grün
- [ ] 2.7 Unit-Tests mit `.ant-tag`, `status-chip`, `data-darstellung` auf die neuen Attribute umstellen; Vitest grün

## 3. yvblv5xx (LLH-1780): Rahmen heißt bedienbar

- [ ] 3.1 `StatusKnopf` nach D4 (Fläche, Rahmen in der Rollenkante, Zeichen, 14 px, Pfeil ▾, volle Knopfhöhe) und `StatusWahl` darauf umstellen; Tests in `components/StatusWahl.test.tsx` rot→grün (mit Schreibrecht Rahmen und Pfeil, ohne weder noch, sichtbare Höhe = `controlHeight` je Dichte)
- [ ] 3.2 Kontrastnachweis in `theme/bedienKontrast.test.ts`: Knopfrand je Rolle gegen Zeilenfläche und eigene Fläche ≥ 3 : 1, Tag und Nacht; Beschriftung ≥ Textboden
- [ ] 3.3 `personen/ZeilenSichtung.tsx` nach D6 (äußerer Rahmen, Pfeil, Dichtehöhe um das BBK-Feld); Test rot→grün
- [ ] 3.4 e2e: `kraefte-kontrast.spec.ts` misst den Knopfrand statt des Etiketts; `marken-kontrast`, `verpflegung-kontrast`, `betroffene-kontrast`, `aufbewahrung`, `betreuung-pruefliste`, `pegel-pruefliste`, `abloesung-kontrast`, `gate3-trefflaeche` und die übrigen Specs mit `.ant-tag`/`status-chip` nachziehen; neu in `gate3-trefflaeche`: sichtbare Höhe des Statusknopfs im Handschuh-Betrieb = 72 px. Nachweis: die geänderten Specs einzeln grün

## 4. cfv89pp5 (LLH-1781): Statuswechsel mit Quittung

- [ ] 4.1 Migration `status_gesetzt_von`, `status_vorher_id`, `status_vorher_seit`, `status_ereignis_id` (nächste freie Nummer nach `scripts/check-migrationen.sh`), Eintrag in `einsatz/schwaerzung_registry.rs`; `update_tx` setzt die Spalte bei echtem Wechsel; Test in `fahrzeug/disposition_repo.rs` rot→grün; `migrationsnummern_sind_eindeutig` grün
- [ ] 4.2 `einheit_ereignis`/`aus_fahrzeugstatus_tx` geben die Ereignis-id zurück; PATCH-Antwort mit `status_ruecknahme` (D8); `scripts/check-typ-codegen.sh`, beide erzeugten Dateien mitcommitten; Integrationstest: Wechsel liefert Beleg, kein Wechsel liefert keinen
- [ ] 4.3 Route `POST …/fahrzeuge/{ef_id}/status/zuruecknehmen` nach D8; Integrationstests je Szenario der Spec `fahrzeugstatus-quittung` (Rückgängig mit „seit“ von davor und gestrichenem Ereignis samt Kopien, ETB-Text, inzwischen gewechselt → 409, andere Person → 409, elf Minuten → 409, Streichen scheitert → 409 und nichts geändert, ohne Schreibrecht → 403) rot→grün
- [ ] 4.4 `api/einsatzFahrzeuge.ts`: `nimmStatuswechselZurueck`; `zeigeStatusQuittung` in `kommunikation/rueckgaengig.tsx` (D10) mit Tests (Text, Schlüssel je Fahrzeug, 409-Wortlaut)
- [ ] 4.5 `FahrzeugePage` (Liste, Karte, Tableau) und `einheit/FahrzeugeBesatzung.tsx` zeigen die Quittung nach jedem Wechsel; Tests rot→grün, im Tableau auch nach Zifferntaste und mit Fokus auf der Kachel
- [ ] 4.6 `StatusWahl`: `titel` als Menügruppe, Höhenbegrenzung, Kippen, Handschuh zweispaltig (D7); Fahrzeugstellen setzen den Rufnamen; Tests rot→grün; e2e neu: Tablet 1024 × 768 oberste Zeile (S1 im Fenster) und Handschuh 1366 × 520 (S9 und S0 sichtbar) grün

## 5. i1f9s2w7 (LLH-1782): FMS-Tableau

- [ ] 5.1 `StatusKnopf` Variante `gross` und `Status` gross ohne Schreibrecht (D9); Tests rot→grün (Ziffer 40 px, Wort darunter, Mindesthöhe)
- [ ] 5.2 `kraefte/FmsTableau.tsx`: Rufname 22 px Mono, Typ und Einheit, „seit“, Statusblock, Raster `minmax(min(100%, 240px), 1fr)`; `FmsTableau.test.tsx` (Kachelinhalt mit Typ, ohne Schreibrecht) rot→grün; Fokusrückgabe und Zifferntasten grün
- [ ] 5.3 `e2e/fms-tableau.spec.ts`: einzelne Kachel bei 1366 px nicht breiter als eine Spalte, 390 px ohne waagerechten Bildlauf; grün

## 6. Regeln, Erzeugtes, Integration

- [ ] 6.1 `frontend/AGENTS.md`: Bausteine (`Status`, `Marke`, Statusknopf), Bausteinwahl (Zeilen Status, Kennzeichnung, bedienbarer Status), Farbachsen (Rahmen heißt bedienbar, Sichtung als Ausnahme), FMS-Tableau-Absatz, Rückwege (Quittung Fahrzeugstatus); Kommentare in `StatusWahl.tsx`, `statusFlaeche.ts` nachziehen; Prettier grün
- [ ] 6.2 Design System: Karten in `frontend/scripts/design-system/previews.tsx` (Status, Marke, Statusknopf, Tableau-Kachel; alte Karte ersetzen), `mise exec -- pnpm -C frontend design-system`, `designSystem.guard.test.ts` grün, Erzeugtes mitcommitten
- [ ] 6.3 Anwenderdoku: `docs/anwender/kapitel/fahrzeuge.md` (Tableau, Quittung, Rückgängig), Alt-Texte; Bildlauf für alle Kapitel neu (`docs/anwender/AGENTS.md`), Wächter der Anwenderdoku grün
- [ ] 6.4 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die geänderten e2e-Specs einzeln grün

## Workflow follow-up

- Review nach Ermessen (Größe und neue Schnittstelle: nötig), bestätigte Befunde behandeln.
- `/opsx:archive eon26eat-status-und-bedienung` im selben Branch, Verweise nachziehen.
- PR gegen `alpha` mit Bildern (vorher/nachher, Nacht, Handschuh) und Abschnitt „Geprüft“.
- Nach dem Merge: Design System veröffentlichen; Folgeaufgabe „Rücknahme für Personal-, Material-
  und Einheitsstatus“ anlegen.
