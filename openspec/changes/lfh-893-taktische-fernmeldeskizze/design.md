# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in den Delta-Specs. Pfade im
Frontend sind relativ zu `frontend/src/`, im Backend zu `src/`. Den Stand im Code hat der
Scope-Lauf vom 04.10.2026 erhoben.

### Was es schon gibt

- **Skizzenmodell** `stab/fernmeldeskizze.ts:baueFernmeldeskizze`: Baum über
  `baueFuehrungsorganisation` (Schlüssel `ab-<id>`, `eh-<id>`, `sammel`), Funkangaben wie die
  Tabelle, die Kante je Eltern-Kind-Paar über `stab/luecken.ts:verbindungsurteil`, Wurzel aus der
  eigenen Führungsstelle (`stab/fuehrungsstelle.ts`, LFH-849).
- **Darstellung** `stab/FernmeldeskizzeBild.tsx` über `components/organigramm/HaengenderBaum`
  (HTML-Karten im Grid, Klappziele, Druckregeln, Zugangsschleuse `baumSchleuse.ts`).
- **Kanalbelegung** `stab/sprechgruppenplan.ts` (LFH-848 D8): Menge der Sprechgruppen des Einsatzes
  (zugeordnet ∪ einsatzlokal, nach `id` entdoppelt, TMO vor DMO) mit ihren Teilnehmern. Das ist
  bereits die Menge der Sammelschienen.
- **Zuordnungen** (Migration 0073, 0145): `einsatzabschnitt_sprechgruppe`,
  `einsatz_einheit_sprechgruppe`, `einsatz_fuehrungsstelle_sprechgruppe`. Geschrieben nur über den
  PATCH des Datensatzes mit `sprechgruppe_ids` als **ganze Menge** (`sprechgruppe/repo.rs:
  setze_*_sprechgruppen`). Rechte: Abschnitt `EinsatzSchreibzugriff<Einsatzabschnitte>`, Einheit
  `EinsatzSchreibzugriff<Einheiten>`, Führungsstelle `EinsatzVerwaltungszugriff`.
- **Sprechgruppe** trägt `bezeichnung`, `betriebsart` (TMO/DMO), `hinweis`; Katalog (org-weit) oder
  einsatzlokal. Kein Feld „Netz“.
- **Externe Stellen** (LFH-848): `einsatz_kommunikation_stelle` mit `stellenart` funktion,
  leitstelle, behoerde, verbindungsperson, sonstige; Verbindungen (Rufnummer, Fax, Melder …) je
  Stelle in `einsatz_kommunikation_verbindung`. Routen unter `…/stab/kommunikationsplan`,
  `EinsatzSchreibzugriff<Stab>`, Live über das Stab-Ereignis. Die Lücke „Leitstelle“ ist
  `luecken.ts:leitstelleOhneVerbindung`.
- **Zeichen:** `zeichen/EinsatzZeichen`, `@einsatzzeichen/react`, `taktische-zeichen-react`. Keine
  Bibliothek kennt Bedingungszeichen, Funk-Zickzack oder J.3-Komponenten.
- **Vorbild Zeichenfläche:** der UHS-Grundriss (`pages/uhs/Grundriss.tsx`) zieht mit `@dnd-kit/core`
  über `ZugPointerSensor` (`frontend/AGENTS.md`, Drag & Drop) und schützt Schreibvorgänge mit einem
  erwarteten Stand (409 statt stillem Überschreiben, `uhs/repo.rs`).
- **Lageberichte und Befehle sind Text ohne Bild** (`dokument-uebernahme`, LFH-626 Non-Goal).

## Goals / Non-Goals

**Goals:**

- Ein Netzmodell als einzige Quelle für Bild, Lücken, Druck und Übernahme; die Lücken am Bild
  zählen dieselben Treffer wie das Paneel.
- Zuordnungen bleiben dort, wo sie heute liegen. Die Skizze speichert nur, was es sonst nirgends
  gibt.
