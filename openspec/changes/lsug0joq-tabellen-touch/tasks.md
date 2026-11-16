# Tasks

Jede Aufgabe mit Verhaltensänderung entsteht per TDD: zuerst der Test, der ohne die Änderung rot
ist. Pfade im Frontend relativ zu `frontend/src/`. Voraussetzung: LLH-1788 (Kopf und Körper der
klebenden Kopfzeile gleich breit) ist im Branch behoben.

## 1. i7lwykpt: Zähler erst nach eigener Wahl

- [x] 1.1 `components/SpaltenSchalter.tsx`: `sichtbareSpalten` nimmt `voreinstellungAus` und liefert `weichtAb` (D3); Name „Spalten“ ohne Abweichung, sonst „Spalten · n ausgeblendet“. Unit-Tests „Vorgabe mit Breite und Voreinstellung heißt Spalten“, „eigene Wahl zählt alle“, „zurück zur Vorgabe“ rot→grün
- [x] 1.2 Durchreichen: `Datensicht` (`spaltenAusVoreinstellung`), `useSpaltenSchalterZustand` (Meldebild), `KatalogTabelle` (leere Menge); bestehende Tests in `components/Datensicht.test.tsx`, `components/KatalogTabelle.spaltenschalter.test.tsx`, `pages/FahrzeugePage.test.tsx`, `pages/PersonalPage.test.tsx` auf die neue Regel umstellen und grün
- [x] 1.3 e2e nachziehen: `e2e/gate1-ueberlauf.spec.ts` (Personal „Spalten · 4/5 ausgeblendet“ → „Spalten“), `e2e/kartenverwaltung-spaltenschalter.spec.ts` (Szenario unter `lg`), `e2e/datensicht-schmal.spec.ts`; Specs einzeln grün

## 2. i7lwykpt: Typ unter dem Funkrufnamen

- [x] 2.1 Baustein `components/KennungMitZusatz.tsx` (Kennung, gedämpfter Zusatz, kein leerer Zusatz); Unit-Test rot→grün
- [x] 2.2 `pages/FahrzeugePage.tsx`: Funkrufname-Zelle und Kartentitel zeigen unter `xxl` den Typ, ab `xxl` nicht; Karte auch mit Freigabe Einheiten; Spalte `typ` bleibt ab `xxl`. Tests „KTW unter dem Funkrufnamen bei 1440“, „nicht doppelt ab xxl“, „Karte mit Freigabe Einheiten“, „Suche nach Typ“ rot→grün

## 3. cq38dy2l: Aktionsspalte immer im Bild

- [x] 3.1 Spaltenbauer `components/aktionsSpalte.tsx` (D1): Schlüssel `aktionen`, `immerSichtbar`, Marke `amEnde`, feste Breite aus `menueSpaltenBreite` plus gemessener Knopfbreite der Primäraktion (rein, zwischengespeichert); Unit-Tests der Breite je Stufe rot→grün
- [x] 3.2 `Datensicht` (statt `KatalogTabelle`, dort liegt die Spaltenübersetzung): Spalte mit `amEnde` ab `md` als `fixed: 'right'`; Unit-Test (Klasse `ant-table-cell-fix-end` an der Aktionsspalte) rot→grün
- [x] 3.3 `Datensicht`/`KatalogTabelle` unter `md` bei `form="tabelle"`: Aktionsspalte entfällt, Kennungsspalte rendert `KennungMitAktion` (Primäraktion und ⋮); Unit-Test rot→grün
- [x] 3.4 `betreuung/BezirkTabelle.tsx` und `betreuung/StellenBlock.tsx` auf den Baustein umstellen, `meldenInKennung`/`KENNUNG_MAX_PX` entfernen; ihre Tests bleiben grün, ⋮ am Handy neu in der Kennung (Test rot→grün)
- [x] 3.5 `pages/MaterialPage.tsx`, `personen/personenSpalten.tsx`, `pages/FahrzeugePage.tsx`: ihre reinen ⋮-Spalten tragen `amEnde` (eigenes `render` bleibt, Breite schon `menueSpaltenBreite`); Seitentests grün
- [x] 3.6 e2e: Lage von Primäraktion und ⋮ im Tabellenrahmen ohne Rollen (Evakuierung 1440 × 900 mit Panel, Material 1024 × 768, Betreuung 1024 × 768 `handschuh`, Evakuierung 390 × 844), alle drei Stufen, in `e2e/gate1-ueberlauf.spec.ts`; Fokus-Nachweis „Durch eine Zeile neben der fixierten Aktionsspalte“ in `e2e/fokus-verdeckung.spec.ts`; beide grün

