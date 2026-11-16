# Tasks

Jede Aufgabe mit Verhaltensänderung entsteht per TDD: zuerst der Test, der ohne die Änderung rot
ist. Pfade im Frontend relativ zu `frontend/src/`. Entscheidungen D1–D9 in `design.md`.

## 1. la80rtj2 (LLH-1783): Vier Flächenstufen, gewähltes Segment mit Bedienkante

- [x] 1.1 Wächter in `theme/tokens.test.ts`: höchstens vier verschiedene Flächenwerte je Modus über `grund`, `paneel`, `kopf`, `flaeche`, `flaeche2`, `flaeche3`, und je Schritt mindestens 1,10 : 1 (D5); rot gegen die heutigen Werte, mit Gegenprobe (ein fünfter Wert macht ihn rot)
- [x] 1.2 `theme/tokens.ts` und `theme/rollen.css`: vier Werte je Modus nach D5 (`paneel` = `grund`, `kopf` = `flaeche2`), Kommentare an den Rollen nachziehen; `rollen.guard.test.ts` und 1.1 grün
- [x] 1.3 Alle Kontrasttests in `theme/` grün: `textstufen`, `rahmenKontrast`, `bedienKontrast`, `gesperrtKontrast`, `fehlertextKontrast`, `hinweisKontrast`, `auswahlKontrast` und die übrigen `*Kontrast.test.ts`. Verliert eine Textstufe den Boden, wird sie nachgezogen, nicht die Fläche (D5, Risiko); Abweichungen im Commit nennen
- [x] 1.4 `theme/sprache.css`: `.lfh-segment--aktiv` mit `inset 0 -2px 0 var(--lfh-bedien)`; Segment mit `kante` behält nur die Typkante (D6). Test in `components/instrument/Segmentleiste.test.tsx` (gewählt trägt Bedienkante, ETB-Segment nur Typkante) rot→grün, Kontrastnachweis Kante gegen `flaeche3` ≥ 3 : 1 in `theme/bedienKontrast.test.ts`
- [ ] 1.5 Kommentar in `components/instrument/Segmentleiste.tsx` (Fugenraster, aktiv) und `pages/lagekarte/KartenUeberlagerung.tsx` prüfen; `e2e/auswahl-kontrast.spec.ts` um das gewählte Segment (Nacht, Kante sichtbar) ergänzen und grün

## 2. qim1zbwk (LLH-1778): Gelb entlasten

- [x] 2.1 `theme/statusFarben.ts`: `statusKategorie.gebunden` → `neutral` (D1); Test in `theme/statusFarben.test.ts` („gebunden … zu EINER Rolle“) auf `neutral` umschreiben, rot→grün
- [x] 2.2 `fahrzeugStatusRolle(kategorie, fmsAnker)` mit `FMS_SPRECHWUNSCH` (5, 0) in `theme/statusFarben.ts` (D2); Tests: Anker 5 und 0 → `achtung`, Anker 3/4 → `neutral`, ohne Anker → Kategorie
- [x] 2.3 Abnehmer auf `fahrzeugStatusRolle` umstellen: `kraefte/mittelStatus.ts` (`fahrzeugStatusDarstellung`), `kraefte/fmsTableauKern.ts` (`fmsStatusOptionen`), `kraefte/meldebildRaster.ts` (`tonAusKategorie` mit Anker, Dateikopf „STATUSTON NUR AUS DER KATEGORIE“ berichtigen), `pages/lagekarte/leistenDaten.ts`; Aufrufer ohne Anker (`FahrzeugVorschau.tsx` u. a.) prüfen und den Anker aus dem Katalog reichen. Tests je Stelle (S5 gelb, S4 neutral) rot→grün; `meldebildRaster.test.ts` (Abschnitt Anker) umschreiben
- [x] 2.4 `pages/KraefteuebersichtPage.tsx` (Verteilung) und `pages/fuehrung/UeberblickPage.tsx` (Abschnittskarte): Rolle von „gebunden“ aus `statusKategorie`, nicht hart (D1); Tests in `pages/fuehrung/UeberblickPage.test.tsx` und für die Verteilung rot→grün
- [x] 2.5 `kommunikation/kartenKante.ts`: `phaseTon(…, unbearbeitet)` → `neutral`, Eingangskante `linieStark` (D4); `kartenKante.test.ts`, `badges.test.tsx`, `meldungen/MeldungKarte.test.tsx`, `auftraege/AuftragListe.test.tsx` und `KommKarte`-Tests nachziehen; Test „dringende neue Meldung zeigt die Priorität gelb“ grün
- [ ] 2.6 D3-Liste in `theme/statusFarben.ts` umstellen (`schadenStatus.offen`, `belegungsArt.austritt`, `etbTyp.anordnung`, `raeumungszustand.laeuft`, `brAbgerufen`) samt Dateikommentaren; Tests der betroffenen Seiten nachziehen. Prüfen, dass keine Zählung (`materialVerdichtungKern`, Warnsperre, `aktiveWarnung`) an einer dieser Rollen hängt
- [ ] 2.7 Übrige Tests mit „gebunden → achtung“ nachziehen (`kraefte/Verdichtungszeile.test.tsx`, `components/StatusWahl.test.tsx`, `pages/lagekarte/leistenDaten.test.ts` u. a., per `grep`); `e2e/kraefte-kontrast.spec.ts` (gebunden) auf `neutral` umstellen und grün
- [ ] 2.8 `frontend/AGENTS.md`, „Farbe und Zeichen“: Bedeutung der Rollen (Gelb = bald handeln, Rot = abnorm, Normalbetrieb nie Gelb), Sprechwunsch-Ausnahme, Verweis auf Spec `statusrollen`; `docs/design/2026-09-21-neuentwurf/umsetzung.md` Palette „gebunden“ mit Nachtrag auf diese Change; Prettier grün