- Jede Handlung am Bild hat einen Weg ohne Ziehen (WCAG 2.5.7) und ohne Farbe (WCAG 1.4.1).
- Keine neue Laufzeitabhängigkeit.

**Non-Goals:**

- **Technische Fernmeldeskizze (J.6)**: IP, Nebenstellen, Switch, WLAN.
- **Führungsmittel und Funktionen als kleine Zeichen im Kasten** (aus `fuehrung/`): bleibt
  Folgeticket; der Kasten zeigt Zeichen, Bezeichnung und Rufname.
- **Feld „Netz“ und „Sicherheit“ am Bedingungszeichen**: Die Sprechgruppe hat kein solches Feld;
  was nötig ist, steht im `hinweis` und erscheint unter dem Zeichen. Ein eigenes Feld wäre eine
  Änderung am Sprechgruppen-Katalog (Folgeticket, wenn S6 es braucht).
- **Status an Zuordnungen von Abschnitt, Einheit und Führungsstelle**: Eine Zuordnung dort ist der
  Funkplan und damit bestehend. „Geplant“ gibt es an skizzeneigenen Verbindungen und an Kanälen
  externer Stellen (D7).
- **Bild im Lagebericht oder Befehl** und **Übernahme in den Befehl** (D10, E6).
- **Versionen der Skizze** (D9, E5).
- **Bearbeiten der Sprechgruppe selbst** an der Schiene (Betriebsart, Bezeichnung): Katalog-Einträge
  gelten org-weit. Das Eigenschaftspaneel der Schiene zeigt sie und führt zu den Stammdaten bzw. zur
  einsatzlokalen Sprechgruppe.

## Decisions

### D1 · Zeichenfläche: eigene SVG-Lösung auf `@dnd-kit/core` (E1)

Die Skizze wird **ein SVG** mit eigener Ansichtstransformation (`viewBox` für Zoom und
Verschieben). Ziehen geht über `@dnd-kit/core` mit `ZugPointerSensor` und einem
`KeyboardSensor`-Ersatz durch eigene Pfeiltasten-Bedienung (D6). Elemente sind SVG-Gruppen mit
`role`, `aria-label` und rovingem `tabindex`.

Begründung:

- **Sammelschiene ist kein Graph-Kante.** React Flow und vergleichbare Bibliotheken kennen Kanten
  von Knoten zu Knoten. Eine Schiene mit n Stichleitungen müsste ein eigener Knotentyp mit
  eigenem Kantenrouting werden; der Nutzen der Bibliothek schrumpft auf Zoom und Ziehen.
- **Druck:** Ein SVG mit `viewBox` skaliert auf A3/A4 quer ohne Transform-Tricks. React Flow
  rendert HTML-Knoten in einer CSS-Transformation, die beim Drucken nachgerechnet werden muss.
- **Tastatur und Fokus** bleiben in unserer Hand (Fokusreihenfolge im Baum, „Verbinden mit …“).
- **Keine neue Abhängigkeit** (Bundle, Offline-Precache, Lizenzprüfung), Ziehen wie im Grundriss.

Verworfen: `@xyflow/react` (MIT, ~50 kB gz): stark bei freien Graphen, aber Bus-Layout, Druck und
Fokusführung müssten wir trotzdem selbst bauen. HTML-Karten im Grid wie heute: tragen keine
Schienen über Spalten hinweg.

### D2 · Netzmodell im Client

`stab/fernmeldeskizze.ts` wird zu `baueFernmeldenetz(quellen)` und liefert:

- **Stellen**: `fs` (Führungsstelle), `ab-<id>`, `eh-<id>`, `ks-<id>` (externe Stelle aus dem
  Kommunikationsplan, nur Stellenarten ≠ `funktion`), `ko-<id>` (Komponente). Je Stelle Art,
  Bezeichnung, Rufname, taktisches Zeichen, Ziel des Datensatzes, Schreibrecht (D8).
