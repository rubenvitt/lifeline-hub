# Tasks

## 1. Backend: Datenmodell, PATCH, Schwärzung

- [x] 1.1 Migration `0176_einsatz_fuehrungsstelle_ort.sql` (D1, D2): `art` NOT NULL DEFAULT `mobil` mit CHECK, `bezeichnung`, `standort_adresse`, `standort_lat`, `standort_lon`; `scripts/check-migrationen.sh` gegen `origin/alpha` grün, `db::tests::migrationsnummern_sind_eindeutig` grün
- [x] 1.2 `wire_enum! FuehrungsstellenArt` in `src/einsatz/fuehrungsstelle.rs`, Registrierung in `src/api_doc.rs`, Pin in `tests/enum_wire_kontrakt.rs`; `cargo test --test enum_wire_kontrakt` grün
- [x] 1.3 Lesen: `FuehrungsstelleAnzeige` trägt `art` (immer) und `bezeichnung`, `standort_adresse`, `standort_lat`, `standort_lon` (optional); ohne Zeile `mobil`. Test in `tests/einsatz_fuehrungsstelle.rs` „Neuer Einsatz“ zuerst rot, dann grün
- [x] 1.4 PATCH Art: Tri-State, `null`/`""`/unbekannt → 400 ohne Teilspeichern; „Nur die Art geändert“ lässt die Stelle nicht erfasst. Tests aus den Spec-Szenarien „Unbekannte Art“, „Art leeren“ zuerst rot, dann grün
- [x] 1.5 PATCH Bezeichnung und Adresse: Trimmen, leer → `null`, Grenzen `FUEHRUNGSSTELLE_BEZEICHNUNG_MAX = 200` / `FUEHRUNGSSTELLE_ADRESSE_MAX = 500` → 400, gespiegelt in `frontend/src/api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs`; Tests „Bezeichnung zu lang“, „Nur Bezeichnung“ grün, Spiegel-Test grün
- [x] 1.6 PATCH Koordinate gegen den Effektivzustand über `pruefe_koordinate` (D2): Tests „Adresse und Koordinate“, „Halbe Koordinate“, „Breite außerhalb“ (422, nichts teilweise gespeichert, kein Ereignis) zuerst rot, dann grün; Leer-Patch-Check um die neuen Felder erweitert (bestehender Test „Leer-Patch“ grün)
- [x] 1.7 Schwärzungsregister (D9): `art` retain `G_ENUM`, `bezeichnung` retain `G_OP_LABEL`, Standort scrub `NullSetzen`; Guard `jede_einsatz_scoped_spalte_ist_klassifiziert` erst rot, dann grün; Test „Standort wird mitgeschwärzt“ grün
- [x] 1.8 Codegen: `scripts/check-typ-codegen.sh` grün, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommittet; `FuehrungsstellePatch` in `frontend/src/api/types.ts` um die neuen Felder erweitert; `cargo test --test einsatz_fuehrungsstelle` komplett grün

## 2. Frontend: Paneel „Eigene Führungsstelle“

- [x] 2.1 Erfasst-Regel in `stab/fuehrungsstelle.ts` (D6): Bezeichnung, Adresse und Koordinate zählen, Art nicht; Vitest dazu zuerst rot, dann grün
- [x] 2.2 Zeilen Art (`Segmentleiste`, Vorgabe gekennzeichnet) und Bezeichnung (`InlineAngabe`, Grenze aus `eingabegrenzen.ts`) in `FuehrungsstellePaneel`, Reihenfolge nach D5; Vitest „Art wählen“ (Anfrage trägt nur `art`) und Bezeichnung in `EinsatzdatenPage.test.tsx` grün
- [x] 2.3 Zeile Standort (D4): Adresse + `KoordinatenEingabe`, Knopf „wie Einsatzort“ nur mit Einsatzort, einmalige Kopie (D3), Leseansicht mit `KoordinatenAnzeige`, Fehler an der Zeile; Vitest „Wie Einsatzort übernehmen“ (Anfrage trägt nur Adresse und Koordinate) und „ohne Einsatzort kein Knopf“ grün
- [x] 2.4 Zeile „Führungsfahrzeuge“ (D5): Etikett umbenannt, bei `ortsfest` eingeklappt mit Anzahl; bestehende Tests („zeigt … Angaben“, Fahrzeug-Tests ab Z. 1219) angepasst, neue Tests „Ortsfest ohne Fahrzeug“ / „Ortsfest mit Fahrzeug“ grün; `erklaertext.guard.test.ts` grün
- [ ] 2.5 e2e für das Paneel (neu, `frontend/e2e/einsatzdaten-fuehrungsstelle.spec.ts`): Art auf ortsfest, Bezeichnung, Standort per „wie Einsatzort“ speichern, nach Neuladen sichtbar; auch bei 390 px bedienbar; grün
- [ ] 2.6 Doku `docs/anwender/kapitel/einsatzdaten.md`: Ablauf „Die eigene Führungsstelle erfassen“ um Art, Bezeichnung, Standort, „wie Einsatzort“ und Führungsfahrzeuge; Bild `fuehrungsstelle.png` (+ `.dunkel.png`) über `frontend/e2e/doku-bilder/einsatzdaten.bilder.ts` neu erzeugt; `anwenderdoku.guard.test.ts` grün