## 4. j10okn8m: Bearbeiten in der Zelle ohne Sprung

- [ ] 4.1 Kontext `angabeForm` (`'fluss' | 'schwebend'`, Vorgabe `'fluss'`) in `components/`; `KatalogTabelle` setzt `'schwebend'` um den Körper und `'fluss'` um aufgeklappte Zeilen; Unit-Test rot→grün
- [ ] 4.2 `InlineAngabe` schwebend (D2): Anzeige bleibt in der Zelle, Bearbeitung im kontrollierten Popover; Fokus, Escape-Reihenfolge, Fokusrückgabe, Prüfung, Ablehnung, `OFFEN_LASSEN` unverändert. Unit-Tests je Punkt im schwebenden Zweig rot→grün, der Fluss-Zweig bleibt unverändert grün
- [ ] 4.3 Eine schwebende Bearbeitung je Tabelle (zweite schließt eine unveränderte erste, eine geänderte behält den Fokus); Klick außerhalb schließt nicht; Unit-Tests rot→grün
- [ ] 4.4 Testhelfer `test/` für die offene Bearbeitung über ihren zugänglichen Namen; bestehende Tests der Tabellen mit Inline-Angaben (Fahrzeuge, Personal, Material, Betroffene) gesammelt umstellen, alle grün
- [ ] 4.5 e2e „Bearbeiten ohne Sprung“: Spaltenbreiten und Zeilenhöhe der Fahrzeugliste vor und nach dem Stift der Einheit (1440 × 900 `kompakt`, 1024 × 768 `handschuh`), Abweichung ≤ 1 px; Escape-Reihenfolge; Karte bei 390 px bearbeitet im Fluss. Grün
- [ ] 4.6 `e2e/inline-angabe-dichte.spec.ts`, `e2e/kraefte-einsatzfunktion.spec.ts` und weitere e2e mit Inline-Angaben in Tabellen nachziehen; einzeln grün

## 5. i5c54naq: Einheiten am Handy als Karten

- [ ] 5.1 `pages/EinheitenPage.tsx`: `form="auto"`, Kartenplan (Titel `KraeftebaumZelle`, Status Urteil, Sekundär Ist/Soll/Einheitsführer), Name mit Silbentrennung statt `overflowWrap: 'anywhere'`; Dateikopf berichtigen. Tests „unter md Karten mit Baum“, „Untereinheit eingerückt und aufgeklappt“, „ab md Tabelle“ rot→grün
- [ ] 5.2 Baum-Kartenzweig der `Datensicht` (`baumEintrag`) in `komfortabel`/`handschuh` bei 390 px: Einzug und Knopf „n Untereinträge“ als Ziel der Stufe; Abweichungen beheben, Unit-Test rot→grün
- [ ] 5.3 `components/datensicht.guard.test.ts`: `EinheitenPage.tsx` aus `NUR_TABELLE`, Kommentar an der Trennlinie der Formen in `Datensicht`; Wächter grün
- [ ] 5.4 e2e: `e2e/fokus-verdeckung.spec.ts` (Einheitenliste nur ab `md`), neue Messung 390 × 844 `komfortabel` (Karten, kein Wortbruch, kein Querlauf) in `e2e/kraefte-schmal.spec.ts`, `e2e/gate3-trefflaeche.spec.ts` (Baumknopf der Karte); grün

## 6. Regeln, Doku, Abschluss

- [ ] 6.1 `frontend/AGENTS.md`: „Tabelle und Dichte“ (Aktionsspalte nach Breite, Zähler erst nach eigener Wahl, Einheitenliste als Beispiel für `auto`) und „Inline-Bearbeitung und Status“ (schwebend in Tabellenzellen); Prettier über `frontend/` grün
- [ ] 6.2 `scripts/adr-fuer.sh` für die geänderten Pfade prüfen, betroffene ADRs und die Mitänderungsregel in `docs/architektur/AGENTS.md` beachten; Ergebnis im Commit nennen
- [ ] 6.3 Anwenderdoku nach `docs/anwender/AGENTS.md`: Kapitel Fahrzeuge (Typ, Bearbeiten, Spalten), Einheiten (Handy), Evakuierung, Betreuung, Material samt Bilder-Specs; Bilder neu erzeugen, Wächter grün
- [ ] 6.4 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die geänderten e2e-Specs einzeln grün

## Workflow follow-up

- `/opsx:archive lsug0joq-tabellen-touch` im selben Branch vor dem PR (Spec-Sync, Verweise).
