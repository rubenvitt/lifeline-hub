# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- Rust: `cargo test --test <datei>` bzw. `cargo test <modul>::tests`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`. Die Gliederung
folgt den Schnitten des Tickets; jeder Schnitt ist für sich lauffähig und grün.

## 1. Messen vor dem Bau (D4, D13)

- [x] 1.1 Messspec `e2e/fernmeldeskizze-flaeche.spec.ts` (vorläufig, geht in 9.1 auf): bei
  1366 × 768 mit offenem Modulpanel, 1024, 768 und 390 px die verfügbare Flächengröße unter
  `stab/funkplan?ansicht=skizze` messen; dazu die Laufweite des längsten Bedingungszeichens
  („TMO BN_BOS_LANGNAME_40“) und eines Rufnamens von 30 Zeichen.
  - Nachweis: Messwerte und daraus Rastermaß, Spaltenbreite des Auto-Layouts, Zoomgrenzen und
    Mobil-Schwelle als Nachtrag in `design.md` D4.
  - Erledigt: aufgegangen in `e2e/fernmeldeskizze.spec.ts` („Messung 1.1: 8 × 3 eingepasst …“,
    prüft zugleich, dass kein Text aus seinem Platz ragt); Werte und Folgen im Nachtrag D4 von
    `design.md`. Maße bleiben (Raster 8, Kasten 176, Einheit 144, Zoom 1,25/0,25/4, mobil unter
    768 px); geändert: ein Rufname von 30 Zeichen bricht um und lässt den Platz wachsen
    (`umbrich`, `rufnamenHoehe`, drei Unit-Tests zuerst rot).

## 2. Schnitt 1 — Netzmodell und Darstellung, abgeleitet (D2, D11, D12)

- [x] 2.1 `stab/luecken.ts`: `schienenMitEinemTeilnehmer` und erweiterte
  `leitstelleOhneVerbindung` (Kommunikationsplan-Verbindung, Kanal, Skizzen-Verbindung) als reine
  Filter mit Zustand.
  - Nachweis: Tests zuerst rot; je Regel „fehlende Quelle → Zustand statt Zahl“; Kommunikationsplan
    nutzt dieselbe Funktion (bestehende Tests grün).
  - Erledigt: 15 Tests zuerst rot, dann grün; eine Kanalbelegung `kanalbelegung` für Lücke und
    Schienen. `leitstelleOhneVerbindung(stellen, skizzenVerbindungen?)`: ohne zweites Argument
    gilt bis 2.6/7.4 die alte Regel plus Kanal (Kommunikationsplan-Seite unverändert grün).
- [x] 2.2 `stab/fernmeldeskizze.ts`: `baueFernmeldenetz` mit Stellen (`fs`, `ab-`, `eh-`, `ks-`,
  `ko-`), Schienen (`sg-`, Menge wie `baueSprechgruppenplan` plus Kanäle externer Stellen und
  Komponenten), Verbindungen, Bereichen und Lücken je Element; verwaiste Bezüge werden
  ausgelassen.
  - Nachweis: Spec-Szenarien „Vier Stellen auf einem Kanal“, „Übergang“, „Wurzel“, „Wurzel mit
    erfasster Führungsstelle“, „Funktion S2“ als Tests; Lückenzahl je Element gleich Paneel
    (Eigenschaftstest über Zufallsgliederungen).
  - Erledigt: `stab/fernmeldenetz.test.ts` mit den Szenarien und 200 Zufallsgliederungen
    (Saat fest); Typen bis zum Codegen aus `api/fernmeldeskizzeVertrag.ts`. Die alte
    `baueFernmeldeskizze` bleibt, bis 2.5 die Darstellung umstellt.
- [x] 2.3 `stab/skizzenZeichen.tsx`: Bedingungszeichen, Linienarten je Medium, Strichmuster je
  Status mit Wort, Zeichen je Verbindungsart und Komponente, Strich-Punkt-Grenze.
  - Nachweis: Render-Tests je Baustein (Wort „geplant“ vorhanden, kein Farb-only-Merkmal);
    Folgeticket an `@einsatzzeichen` über `clickup-task-anlegen` angelegt.
  - Erledigt: 39 Tests grün, sechs Mutationsproben je rot (Strichmuster, Wort „geplant“,
    Zickzack, Farbliteral, Hervorhebung, feste Breite); Folgeticket LFH-1033.