- **Schienen** `sg-<id>`: die Menge aus `baueSprechgruppenplan` plus Sprechgruppen, die nur eine
  externe Stelle, eine Komponente oder ein Lageeintrag (D4) trägt. Je Schiene die Teilnehmer
  (Stichleitungen) mit Status (D7).
- **Verbindungen** `vb-<id>`: skizzeneigene Punkt-zu-Punkt-Verbindungen (D3).
- **Bereiche** `be-<id>`.
- **Lücken** je Element, ausschließlich über `stab/luecken.ts` (D11).

Die Führungsorganisation (`baueFuehrungsorganisation`) bleibt die Vorlage für Auto-Layout und
Fokusreihenfolge, nicht mehr für Kanten. Fehlende Quellen werden wie heute benannt; eine fehlende
Quelle ist nie eine leere.

### D3 · Datenmodell (E2)

Eine Migration (Nummer beim Umsetzen per `scripts/check-migrationen.sh`, größer als jede auf
`alpha`):

- **`einsatz_kommunikation_stelle_sprechgruppe`** (`stelle_id` → Stelle ON DELETE CASCADE,
  `sprechgruppe_id` → Sprechgruppe ON DELETE CASCADE, `status` `bestehend|geplant`, PK beider IDs).
  Externe Stellen bekommen Kanäle **am Datensatz des Kommunikationsplans**; eine Leitstelle ist
  damit eine Stelle, nicht zwei.
- **`fernmeldeskizze_komponente`** (`id`, `einsatz_id`, `art` repeater|gateway|basisstation|
  mobile_basisstation|antenne|vermittlung, `bezeichnung` ≤ 100, Änderungsspalten) und
  **`fernmeldeskizze_komponente_sprechgruppe`** (M:N wie oben, ohne Status).
- **`fernmeldeskizze_verbindung`** (`id`, `einsatz_id`, `von_art`/`von_id`, `nach_art`/`nach_id`
  mit Art ∈ fuehrungsstelle|abschnitt|einheit|stelle|komponente, `art` telefon|fax|daten|melder|
  bild|livestream|richtfunk|satellit|sonstige, `medium` funk|leitung, `status` bestehend|geplant,
  `verkehr` wechsel|gegen|NULL, `hinweis` ≤ 200, Änderungsspalten). Keine Erreichbarkeit: Nummern
  stehen im Kommunikationsplan.
- **`fernmeldeskizze_bereich`** (`id`, `einsatz_id`, `bezeichnung` Vorgabe „Rückwärtiger
  Bereich“, `x`, `y`, `breite`, `hoehe`, `version`).
- **`fernmeldeskizze_lage`** (`einsatz_id`, `element` TEXT wie die Schlüssel aus D2, `x`, `y`,
  `breite` nur für Schienen, `version`, PK beider). Fehlt eine Zeile, platziert das Auto-Layout
  (D4).
- **`fernmeldeskizze_schriftfeld`** (`einsatz_id` PK, `herausgeber`, `vs_vermerk`
  keiner|vs_nfd, `gueltig_ab`, `gez_name`, `gez_at`). Fehlt die Zeile, gelten Vorgaben
  (Herausgeber = Einsatzbezeichnung, kein VS-Vermerk, leer). „Stand“ ist abgeleitet: der jüngste
  Änderungszeitpunkt aller Skizzendaten.

**Polymorphe Bezüge** (`von_art`/`von_id`, `element`) haben keinen Fremdschlüssel. Deshalb:
Löschen von Abschnitt, Einheit, Kommunikationsstelle und Komponente räumt im selben
Transaktionsschritt die Skizzenzeilen mit diesem Bezug ab (`stab::fernmeldeskizze::vergiss`).
Ein Guard-Test listet die Löschpfade; das Modell im Client ignoriert verwaiste Bezüge zusätzlich.

