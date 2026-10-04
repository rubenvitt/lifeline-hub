# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- Rust: `cargo test --test <datei>` bzw. `cargo test <modul>::tests`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`. Die Gliederung
folgt den Schnitten des Tickets; jeder Schnitt ist für sich lauffähig und grün.

## 1. Messen vor dem Bau (D4, D13)

- [ ] 1.1 Messspec `e2e/fernmeldeskizze-flaeche.spec.ts` (vorläufig, geht in 9.1 auf): bei
  1366 × 768 mit offenem Modulpanel, 1024, 768 und 390 px die verfügbare Flächengröße unter
  `stab/funkplan?ansicht=skizze` messen; dazu die Laufweite des längsten Bedingungszeichens
  („TMO BN_BOS_LANGNAME_40“) und eines Rufnamens von 30 Zeichen.
  - Nachweis: Messwerte und daraus Rastermaß, Spaltenbreite des Auto-Layouts, Zoomgrenzen und
    Mobil-Schwelle als Nachtrag in `design.md` D4.

## 2. Schnitt 1 — Netzmodell und Darstellung, abgeleitet (D2, D11, D12)

- [ ] 2.1 `stab/luecken.ts`: `schienenMitEinemTeilnehmer` und erweiterte
  `leitstelleOhneVerbindung` (Kommunikationsplan-Verbindung, Kanal, Skizzen-Verbindung) als reine
  Filter mit Zustand.
  - Nachweis: Tests zuerst rot; je Regel „fehlende Quelle → Zustand statt Zahl“; Kommunikationsplan
    nutzt dieselbe Funktion (bestehende Tests grün).
- [ ] 2.2 `stab/fernmeldeskizze.ts`: `baueFernmeldenetz` mit Stellen (`fs`, `ab-`, `eh-`, `ks-`,
  `ko-`), Schienen (`sg-`, Menge wie `baueSprechgruppenplan` plus Kanäle externer Stellen und
  Komponenten), Verbindungen, Bereichen und Lücken je Element; verwaiste Bezüge werden
  ausgelassen.
  - Nachweis: Spec-Szenarien „Vier Stellen auf einem Kanal“, „Übergang“, „Wurzel“, „Wurzel mit
    erfasster Führungsstelle“, „Funktion S2“ als Tests; Lückenzahl je Element gleich Paneel
    (Eigenschaftstest über Zufallsgliederungen).
- [ ] 2.3 `stab/skizzenZeichen.tsx`: Bedingungszeichen, Linienarten je Medium, Strichmuster je
  Status mit Wort, Zeichen je Verbindungsart und Komponente, Strich-Punkt-Grenze.
  - Nachweis: Render-Tests je Baustein (Wort „geplant“ vorhanden, kein Farb-only-Merkmal);
    Folgeticket an `@einsatzzeichen` über `clickup-task-anlegen` angelegt.
- [ ] 2.4 `stab/fernmeldeskizzeLayout.ts`: Auto-Layout nach D4 (rein, Rasterpunkte).
  - Nachweis: Szenario „Erstes Öffnen“ als Test; keine Überlappung von Kästen bei 8 × 3; jedes
    Element platziert.
- [ ] 2.5 `stab/FernmeldeskizzeBild.tsx` als SVG-Fläche (schreibgeschützt): Kästen, Zeichen,
  Schienen, Stichleitungen, Lücken am Element, Einpassen, Zoom über Knöpfe/Strg+Rad/zwei Finger,
  Hervorheben und Ebenenfilter. `HaengenderBaum` bleibt dem Organigramm.
  - Nachweis: Komponententests für Hervorheben (Form/Strich, nicht nur Farbe), Filter „nur Lücken“,
    fehlende Quellen („Externe Stellen: nicht geladen“); Klick im Lücken-Paneel wählt das Element.
- [ ] 2.6 `pages/FunkplanPage.tsx`: Quellen Kommunikationsplan und Skizzendaten mit eigener
  Weiche; Lücken-Paneel um die zwei neuen Zeilen in allen drei Darstellungen; Sprechgruppen-
  Darstellung mit externen Stellen und Komponenten als Teilnehmer.
  - Nachweis: bestehende Funkplan-Tests grün; neue Szenarien aus `stab-funkplan` als Tests.

## 3. Backend — Datenmodell, Lesen, Schwärzung (D3)

- [ ] 3.1 Migration `NNNN_fernmeldeskizze.sql` mit `einsatz_kommunikation_stelle_sprechgruppe` und
  den Skizzen-Tabellen nach D3. Nummer per `git fetch origin alpha && scripts/check-migrationen.sh`.
  - Nachweis: `db::tests::migrationsnummern_sind_eindeutig` und `check-migrationen.sh` grün.