- [x] 2.4 `stab/fernmeldeskizzeLayout.ts`: Auto-Layout nach D4 (rein, Rasterpunkte).
  - Nachweis: Szenario „Erstes Öffnen“ als Test; keine Überlappung von Kästen bei 8 × 3; jedes
    Element platziert.
  - Erledigt: 11 Tests, zwei Mutationsproben je rot (Spuren zusammengelegt, Steigleitung im
    Kasten). 8 × 3 ergibt 2016 × 984 Einheiten; Maße vorläufig bis 1.1.
- [x] 2.5 `stab/FernmeldeskizzeBild.tsx` als SVG-Fläche (schreibgeschützt): Kästen, Zeichen,
  Schienen, Stichleitungen, Lücken am Element, Einpassen, Zoom über Knöpfe/Strg+Rad/zwei Finger,
  Hervorheben und Ebenenfilter. `HaengenderBaum` bleibt dem Organigramm.
  - Nachweis: Komponententests für Hervorheben (Form/Strich, nicht nur Farbe), Filter „nur Lücken“,
    fehlende Quellen („Externe Stellen: nicht geladen“); Klick im Lücken-Paneel wählt das Element.
  - Erledigt: `stab/FernmeldeskizzeBild.tsx` verbindet die reinen Module in `stab/skizze/`
    (`ansicht.ts` Zoom/Einpassen/zwei Finger, `ebenen.ts` Filter und Hervorheben, `geometrie.ts`,
    `bedienung.ts`, `wirkung.ts`, `schriftfeld.ts`, zusammen 75 Tests) mit `SkizzenFlaeche.tsx`
    und `SkizzenElemente.tsx`. Komponententests in `FernmeldeskizzeBild.test.tsx` (34): „Wer hört
    mit?“ (Strichstärke, Rest mit Deckkraft 0,6 — Kontrastboden 4,5 : 1 gerechnet in
    `zurueckKontrast.test.ts`), „Nur Lücken“, „Zoomen ohne Ziehen“, Wahl von außen, Lücke als
    Wort, ohne Abschnitte nur der Grund. Mutationsproben je rot: Deckkraft weg, Lückenfilter
    weg, Ausschnitt bei Wahl weg. `baueFernmeldeskizze` bleibt (nur noch ihr eigener Test).
- [x] 2.6 `pages/FunkplanPage.tsx`: Quellen Kommunikationsplan und Skizzendaten mit eigener
  Weiche; Lücken-Paneel um die zwei neuen Zeilen in allen drei Darstellungen; Sprechgruppen-
  Darstellung mit externen Stellen und Komponenten als Teilnehmer.
  - Nachweis: bestehende Funkplan-Tests grün; neue Szenarien aus `stab-funkplan` als Tests.
  - Erledigt: `FunkplanPage.test.tsx` 69 grün (13 neu in „Fernmeldenetz (LFH-893)“, Skizzen-Tests
    auf einen Stub der Fläche umgestellt, Klapp-Tests entfallen); sechs Mutationsproben je rot
    (Wahl aus, Übernahme ohne Netz, Anlage aus, Grund der Leitstelle, Teilnehmerquellen weg,
    Aktionen ohne Schreibrecht). Netz EINMAL (`baueFernmeldenetz`) für Fläche, Paneel und
    Übernahme (`{ netz, gueltigAb }`); Skizzendaten ohne Netz „nicht geladen“; Lücken-Klick in der
    Skizze wählt `ab-`/`eh-`/`sg-`/`ks-`. `baueSprechgruppenplan(q, id, { stellen, skizze })` nennt
    externe Stellen (Status, Ziel Kommunikationsplan) und Komponenten (ohne Ziel), 3 Tests.
    Typecheck der Seite hängt an der neuen Signatur von `FernmeldeskizzeBild` (2.5).

## 3. Backend — Datenmodell, Lesen, Schwärzung (D3)