**Schwärzung:** `gez_name` und alle `hinweis`/`bezeichnung`-Spalten der neuen Tabellen ins
Register (`einsatz::schwaerzung_registry`); Arten, Status und Lage bleiben.

Verworfen: eine eigene Tabelle „externe Stelle“ der Skizze. Sie hätte die Leitstelle zweimal
geführt, und die Lücke „Leitstelle“ hätte zwei Regeln gebraucht. Ebenfalls verworfen: neue
Stellenarten (Krankenhaus, Nachbar-Einsatzleitung, Einheit auf dem Marsch). SQLite kann den
`CHECK` nur über einen Tabellenumbau ändern; die Bezeichnung ist frei, „sonstige“ trägt diese
Fälle. Kommt der Bedarf, ist es ein eigener Umbau.

### D4 · Layout und Auto-Layout

- **Auto-Layout** (`stab/fernmeldeskizzeLayout.ts`, rein, getestet): hängend nach der
  Führungsorganisation. Ebene 0 die Führungsstelle, darunter je oberster Abschnitt eine Spalte,
  darunter die Einheiten. Jede Schiene liegt waagerecht unter der höchsten Ebene ihrer Teilnehmer
  und spannt über deren Spalten. Externe Stellen stehen in einer Spalte rechts, Komponenten neben
  der ersten Schiene, an der sie hängen. Raster 8 px, Ausgabe in Rasterpunkten.
- **Gespeichert wird nur Verschobenes.** Ein Element ohne Lagezeile steht dort, wo das
  Auto-Layout es hinsetzt; ab dem ersten Verschieben trägt es eine Zeile. Neue Elemente erscheinen
  so immer, nie unsichtbar in einer Palette.
- **„Neu anordnen“** löscht alle Lagezeilen des Einsatzes (ein Aufruf). Zuordnungen bleiben
  unberührt.
- **Gleichzeitiges Verschieben:** `PUT …/lage/{element}` trägt die erwartete `version`. Weicht sie
  ab, antwortet der Server 409 mit dem aktuellen Stand; der Client setzt das Element auf diesen
  Stand und meldet „von einem anderen Arbeitsplatz verschoben“. Nichts wird still überschrieben.
- **Ruhige Fläche:** Solange Zeiger oder Fokus in der Fläche liegen, bleiben die Positionen
  auto-gelegter Elemente stehen; neu hinzukommende werden markiert („neu“) statt die übrigen zu
  verschieben. Gespeicherte Positionen bewegen sich live sofort.

### D5 · Zuordnen und Lösen: Einzel-Endpunkte statt ganzer Menge

Ziehen schreibt **eine** Zuordnung. Mit dem heutigen PATCH (`sprechgruppe_ids` als ganze Menge)
verlöre bei zwei gleichzeitig ziehenden Arbeitsplätzen einer seine Zuordnung. Neu, idempotent:

| Ziel | Setzen / Lösen | Recht |
| --- | --- | --- |
| Abschnitt | `PUT/DELETE /api/einsaetze/{id}/abschnitte/{aid}/sprechgruppen/{sg}` | `EinsatzSchreibzugriff<Einsatzabschnitte>` |
| Einheit | `PUT/DELETE /api/einsaetze/{id}/einheiten/{eid}/sprechgruppen/{sg}` | `EinsatzSchreibzugriff<Einheiten>` |
| Führungsstelle | `PUT/DELETE /api/einsaetze/{id}/fuehrungsstelle/sprechgruppen/{sg}` | `EinsatzVerwaltungszugriff` |
| Externe Stelle | `PUT/DELETE /api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid}/sprechgruppen/{sg}` (Body `status`) | `EinsatzSchreibzugriff<Stab>` |
| Komponente | `PUT/DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid}/sprechgruppen/{sg}` | `EinsatzSchreibzugriff<Stab>` |

Gleiche Prüfungen wie der PATCH (Sprechgruppe gehört zur Organisation bzw. zum Einsatz, aktiv),
gleiches Live-Ereignis, gleiche ETB-Wirkung wie eine Änderung von `sprechgruppe_ids` über den
PATCH. Der PATCH bleibt
(Formulare, `SprechgruppenPicker`).