## 3. Abnehmer im Stab: Funkplan, Fernmeldeskizze, Checkliste

- [x] 3.1 Funkplan (D6): `stelleZusatz = bezeichnung` in der Zeile `fs`; Vitest „Führungsstelle mit Bezeichnung“ / „ohne Bezeichnung“ in `funkplan.test.tsx` zuerst rot, dann grün; Markdown und Druck zeigen den Zusatz (Test)
- [ ] 3.2 Fernmeldeskizze (D6): `zusatz` an der `NetzStelle` der Führungsstelle, Zeile im Kasten zwischen Überschrift und Rufname, Höhe aus derselben Rechnung in `fernmeldeskizzeLayout.ts`; Tests in `fernmeldenetz.test.ts`/`fernmeldeskizzeLayout.test.ts`: „Kasten mit Bezeichnung“ und unveränderte Höhe ohne Bezeichnung grün; bestehende e2e `fernmeldeskizze.spec.ts` grün
- [ ] 3.3 Checkliste (D8): Wortlaut „Standort der Führungsstelle festgelegt“ in `stab/checkliste.ts`; Wertzeile mit Bezeichnung · Adresse, „Standort nicht erfasst“, Grund bei Abruffehler, Link zu Einsatzdaten in `ChecklistePaneel.tsx`; Vitest der drei Spec-Szenarien grün, Haken bleibt unverändert (Test); `stab.bilder.ts`-Wortlaut nachgezogen
- [ ] 3.4 Doku `docs/anwender/kapitel/funkplan.md` (Zusatz in der Zeile, Bezeichnung im Kasten „Einsatzleitung“) und `stab.md` (neuer Wortlaut, Wert am Punkt); Bilder der betroffenen Abläufe neu erzeugt; `anwenderdoku.guard.test.ts` grün

## 4. Organigramm

- [ ] 4.1 Wurzel „Einsatzleitung“ zeigt Bezeichnung und Rufnamen der erfassten Führungsstelle (D6), auch im Druck und in der Übernahme; „Leitung nicht erfasst“ bleibt; Kommentar D5 in `Organigramm.tsx` fortgeschrieben; Vitest „Wurzel mit Führungsstelle“ / „ohne Bezeichnung“ / Abruf gescheitert in `Organigramm.test.tsx` grün; e2e `fuehrungsorganisation.spec.ts` grün
- [ ] 4.2 Doku `docs/anwender/kapitel/einsatzabschnitte.md`: Wurzel nennt die Führungsstelle; Guard grün

## 5. Lagekarte

- [ ] 5.1 Marker (D7): `fuehrungsstelleTz()` (Grundzeichen `befehlsstelle`) in `taktischesZeichen.ts`, Marker-Typ `fuehrungsstelle` in `marker.ts`, feste Quelle mit Einsatzort, Daten aus `einsatzKeys.fuehrungsstelle` in `useLagekarteDaten`; Vitest „Führungsstelle mit Koordinate“ / „Ohne Koordinate“ in `marker.test.ts` zuerst rot, dann grün
- [ ] 5.2 Ebene, Klickziel, Inspector, Objektsuche, Deeplink (D7): `EBENEN`, `ordneKlickebene` (Guard `klickziel.test.ts` grün), Inspector mit Link „In Einsatzdaten bearbeiten“ ohne Ziehen/Platzieren, `objektsuche.ts`, `markerToUrl.ts`, `clusterDonut.ts`; zugehörige Vitests grün
- [ ] 5.3 e2e `frontend/e2e/lagekarte-fuehrungsstelle.spec.ts`: Führungsstelle per API mit Koordinate anlegen, `window.__lfhKarte.querySourceFeatures('marker-einsatzort')` enthält den Marker mit Beschriftung; ohne Koordinate fehlt er; grün
- [ ] 5.4 Doku `docs/anwender/kapitel/lagekarte.md`: Ebene „Führungsstelle“ in der Aufzählung; Guard grün

## 6. Nachweis

- [ ] 6.1 Gates: `scripts/check-all.sh` (inkl. fmt, Lint, tsc, Vitest, cargo test, Codegen, Migrationen, OpenSpec-Archiv) grün; e2e der berührten Specs (`einsatzdaten-*`, `funkplan`, `fernmeldeskizze*`, `fuehrungsorganisation`, `lagekarte-*`, `kommunikationsplan`) grün

## Workflow follow-up

- Freigabe des Entwurfs abwarten, dann `/opsx:apply`.
- `/opsx:archive lfh-1181-fuehrungsstelle-ort` im selben Branch vor dem PR (Spec-Sync nach `einsatz-fuehrungsstelle`, `stab-funkplan`, `stab-fernmeldeskizze`, `stab-checkliste`, `fuehrungsorganisation`, `lagekarte-taktische-zeichen`); Verweis in `frontend/src/stab/AGENTS.md`/Code-Kommentaren auf die LFH-849-Herleitung prüfen.
- PR gegen `alpha` mit Plan, Umsetzung und Archiv zusammen.