- [x] 3.1 Migration `NNNN_fernmeldeskizze.sql` mit `einsatz_kommunikation_stelle_sprechgruppe` und
  den Skizzen-Tabellen nach D3. Nummer per `git fetch origin alpha && scripts/check-migrationen.sh`.
  - Nachweis: `db::tests::migrationsnummern_sind_eindeutig` und `check-migrationen.sh` grün.
  - Erledigt: `migrations/0147_fernmeldeskizze.sql` (sieben Tabellen nach D3, dazu
    `geaendert_at` an allen für den abgeleiteten Stand). `migrationsnummern_sind_eindeutig` grün;
    `check-migrationen.sh` meldet „alle über 0146 (origin/alpha)“ — die Datei ist noch nicht
    committet und wird erst im Commit vom Skript gesehen, 0147 = 0146 + 1.
- [x] 3.2 `wire_enum!` für Komponentenart, Verbindungsart, Medium, Status, Verkehr, VS-Vermerk in
  `src/stab/fernmeldeskizze.rs`, registriert in `src/api_doc.rs` und `tests/enum_wire_kontrakt.rs`.
  - Nachweis: Wire-Kontrakt zuerst rot, dann grün.
  - Erledigt: `stab_fernmeldeskizze_wire` zuerst rot (Modul fehlte), dann grün; dazu
    `SkizzenBezugArt`. Inventar-Guard `jedes_toschema_enum_ist_gepinnt` grün.
- [x] 3.3 `GET /api/einsaetze/{id}/stab/fernmeldeskizze` (`EinsatzLesezugriff<Stab>`): Lage,
  Komponenten samt Kanälen, Verbindungen, Bereiche, Schriftfeld (mit Vorgaben), abgeleiteter Stand.
  Kommunikationsplan-Antwort um die Kanäle externer Stellen erweitert.
  - Nachweis: Integrationstest Lesen; 403 bei gesperrtem Stab; Typ-Codegen
    (`scripts/check-typ-codegen.sh`) mit beiden generierten Dateien.
  - Erledigt: `tests/stab_fernmeldeskizze.rs` (`neue_skizze_ist_leer_mit_vorgaben_im_schriftfeld`,
    `ohne_stab_recht_ist_lesen_und_schreiben_403`); `KommunikationsStelle.sprechgruppen:
    StellenKanal[]`. `openapi.json` und `types.generated.ts` neu erzeugt, Aliase in `api/types.ts`.
    Offen für den Client: vier Frontend-Fixtures ohne `sprechgruppen` brechen `tsc` (s. Bericht).
- [x] 3.4 Schwärzungsregister: `gez_name`, alle `bezeichnung`/`hinweis` der neuen Tabellen.
  - Nachweis: Registry-Guard zuerst rot; Test schwärzt einen Einsatz und prüft Arten, Status und
    Lage erhalten, Namen und Hinweise weg.
  - Erledigt: sieben Regeln in `einsatz/schwaerzung_registry.rs` (Guard grün);
    `schwaerzung_nimmt_namen_und_hinweise_und_behaelt_das_skelett`. `herausgeber` bleibt (Stelle,
    kein Name).
- [x] 3.5 Aufräumen polymorpher Bezüge (`stab::fernmeldeskizze::vergiss`) in den Löschpfaden von
  Abschnitt, Einheit, Kommunikationsstelle und Komponente, im selben Transaktionsschritt.
  - Nachweis: Szenario „Einheit gelöscht“ als Integrationstest; Guard-Test über die Löschpfade.
  - Erledigt: `vergiss` in `einsatzabschnitt::repo::loese_auf_tx`, `einheit::repo::loese_auf_tx`,
    `kommunikation::stelle_entfernen`, `fernmeldeskizze::komponente_entfernen`; Tests
    `einheit_geloescht`, `abschnitt_stelle_und_komponente_geloescht`; Guard
    `jeder_loeschpfad_vergisst_die_skizzenbezuege` (Mutationsprobe: Aufruf entfernt → rot).

## 4. Schnitt 2 — Schriftfeld und Druck (D13)

- [x] 4.1 `PUT …/stab/fernmeldeskizze/schriftfeld` (`EinsatzSchreibzugriff<Stab>`, Teilfelder,
  Zeiten über die Zeitkonvention), Live über das Stab-Ereignis.
  - Nachweis: Integrationstest inkl. 403 ohne Stab-Schreibrecht; kein ETB.
  - Erledigt: `schriftfeld_tri_state_und_zeiten`, 403 in `beobachter_liest_aber_schreibt_nicht`,
    kein ETB in `jede_skizzenaenderung_sendet_stab_und_nie_etb`.