### D6 · Bedienung: Ziehen, Tastatur, Touch, Rückgängig

- **Ziehen:** Stelle auf Schiene → zuordnen. Stichleitung von der Schiene wegziehen → lösen.
  Sprechgruppe aus der Palette auf die Fläche → Schiene mit Lagezeile. Vom Anschlusspunkt einer
  Stelle zu einer anderen → neue Punkt-zu-Punkt-Verbindung, die Art wählt ein Menü am Linienende
  (Radialmenü am Tablet, Liste am Fükw, beides dieselben Einträge).
- **Tastatur:** Tab/Umschalt+Tab in der Fokusreihenfolge der Führungsorganisation, danach
  Schienen, externe Stellen, Komponenten, Verbindungen. Pfeiltasten verschieben um ein Rasterfeld
  (mit Umschalt um fünf), Enter öffnet das Eigenschaftspaneel, `V` öffnet „Verbinden mit …“ (Suche
  über Schienen und Stellen), Entf löst die gewählte Stichleitung bzw. entfernt die gewählte
  Verbindung, Strg+Z / Strg+Y bzw. Strg+Umschalt+Z. Kürzel als `Tastenkuerzel`-Marke.
- **Touch (Führungs-Tablet):** Trefferflächen nach Dichte-Staffel, Ziehen mit dem Finger,
  Zwei-Finger-Zoom, Langdruck öffnet das Kontextmenü. Zoom auch über Knöpfe (+, −, Einpassen).
- **Mobil (< 768 px):** nur lesen, zoomen, hervorheben.
- **Rückgängig:** Befehlsstapel je Tab (`stab/skizzenBefehle.ts`), nur eigene Handlungen dieser
  Sitzung, je Eintrag die Gegenhandlung (Zuordnen ↔ Lösen, Verschieben ↔ zurückschieben mit
  aktueller `version`). Scheitert eine Gegenhandlung (Datensatz gelöscht, 409), steht der Grund am
  Element, und der Eintrag fällt aus dem Stapel.

### D7 · Status „geplant“ (E3)

„Geplant“ ist **nur Darstellung**: gestrichelt und mit dem Wort „geplant“ am Element, im Druck
ebenso. Kein ETB-Eintrag, keine Erinnerung. Status tragen skizzeneigene Verbindungen und die Kanäle
externer Stellen. Zuordnungen von Abschnitt, Einheit und Führungsstelle sind bestehend.

### D8 · Rechte

Je Element entscheidet das Recht seines Datensatzes (Tabelle D5); alles Skizzeneigene (Lage,
Komponente, Verbindung, Bereich, Schriftfeld) braucht Schreibrecht auf den Stab. Der Client leitet
das je Element ab und bietet ohne Recht keinen Griff an (das Element bleibt fokussierbar und
hervorhebbar, das Paneel nennt den Grund). Ohne Schreibrecht im Einsatz
(`darfImEinsatzSchreiben`) ist die ganze Fläche schreibgeschützt. Der Server lehnt mit 403 ab,
unabhängig vom Client.

### D9 · Kein Versionsstand der Skizze (E5)

Es gibt den Live-Stand. „Gültig ab“ im Schriftfeld setzt S6 von Hand. Ein fester Stand entsteht nur
durch die Übernahme in den Lagebericht (D10) und durch den Druck mit Druckzeit.

### D10 · Übernahme als Kommunikationsunterlage (E6)

Die bestehende Funkplan-Übernahme („In Lagebericht übernehmen“, `stab/funkplan.ts:
rendereFunkplanMarkdown`) bekommt nach dem Baum einen Abschnitt **„Kommunikationsskizze“**:
„Gültig ab“, je Schiene Bedingungszeichen und Teilnehmer (mit Rufname, Status bei externen
Stellen), danach die übrigen Verbindungen mit Art, Medium und Status. Keine Erreichbarkeit, keine
Rufnummern. Lageberichte bleiben Text (LFH-626). Eine Übernahme in den **Befehl** und ein Bild als
Anlage werden Folgetickets.