- [ ] 3.2 `wire_enum!` für Komponentenart, Verbindungsart, Medium, Status, Verkehr, VS-Vermerk in
  `src/stab/fernmeldeskizze.rs`, registriert in `src/api_doc.rs` und `tests/enum_wire_kontrakt.rs`.
  - Nachweis: Wire-Kontrakt zuerst rot, dann grün.
- [ ] 3.3 `GET /api/einsaetze/{id}/stab/fernmeldeskizze` (`EinsatzLesezugriff<Stab>`): Lage,
  Komponenten samt Kanälen, Verbindungen, Bereiche, Schriftfeld (mit Vorgaben), abgeleiteter Stand.
  Kommunikationsplan-Antwort um die Kanäle externer Stellen erweitert.
  - Nachweis: Integrationstest Lesen; 403 bei gesperrtem Stab; Typ-Codegen
    (`scripts/check-typ-codegen.sh`) mit beiden generierten Dateien.
- [ ] 3.4 Schwärzungsregister: `gez_name`, alle `bezeichnung`/`hinweis` der neuen Tabellen.
  - Nachweis: Registry-Guard zuerst rot; Test schwärzt einen Einsatz und prüft Arten, Status und
    Lage erhalten, Namen und Hinweise weg.
- [ ] 3.5 Aufräumen polymorpher Bezüge (`stab::fernmeldeskizze::vergiss`) in den Löschpfaden von
  Abschnitt, Einheit, Kommunikationsstelle und Komponente, im selben Transaktionsschritt.
  - Nachweis: Szenario „Einheit gelöscht“ als Integrationstest; Guard-Test über die Löschpfade.

## 4. Schnitt 2 — Schriftfeld und Druck (D13)

- [ ] 4.1 `PUT …/stab/fernmeldeskizze/schriftfeld` (`EinsatzSchreibzugriff<Stab>`, Teilfelder,
  Zeiten über die Zeitkonvention), Live über das Stab-Ereignis.
  - Nachweis: Integrationstest inkl. 403 ohne Stab-Schreibrecht; kein ETB.
- [ ] 4.2 Schriftfeld im Bild und im Paneel (Inline nach `InlineAngabe`/`ZeitpunktEingabe`).
  - Nachweis: Szenario „Schriftfeld ohne Angaben“ und „Gültig ab setzen“ als Tests.
- [ ] 4.3 Druck quer A3/A4 mit Schriftfeld, ganze Skizze auf Seite 1, Funkplan-Tabelle als Anlage
  ab neuer Seite, Filter und Hervorhebung aus.
  - Nachweis: e2e Druck-Emulation (Seitengröße, Seitenumbruch vor der Anlage, kein Überhang);
    Graustufen-Szenario per Screenshot-Vergleich im Graustufenfilter.

## 5. Schnitt 3 — Zeichenfläche mit Layout (D1, D4)

- [ ] 5.1 `PUT/DELETE …/stab/fernmeldeskizze/lage/{element}` mit erwarteter `version` (409 bei
  Abweichung, mit aktuellem Stand) und `DELETE …/lage` für „Neu anordnen“.
  - Nachweis: Integrationstests „Zwei Personen ziehen dieselbe Einheit“ und „Neu anordnen“.
- [ ] 5.2 Ziehen auf der Fläche mit `@dnd-kit/core` und `ZugPointerSensor`, Raster, Speichern; ruhige
  Fläche unter Zeiger/Fokus, Markierung „neu“.
  - Nachweis: Komponententests; e2e „Lage bleibt“ nach Neuladen und an einem zweiten Kontext.
- [ ] 5.3 Fokusreihenfolge (rovinger `tabindex` nach D6), Pfeiltasten-Verschieben, Eigenschaftspaneel
  mit „zum Datensatz“.
  - Nachweis: Szenario „Verschieben mit Pfeiltasten“ als Test; e2e Tastaturfluss.

## 6. Schnitt 4 — Zuordnen und Lösen (D5, D6)

- [ ] 6.1 Einzel-Endpunkte `PUT/DELETE …/sprechgruppen/{sg}` für Abschnitt, Einheit,
  Führungsstelle und Kommunikationsstelle (mit `status`), Rechte nach D5, dieselbe Repo-Funktion
  wie der PATCH, gleiches Live und ETB.
  - Nachweis: Integrationstests je Ziel: idempotent, „Gleichzeitig zwei Kanäle“, 403 je fehlendem
    Recht, 422 für Funktion mit Sprechgruppe, gleiche ETB-Wirkung wie der PATCH.