- [x] 4.2 Schriftfeld im Bild und im Paneel (Inline nach `InlineAngabe`/`ZeitpunktEingabe`).
  - Nachweis: Szenario „Schriftfeld ohne Angaben“ und „Gültig ab setzen“ als Tests.
  - Erledigt: Schriftfeld unten rechts im SVG (`flaechenAusdehnung`), Paneel mit Herausgeber,
    VS-Vermerk, Gültig ab, gez. Name/DTG, Stand (`Eigenschaftspaneel.tsx`). Tests „Schriftfeld
    ohne Angaben“, „Gültig ab setzen“ (Bildschirm und Druck), Herausgeber schreibt nur sein Feld.
- [x] 4.3 Druck quer A3/A4 mit Schriftfeld, ganze Skizze auf Seite 1, Funkplan-Tabelle als Anlage
  ab neuer Seite, Filter und Hervorhebung aus.
  - Seitenteil erledigt: im Druck der Skizze hängt `FunkplanPage` die ganz offene Funkplan-Tabelle
    (mit Erreichbarkeit) als `data-lfh="druck-anlage"` hinter die Fläche; `druck/druck.css` setzt
    `break-before: page` (Test in `druck/druck.test.ts`, Seiten-Test „hängt im Druck der Skizze …“).
    Das Blatt (Druckkopf, Lücken, Fläche) trägt `skizzenDruckKlasse(druckFormat)`, die Anlage
    steht außerhalb davon; Papierformat und Befehlsstapel hält die Seite. Offen: e2e-Druck-Emulation.
  - Nachweis: e2e Druck-Emulation (Seitengröße, Seitenumbruch vor der Anlage, kein Überhang);
    Graustufen-Szenario per Screenshot-Vergleich im Graustufenfilter.
  - Flächenteil erledigt: im Druck (`druckt`/`useDruckModus`) keine Bedienung, Wahl, Hervorhebung
    oder Filter; `viewBox` = ganze Ausdehnung samt Schriftfeld. Segmentleiste „Papierformat“
    (A3 quer Vorgabe) über `druckFormat`/`onDruckFormat`; `stab/skizze/skizzeDruck.css` macht aus
    `skizzenDruckKlasse` die benannte Seite (`@page fernmeldeskizze-a3|-a4 { size: … landscape }`),
    Test `skizzeDruck.test.ts`. Offen bleibt nur der e2e-Nachweis (9.1).
  - Erledigt: `e2e/fernmeldeskizze-druck.spec.ts` (in `DRUCK_SPECS`) — je A3/A4 Seite 1 im
    Format quer mit ganzer Skizze, ohne Filter, Bedienung und Hervorhebung, nichts ragt aus Fläche
    oder Blatt, Anlage `break-before: page` und im PDF ab eigener Seite; Graustufen-Screenshot:
    „geplant“ 17 Hell-Dunkel-Wechsel, bestehend 0, Wort „geplant“ ≥ 4,5 : 1 (Mutationsprobe
    Strichmuster weg → rot). Zwei Fehler behoben: leere Hochformatseite vor dem Blatt
    (`seiten-beschreibung` im Druck aus) und Skizze auf Seite 2 (Lücken nach der Fläche, Höhe
    205/120 mm); Tests in `funkplanPrint.test.ts`, `skizzeDruck.test.ts`, `EinsatzSeite.test.tsx`.

## 5. Schnitt 3 — Zeichenfläche mit Layout (D1, D4)

- [x] 5.1 `PUT/DELETE …/stab/fernmeldeskizze/lage/{element}` mit erwarteter `version` (409 bei
  Abweichung, mit aktuellem Stand) und `DELETE …/lage` für „Neu anordnen“.
  - Nachweis: Integrationstests „Zwei Personen ziehen dieselbe Einheit“ und „Neu anordnen“.
  - Erledigt: `zwei_personen_ziehen_dieselbe_einheit`, `neu_anordnen_verwirft_nur_die_lagen`,
    `lage_mit_version_ohne_zeile_ist_409_mit_leerem_stand`, `lage_prueft_element_und_werte`;
    `DELETE …/lage/{element}` mit `version` (Review O3): `einzelne_lage_verwerfen_mit_version`,
    `einzelne_lage_verwerfen_braucht_stab_recht`.
    409-Körper `SkizzenLageKonflikt { error, aktuell }`.