### D11 · Lücken

Alle Regeln in `stab/luecken.ts`, Bild und Paneel lesen dieselben Treffer:

- bisher: Abschnitt/Einheit ohne Sprechgruppe, lokale Sprechgruppe ohne Zuordnung, Verbindung ohne
  gemeinsame Sprechgruppe (`verbindungsurteil`, unverändert, jetzt am Element der unteren Stelle).
- **neu `schienenMitEinemTeilnehmer`**: eine Sprechgruppe mit genau einem Teilnehmer (Stelle oder
  Komponente). Ohne Teilnehmer zählt eine lokale Sprechgruppe weiter nur bei „ohne Zuordnung“;
  eine Katalog-Schiene ohne Teilnehmer (nur Lagezeile) zählt hier ebenfalls.
- **`leitstelleOhneVerbindung` erweitert**: Eine Leitstelle gilt als verbunden, wenn sie eine
  Verbindung im Kommunikationsplan, einen Kanal oder eine Skizzen-Verbindung trägt. Eine Regel für
  Kommunikationsplan, Funkplan und Skizze.

Jede Lücke hängt an ihren Quellen; fehlt eine, steht „—“ mit Grund. Klick auf eine Lücke im
Paneel wählt das Element in der Skizze (in Tabelle und Sprechgruppen-Darstellung bleibt der
Verweis auf den Datensatz).

### D12 · Zeichen

Bausteine in `stab/skizzenZeichen.tsx`: Bedingungszeichen (Langsechseck mit Text, wächst mit dem
Text), Linienarten je Medium (Funk mit Zickzack-Marke in der Mitte, leitergebunden glatt),
Strichmuster je Status, Zeichen je Verbindungsart und Komponente nach J.1–J.3, Strich-Punkt-Grenze
für Bereiche. Stellen und Einheiten über die bestehenden `TzProps`. Was die Bibliotheken nicht
haben, zeichnen wir als SVG; dafür entsteht ein Folgeticket an `@einsatzzeichen`. Bedeutung trägt
immer Form und Wort, nie Farbe allein.

### D13 · Druck

Eigenes Druckstück „Fernmeldeskizze“ wie heute, neu quer: Segmentleiste A3/A4 vor dem Druck, Vorgabe
A3 (J.5). Das SVG skaliert über `viewBox` auf die Seite, ohne Bedienelemente, Hervorhebung und
Filter; das Schriftfeld steht unten rechts. Die Funkplan-Tabelle folgt ab einer neuen Seite als
Anlage. Graustufen: Linienart, Muster und Wort tragen jede Unterscheidung.

### D14 · API-Vertrag (verbindlich für Backend und Client)

Alle Pfade unter `/api/einsaetze/{id}`. Feldnamen snake_case wie im übrigen API.

**Lesen** `GET /stab/fernmeldeskizze` (`EinsatzLesezugriff<Stab>`) → `Fernmeldeskizze`:

```
Fernmeldeskizze  { lage: SkizzenLage[], komponenten: SkizzenKomponente[],
                   verbindungen: SkizzenVerbindung[], bereiche: SkizzenBereich[],
                   schriftfeld: Schriftfeld, stand: string | null }   // stand = jüngstes geaendert_at
SkizzenLage      { element: string, x: number, y: number, breite: number | null, version: number }
                 // element ∈ "fs" | "ab-<id>" | "eh-<id>" | "ks-<id>" | "ko-<id>" | "sg-<id>"
SkizzenKomponente{ id, art: Komponentenart, bezeichnung: string | null,
                   sprechgruppen: SprechgruppeAnzeige[] }
SkizzenVerbindung{ id, von: SkizzenBezug, nach: SkizzenBezug, art: Verbindungsart,
                   medium: "funk" | "leitung", status: Verbindungsstatus,
                   verkehr: "wechsel" | "gegen" | null, hinweis: string | null }
SkizzenBezug     { art: "fuehrungsstelle" | "abschnitt" | "einheit" | "stelle" | "komponente",
                   id: number | null }                                // id null nur bei fuehrungsstelle
SkizzenBereich   { id, bezeichnung: string, x, y, breite, hoehe, version: number }
Schriftfeld      { herausgeber: string | null, vs_vermerk: "keiner" | "vs_nfd",
                   gueltig_ab: string | null, gez_name: string | null, gez_at: string | null }
Komponentenart   = "repeater" | "gateway" | "basisstation" | "mobile_basisstation" | "antenne" | "vermittlung"
Verbindungsart   = "telefon" | "fax" | "daten" | "melder" | "bild" | "livestream" | "richtfunk" | "satellit" | "sonstige"
Verbindungsstatus= "bestehend" | "geplant"
```

`KommunikationsStelle` (Kommunikationsplan) bekommt `sprechgruppen: StellenKanal[]` mit
`StellenKanal { sprechgruppe: SprechgruppeAnzeige, status: Verbindungsstatus }`; bei Funktionen
immer leer.

**Schreiben** (alle `EinsatzSchreibzugriff<Stab>`, sofern nicht anders genannt):

| Aufruf | Body | Antwort |
| --- | --- | --- |
| `PUT /stab/fernmeldeskizze/lage/{element}` | `{ x, y, breite?, version: number \| null }` (`null` = noch keine Zeile erwartet) | 200 `SkizzenLage`; 409 bei abweichender Version |
| `DELETE /stab/fernmeldeskizze/lage` | — | 204 („Neu anordnen“) |
| `PUT /stab/fernmeldeskizze/schriftfeld` | Teilfelder, Tri-State (fehlend = unverändert, `null` = leeren) | 200 `Schriftfeld` |
| `POST /stab/fernmeldeskizze/komponenten` | `{ art, bezeichnung? }` | 201 `SkizzenKomponente` |
| `PATCH/DELETE /stab/fernmeldeskizze/komponenten/{kid}` | `{ art?, bezeichnung? }` | 200 / 204 |
| `PUT/DELETE /stab/fernmeldeskizze/komponenten/{kid}/sprechgruppen/{sg}` | — | 204 |
| `POST /stab/fernmeldeskizze/verbindungen` | `{ von, nach, art, medium, status, verkehr?, hinweis? }` | 201 `SkizzenVerbindung`; 422 bei `von == nach` oder Bezug außerhalb des Einsatzes |
| `PATCH/DELETE /stab/fernmeldeskizze/verbindungen/{vid}` | Teilfelder ohne `von`/`nach` | 200 / 204 |
| `POST /stab/fernmeldeskizze/bereiche` | `{ bezeichnung?, x, y, breite, hoehe }` | 201 `SkizzenBereich` |
| `PATCH/DELETE /stab/fernmeldeskizze/bereiche/{bid}` | `{ bezeichnung?, x?, y?, breite?, hoehe?, version }` | 200 / 204; 409 bei abweichender Version |
| `PUT/DELETE /abschnitte/{aid}/sprechgruppen/{sg}` | — | 204 (`EinsatzSchreibzugriff<Einsatzabschnitte>`) |
| `PUT/DELETE /einheiten/{eid}/sprechgruppen/{sg}` | — | 204 (`EinsatzSchreibzugriff<Einheiten>`) |
| `PUT/DELETE /fuehrungsstelle/sprechgruppen/{sg}` | — | 204 (`EinsatzVerwaltungszugriff`) |
| `PUT/DELETE /stab/kommunikationsplan/stellen/{sid}/sprechgruppen/{sg}` | PUT `{ status }` | 204; 422 bei Stellenart `funktion` |