- [ ] 6.2 Ziehen Stelle → Schiene, Stichleitung lösen, Schiene aus der Palette (Katalog
  unverändert).
  - Nachweis: Szenarien „Einheit auf die Schiene“, „Stichleitung lösen“, „Katalog-Sprechgruppe auf
    die Fläche“ als Tests; e2e mit zweitem Kontext (Tabelle und Detailseite ohne Neuladen).
- [ ] 6.3 „Verbinden mit …“ (Suche, Taste `V`, Knopf), Entf, Kontextmenü per Langdruck.
  - Nachweis: Szenario „Zuordnen mit der Tastatur“ als e2e ohne Zeigeraktion.
- [ ] 6.4 Befehlsstapel `stab/skizzenBefehle.ts` mit Strg+Z/Strg+Y und Knöpfen.
  - Nachweis: Szenarien „Zuordnung zurücknehmen“ und „Datensatz inzwischen gelöscht“ als Tests.
- [ ] 6.5 Rechte je Element (D8): Griff nur mit Recht, Grund im Paneel, Fläche schreibgeschützt
  ohne Einsatz-Schreibrecht und mobil.
  - Nachweis: Szenarien „Nur Leserecht“, „Recht auf Stab, nicht auf Einheiten“, „Mobil“ als Tests.

## 7. Schnitt 5 — Externe Stellen, Verbindungen, Komponenten, Bereich (D3, D7)

- [ ] 7.1 CRUD Komponenten (+ Kanäle), Verbindungen, Bereiche unter `…/stab/fernmeldeskizze`
  (`EinsatzSchreibzugriff<Stab>`), Validierung (Arten, Längen, keine Rufnummer-Felder).
  - Nachweis: Integrationstests inkl. „Unbekannte Art“ (400) und 403.
- [ ] 7.2 Externe Stelle in der Skizze anlegen (über die Kommunikationsplan-Routen), an Schienen
  binden mit Status, in den Bereich setzen.
  - Nachweis: Szenario „Leitstelle im rückwärtigen Bereich“ als e2e (Kommunikationsplan zeigt sie,
    kein Abschnitt/keine Einheit neu).
- [ ] 7.3 Punkt-zu-Punkt per Ziehen und per „Verbinden mit …“, Artwahl als Menü (Radial am Tablet,
  Liste am Fükw), Paneel für Art, Medium, Status, Verkehr, Hinweis.
  - Nachweis: Szenarien „Melder als Übergang“, „Geplante Datenverbindung“ als Tests.
- [ ] 7.4 Kommunikationsplan: Kanäle externer Stellen als Nebentext, Rückfrage beim Entfernen nennt
  Kanäle und Skizzen-Verbindungen.
  - Nachweis: Szenarien aus dem Delta `stab-kommunikationsplan` als Tests.

## 8. Schnitt 6 — Übernahme als Kommunikationsunterlage (D10)

- [ ] 8.1 `rendereFunkplanMarkdown` um den Abschnitt „Kommunikationsskizze“ (Gültig ab, Schienen mit
  Teilnehmern und Status, übrige Verbindungen), ohne Rufnummern, Text statt Auszeichnung.
  - Nachweis: Szenario „Kanäle im Lagebericht“ als Test; fehlende Quelle nennt den Grund.
- [ ] 8.2 Folgetickets per `clickup-task-anlegen`: Übernahme in den Befehl, Skizze als Bild-Anlage,
  Führungsmittel/Funktionen im Kasten, Feld „Netz“ an der Sprechgruppe (nach Duplikatsuche).
  - Nachweis: Tickets verlinkt im Nachtrag von `design.md`.

## 9. Abschluss

- [ ] 9.1 e2e `e2e/fernmeldeskizze.spec.ts` ersetzt die alte Skizzen-Spec (Klappen, Baum, Kante);
  Gate 1 (`gate1-ueberlauf`) und Gate 3 (`gate3-trefflaeche`) für Fläche, Palette und Paneel.
  - Nachweis: Suite grün, keine Skips.
- [ ] 9.2 Prüfliste Einsatztauglichkeit (15 Kriterien) für Fükw, Führungs-Tablet und mobil mit
  Verdikt als Nachtrag in `design.md`.
- [ ] 9.3 `frontend/src/stab/AGENTS.md` (Absatz Fernmeldeskizze neu) und `src/AGENTS.md` falls
  Regeln für Bezüge/Schwärzung dazukommen; Verweise auf die abgelösten Requirements gegrept.
- [ ] 9.4 `./scripts/check-all.sh` grün, Vitest und Rust-Tests grün.
- [ ] 9.5 `/opsx:archive lfh-893-taktische-fernmeldeskizze` im selben Branch vor dem PR.