- [x] 5.2 Ziehen auf der Fläche mit `@dnd-kit/core` und `ZugPointerSensor`, Raster, Speichern; ruhige
  Fläche unter Zeiger/Fokus, Markierung „neu“.
  - Nachweis: Komponententests; e2e „Lage bleibt“ nach Neuladen und an einem zweiten Kontext.
  - Erledigt: Ziehen über `ZugPointerSensor` (Abstand 6 px), Ablegen rein entschieden
    (`wirkung.ts:ablageWirkung`, 21 Tests), Raster 8, sofort sichtbare Lage, je Element eine
    Schreibkette (zweites Verschieben schickt die Version des ersten statt eines 409), 409 meldet
    „von einem anderen Arbeitsplatz verschoben“; ruhige Fläche über `onHalten` → `gehalten`,
    „neu“-Marke. Komponententests „frei abgelegt“, „Einheit auf die Schiene“, „zweiter Pfeil
    wartet“ (Mutationsprobe Kette weg → rot). e2e „Lage bleibt“: 9.1.
- [x] 5.3 Fokusreihenfolge (rovinger `tabindex` nach D6), Pfeiltasten-Verschieben, Eigenschaftspaneel
  mit „zum Datensatz“.
  - Nachweis: Szenario „Verschieben mit Pfeiltasten“ als Test; e2e Tastaturfluss.
  - Erledigt: Fokusfolge `bedienung.ts:fokusfolge`, Tab/Umschalt+Tab wandern und verlassen die
    Fläche an den Enden, Fokus wählt und holt gezoomt in den Ausschnitt; Enter fokussiert die
    Paneel-Überschrift, „zum Datensatz ↗“ als `inspector-sprung`. Tests „Verschieben mit
    Pfeiltasten“, „Enter öffnet das Eigenschaftspaneel“, „Fokus nie verdeckt“ (Mutationsprobe
    Ausschnitt weg → rot), „Rufname im Paneel“. e2e Tastaturfluss: 9.1.

## 6. Schnitt 4 — Zuordnen und Lösen (D5, D6)

- [x] 6.1 Einzel-Endpunkte `PUT/DELETE …/sprechgruppen/{sg}` für Abschnitt, Einheit,
  Führungsstelle und Kommunikationsstelle (mit `status`), Rechte nach D5, dieselbe Repo-Funktion
  wie der PATCH, gleiches Live und ETB.
  - Nachweis: Integrationstests je Ziel: idempotent, „Gleichzeitig zwei Kanäle“, 403 je fehlendem
    Recht, 422 für Funktion mit Sprechgruppe, gleiche ETB-Wirkung wie der PATCH.
  - Erledigt: `tests/sprechgruppe_einzelzuordnung.rs` (7 Tests, je Ziel). PATCH und
    Einzel-Endpunkt laufen über `sprechgruppe::repo::zuordnen_tx`/`loesen_tx`.
- [x] 6.2 Ziehen Stelle → Schiene, Stichleitung lösen, Schiene aus der Palette (Katalog
  unverändert).
  - Nachweis: Szenarien „Einheit auf die Schiene“, „Stichleitung lösen“, „Katalog-Sprechgruppe auf
    die Fläche“ als Tests; e2e mit zweitem Kontext (Tabelle und Detailseite ohne Neuladen).
  - Erledigt: Stelle auf Schiene bzw. Anschluss auf Schiene = `ordneZu`, Stichleitung weg
    (> 4 Raster) oder Entf = `loese`, Palette (ziehen oder „Setzen“) = Lagezeile `sg-<id>`.
    Tests „Einheit auf die Schiene“ (Ziehen), „Stichleitung lösen“, Palette per Knopf, dazu
    `wirkung.test.ts`. e2e mit zweitem Kontext: 9.1.
- [x] 6.3 „Verbinden mit …“ (Suche, Taste `V`, Knopf), Entf, Kontextmenü per Langdruck.
  - Nachweis: Szenario „Zuordnen mit der Tastatur“ als e2e ohne Zeigeraktion.
  - Erledigt: `VerbindenDialog` (Combobox mit Listbox, Pfeile/Enter), Taste V und Knopf im
    Paneel, Kontextmenü über Rechtsklick, Langdruck (550 ms ohne Bewegung) und Kontextmenütaste
    (`PunktankerMenue`). Tests „Zuordnen mit der Tastatur“ (ohne Zeiger), Kontextmenü,
    „Langdruck am Tablet“. Der e2e-Lauf gehört zu 9.1.