PUT und DELETE der Zuordnungen sind idempotent. Jede Änderung sendet das Live-Ereignis des
Datensatzes (Abschnitt, Einheit, Einsatz, Stab), die Skizzendaten das Stab-Ereignis.

## Risks / Trade-offs

- [Eigene Zeichenfläche ist viel Code] → Bausteine rein und getestet (Layout, Modell, Befehle),
  das SVG nur Darstellung; Fokus- und Zieh-Verhalten über e2e.
- [Polymorphe Bezüge verwaisen] → Aufräumen im selben Transaktionsschritt jedes Löschpfads,
  Guard-Test über die Löschpfade, Modell ignoriert verwaiste Bezüge.
- [Auto-Layout bei vielen Abschnitten unübersichtlich] → Einpassen beim Öffnen, Ebenenfilter,
  Hervorheben; Messung mit 8 Abschnitten × 3 Einheiten bei 1366 × 768 vor dem Bau des Layouts.
- [Rechte je Element überraschen] → Grund im Eigenschaftspaneel und am Griff, nicht stilles
  Fehlen.
- [Einzel-Endpunkte neben dem PATCH] → beide rufen dieselbe Repo-Funktion je Zuordnung, ein Test
  belegt gleiche Wirkung (Live, ETB).
- [Spec-Bruch der alten Skizze] → Die alten Requirements werden ausdrücklich abgelöst; e2e der
  alten Skizze wird ersetzt, nicht stillgelegt.

## Migration Plan

Eine Migration, nur neue Tabellen. Bestehende Zuordnungen bleiben unverändert; ohne Lagezeilen
zeigt jeder laufende Einsatz die Skizze im Auto-Layout. Rücknahme: Frontend auf den alten Stand,
die neuen Tabellen bleiben ungenutzt liegen (anhängen, nie ändern, LFH-658).

## Open Questions

- Genaue Schwellen für Mobil-Lesemodus und Zoomgrenzen ergeben sich aus der Messung (Aufgabe 1).

## Nachträge (Bau)

- **D12:** `@einsatzzeichen/core` 3.0.0 enthält Anhang J.1–J.4 (`COMMS_PICTOGRAMS`, `pictogram('comms.<id>',
  'primary' | 'alternative')`, `primary` = Funk mit Zickzack). Die Verbindungsarten außer Melder,
  sonstige und Satellit sowie alle Komponenten kommen aus dem Katalog; ein kleiner Renderer setzt
  Schwarz auf `currentColor` und Weiß auf `--lfh-skizze-grund`. Selbst gezeichnet (Konstante
  `SELBST_GEZEICHNET`): Bedingungszeichen, Sammelschiene, Zickzack-Marke auf freier Linie,
  „geplant“, Bereich, Melder, sonstige, Satellit. Folgeticket an `@einsatzzeichen`: LFH-1033.
- **Folgetickets aus D10 und den Non-Goals:** Übernahme in den Befehl (LFH-1027), Bild-Anlage an
  Lagebericht und Befehl, Führungsmittel im Kasten (LFH-1029), Felder „Netz“/„Sicherheit“ an der
  Sprechgruppe (LFH-1030).
- **D5/D14 (Backend):** Die Einzel-Endpunkte prüfen die Sprechgruppe wie der PATCH
  (`pruefe_zuordenbar`), also nicht auf `aktiv`. Ein 409 bei Lage bzw. Bereich trägt
  `aktuell` (`SkizzenLageKonflikt`, `SkizzenBereichKonflikt`); `version` ist im Lage-Body Pflicht
  (`null` = keine Zeile erwartet), `breite` nur bei `sg-`. Ein leerer Herausgeber liefert die
  Einsatzbezeichnung. Zuordnungen senden ihr Live-Ereignis nur bei echter Änderung; kein Weg
  schreibt ins ETB (auch der PATCH nicht). Das Einzel-PUT an der Führungsstelle legt keine
  Zeile `einsatz_fuehrungsstelle` an.