## 3. wnha7f8n (LLH-1784): Ortsmarke in der Bedienfarbe

- [x] 3.1 `theme/tokens.ts` und `theme/rollen.css`: `rahmenFarben.bedien` / `--lfh-rahmen-bedien` (D7); `rollen.guard.test.ts`, Schlüsselliste in `theme/rahmenKontrast.test.ts` und Nachweis „Marke ≥ 3 : 1 gegen `aktiv` und `grund`“ rot→grün
- [x] 3.2 `einsatz/IconRail.tsx` (`railZielStil`), `einsatz/ModulAkkordeon.tsx`, `geraet/GeraeteLayout.tsx` auf die Bedienrolle; Tests `IconRail.test.tsx` („markiert die aktive Kategorie“) und `ModulAkkordeon.test.tsx` umschreiben, rot→grün; Kommentar „DIE AKTIVE MARKE IST ROT“ berichtigen
- [ ] 3.3 `docs/design/2026-09-21-neuentwurf/umsetzung.md` Entscheidung 2 und Palette `marke` mit Nachtrag; `frontend/AGENTS.md` Gestaltungssprache (Rahmen): Ortsmarke in `bedien`; Prettier grün

## 4. q7tef1db (LLH-1785): Sichtungswahl

- [x] 4.1 `theme/tokens.ts`: je Kategorie ein Objekt `{ punkt, flaeche, schrift }`, `sichtungsfarben` und `sichtungsflaechen` daraus abgeleitet, Werte unverändert (D8); `theme/sichtungKontrast.test.ts` grün
- [x] 4.2 Kontrastnachweis in `theme/sichtungKontrast.test.ts`: Text auf getönter Kachel (Tag ≥ 7, Nacht ≥ 5), Text auf der Schraffur von „tot“ (gefüllt und getönt), Tönung unterscheidet sich vom Grund; die Kante in `text` hält weiter ≥ 3 : 1
- [x] 4.3 `personen/SichtungsWahl.tsx`: nicht gewählte Kacheln nach einer Wahl mit Innenrahmen + Tönung statt `borderInlineStart` 8 px; „tot“ mit Schraffur in jedem Zustand; „unverletzt“ transparent mit Rahmen. Tests in `personen/SichtungsWahl.test.tsx` (Spec `sichtungswahl`: „SK II gewählt“, „Fehlwahl korrigieren“, „unverletzt ohne Farbe“, „tot und unverletzt unterscheidbar“) rot→grün
- [x] 4.4 Startfokus auf der Gruppe (D8): `radiogroup` mit `tabIndex={-1}`, `data-erfassung-fokus`, Fokusring in `theme/sprache.css`, Pfeiltaste von der Gruppe zur gewählten bzw. ersten Kachel; `components/Erfassung.tsx` fokussiert die Gruppe beim Öffnen und nach dem Serien-Speichern. Tests in `SichtungsWahl.test.tsx` und `personen/PersonErfassungModal.test.tsx` rot→grün
- [ ] 4.5 e2e: `e2e/personen-aufnahme.spec.ts` (Fokus auf der Gruppe) und `e2e/betroffene-kontrast.spec.ts` (Randform → Innenrahmen, Nacht „tot“ gegen „unverletzt“) nachziehen und grün
- [ ] 4.6 `frontend/AGENTS.md` Sichtungsabsatz (keine Randform, Schraffur, Startfokus), `docs/anwender/kapitel/betroffene.md` (Streifen → Innenrahmen), Karte „Sichtung“ in `frontend/scripts/design-system/previews.tsx` prüfen; Bilder des Kapitels Betroffene neu erzeugen

## 5. Erzeugtes und Integration

- [ ] 5.1 Design System neu erzeugen (`mise exec -- pnpm -C frontend design-system`), `designSystem.guard.test.ts` grün, Erzeugtes mitcommitten
- [ ] 5.2 Anwenderbilder der Kapitel Kräfte, Arbeitsfläche und Kommunikation über den Bildlauf neu erzeugen (`docs/anwender/AGENTS.md`); Wächter der Anwenderdoku grün
- [ ] 5.3 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die geänderten e2e-Specs einzeln grün

## Workflow follow-up

- Review vor dem PR (Phase 4 von `dev-zunder-orchestrieren`), bestätigte Befunde behandeln.
- `/opsx:archive eon26eat-farbe-entlasten` im selben Branch, Verweise auf den Change-Pfad nachziehen.
- PR gegen `alpha` mit Bildern (vorher/nachher, Nacht) und Abschnitt „Review“.
- Nach dem Merge: Design System veröffentlichen (`frontend/AGENTS.md`), Welle 2 starten.