- [x] 6.4 Befehlsstapel `stab/skizzenBefehle.ts` mit Strg+Z/Strg+Y und Knöpfen.
  - Nachweis: Szenarien „Zuordnung zurücknehmen“ und „Datensatz inzwischen gelöscht“ als Tests.
  - Teilweise: Kern `stab/skizzenBefehle.ts` (Stapel, Grund, Verwerfen) mit beiden Szenarien
    als Tests; Strg+Z/Strg+Y und Knöpfe fehlen noch.
  - Erledigt: Strg+Z, Strg+Y, Strg+Umschalt+Z an Element und Wurzel (nie in Feldern), Knöpfe
    „Rückgängig“/„Wiederholen“ mit Beschreibung im Titel; Scheitern am Element und in der
    Statuszeile. Tests „Zuordnung zurücknehmen“ und „Datensatz inzwischen gelöscht“ an der Fläche.
- [x] 6.5 Rechte je Element (D8): Griff nur mit Recht, Grund im Paneel, Fläche schreibgeschützt
  ohne Einsatz-Schreibrecht und mobil.
  - Nachweis: Szenarien „Nur Leserecht“, „Recht auf Stab, nicht auf Einheiten“, „Mobil“ als Tests.
  - Erledigt: `bedienung.ts:griffGrund`/`lageGrund`, Griffe nur mit Recht, Grund im Paneel
    (`skizze-rechte-grund`), ohne `aktionen` und unter 768 px nur lesen, zoomen, hervorheben.
    Tests „Nur Leserecht“, „Recht auf Stab, nicht auf Einheiten“, „Mobil“ (Mutationsprobe Recht
    je Stelle weg → rot).

## 7. Schnitt 5 — Externe Stellen, Verbindungen, Komponenten, Bereich (D3, D7)

- [x] 7.1 CRUD Komponenten (+ Kanäle), Verbindungen, Bereiche unter `…/stab/fernmeldeskizze`
  (`EinsatzSchreibzugriff<Stab>`), Validierung (Arten, Längen, keine Rufnummer-Felder).
  - Nachweis: Integrationstests inkl. „Unbekannte Art“ (400) und 403.
  - Erledigt: `repeater_zwischen_zwei_dmo_gruppen`, `melder_als_uebergang_und_validierung`
    (u. a. `brieftaube` → 400, `rufnummer` → 400, `von == nach` → 422),
    `bereich_aufziehen_mit_version`, 403 je Route.
- [x] 7.2 Externe Stelle in der Skizze anlegen (über die Kommunikationsplan-Routen), an Schienen
  binden mit Status, in den Bereich setzen.
  - Nachweis: Szenario „Leitstelle im rückwärtigen Bereich“ als e2e (Kommunikationsplan zeigt sie,
    kein Abschnitt/keine Einheit neu).
  - Erledigt (Fläche): Palette „Externe Stelle“ → `legeExterneStelleAn` (eine Stelle im
    Kommunikationsplan), Kanäle mit Status bestehend/geplant im Paneel, Bereich anlegen
    („Rückwärtiger Bereich“) und an der Ecke aufziehen. Tests „Leitstelle anlegen“, „Bereich
    anlegen“, „Bereich aufziehen“. Der e2e-Nachweis (Kommunikationsplan zeigt sie): 9.1.
- [x] 7.3 Punkt-zu-Punkt per Ziehen und per „Verbinden mit …“, Artwahl als Menü (Radial am Tablet,
  Liste am Fükw), Paneel für Art, Medium, Status, Verkehr, Hinweis.
  - Nachweis: Szenarien „Melder als Übergang“, „Geplante Datenverbindung“ als Tests.
  - Erledigt: Anschluss auf eine Stelle bzw. „Verbinden mit …“ → Artwahl (Liste am Fükw als
    `PunktankerMenue`, radial bei grobem Zeiger), Medium nach Art vorbelegt (`vorgabeMedium`),
    Paneel für Art, Medium, Status, Betriebsart, Hinweis (≤ 200). Tests „Melder als Übergang“
    (Dialog und Ziehen), „Geplante Datenverbindung“, „Artwahl am Tablet radial“.
- [x] 7.4 Kommunikationsplan: Kanäle externer Stellen als Nebentext, Rückfrage beim Entfernen nennt
  Kanäle und Skizzen-Verbindungen.
  - Nachweis: Szenarien aus dem Delta `stab-kommunikationsplan` als Tests.
  - Erledigt: `stab/kommunikationsplan.ts` (`kanaele` je Zeile, `entfernUmfang`,
    `brauchtRueckfrage`, `entfernText`) mit 20 Tests; `KommunikationsplanPage.test.tsx` 29 grün
    (8 neu): Kanäle als Nebentext mit „geplant“, Rückfrage mit Zahl der Verbindungen, Sprechgruppen
    und Skizzen-Verbindungen (unbekannt → benannt, Rückfrage trotzdem), Lücke „Leitstelle“ mit den
    Skizzen-Verbindungen als eigener Quelle („Fernmeldeskizze nicht geladen“). Kein Zähl-Endpunkt.

## 8. Schnitt 6 — Übernahme als Kommunikationsunterlage (D10)

- [x] 8.1 `rendereFunkplanMarkdown` um den Abschnitt „Kommunikationsskizze“ (Gültig ab, Schienen mit
  Teilnehmern und Status, übrige Verbindungen), ohne Rufnummern, Text statt Auszeichnung.
  - Nachweis: Szenario „Kanäle im Lagebericht“ als Test; fehlende Quelle nennt den Grund.
  - Erledigt: 7 Tests (5 zuerst rot). Fünftes Argument `{ netz, gueltigAb }` optional, bis
    `FunkplanPage` es übergibt (2.6); der Hinweis einer Verbindung bleibt draußen (Freitext).
- [ ] 8.2 Folgetickets per `clickup-task-anlegen`: Übernahme in den Befehl, Skizze als Bild-Anlage,
  Führungsmittel/Funktionen im Kasten, Feld „Netz“ an der Sprechgruppe (nach Duplikatsuche).
  - Nachweis: Tickets verlinkt im Nachtrag von `design.md`.

## 9. Abschluss

- [x] 9.1 e2e `e2e/fernmeldeskizze.spec.ts` ersetzt die alte Skizzen-Spec (Klappen, Baum, Kante);
  Gate 1 (`gate1-ueberlauf`) und Gate 3 (`gate3-trefflaeche`) für Fläche, Palette und Paneel.
  - Nachweis: Suite grün, keine Skips.
  - Erledigt: `e2e/fernmeldeskizze.spec.ts` (17 Tests: Messung, Sammelschiene, Ziehen mit zweitem
    Kontext und Strg+Z, Tastatur, Leitstelle, Geplant, Lücken, Wurzel, Lage, Gleichzeitig (409),
    Ruhige Fläche, zweimal Rechte, Mobil 390, Prüfliste 1 und 5) und `fernmeldeskizze-druck.spec.ts`
    ersetzen den Skizzenteil von `funkplan.spec.ts` (entfernt, nicht übersprungen); Gate 1 mit
    gewählter Einheit langen Namens und lesender Vorbedingung, Gate 3 für Werkzeugleiste,
    Palette, Paneel, Lücken-Wahl und Umschalter, auch als Beobachter. Gate 3 fand „zum Datensatz“
    mit 15 px (jetzt `stabZeilenzielStil`, Test zuerst rot). Chromium: neue Specs und beide Gates 40/42,
    die zwei roten (Gate 3 „zum Datensatz“) nach dem Fix 2/2; mit `funkplan`, `kommunikationsplan*`
    31/31 und Offline-Spec 1/1, keine Skips; Firefox/WebKit lokal nicht gelaufen.
- [ ] 9.2 Prüfliste Einsatztauglichkeit (15 Kriterien) für Fükw, Führungs-Tablet und mobil mit
  Verdikt als Nachtrag in `design.md`.
- [ ] 9.3 `frontend/src/stab/AGENTS.md` (Absatz Fernmeldeskizze neu) und `src/AGENTS.md` falls
  Regeln für Bezüge/Schwärzung dazukommen; Verweise auf die abgelösten Requirements gegrept.
- [ ] 9.4 `./scripts/check-all.sh` grün, Vitest und Rust-Tests grün.
- [ ] 9.5 `/opsx:archive lfh-893-taktische-fernmeldeskizze` im selben Branch vor dem PR.
