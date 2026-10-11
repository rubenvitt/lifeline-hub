# Proposal

## Why

Die eigene Führungsstelle (LFH-849) kennt heute nur Funkangaben und eine Liste von Fahrzeugen. Ihren
Ort kennt sie nicht, ebenso wenig ihre Art und einen Namen. Nach FwDV 100 ist die Führungsstelle
aber der Ort, an dem die Einsatzleitung mit ihren Führungsmitteln arbeitet. Er kann mobil sein (ELW 1,
ELW 2) oder ortsfest (Feuerwehrhaus, TEL im Rathaus). Fahrzeuge sind dabei die Ausstattung, nicht
die Stelle. Wer die Führungsstelle sucht, also Melder, nachrückende Einheiten oder die Lagekarte,
braucht den Ort. Bisher steht er nur als Freitext in der Bemerkung des Checklistenpunkts „Aufstellort
des ELW festgelegt“ (Rubens UX-Durchgang vom 10.10.2026, LFH-1181).

## What Changes

- Die Führungsstelle bekommt drei neue Angaben:
  - **Art** (`mobil` | `ortsfest`): gilt ab der ersten Angabe, Vorgabe `mobil`. Sie lässt sich
    nicht leeren.
  - **Bezeichnung** (Freitext, z. B. „ELW 2 Musterstadt“, „TEL Rathaus“).
  - **Standort**: Adresse und Koordinate. Er wird als Gruppe gespeichert und geprüft wie andere
    Koordinatenpaare.
- Die Angaben werden per Migration angefügt, im PATCH als Teil-Patch je Angabe (Tri-State) geführt
  und im Abruf mitgeliefert. Codegen, Enum-Wire-Kontrakt und Eingabegrenzen werden nachgezogen.
- Die Schwärzung leert zusätzlich Adresse und Koordinate des Standorts, wie beim Einsatzort. Art und
  Bezeichnung bleiben als Führungsstruktur erhalten.
- Das Paneel „Eigene Führungsstelle“ auf der Seite Einsatzdaten zeigt Art, Bezeichnung und
  Standort:
  - Der Standort besteht aus Adresse als Text und Koordinate über die vorhandene
    Koordinateneingabe. Dazu kommt „wie Einsatzort“ als **einmalige Übernahme**.
  - Die Zeile „Fahrzeuge“ heißt künftig „Führungsfahrzeuge“. Bei `ortsfest` ist sie eingeklappt.
  - Eine Adresssuche gibt es hier noch nicht. Sie kommt mit dem Ortsfeld-Baustein (LFH-1248,
    LFH-1254).
- Die Abnehmer zeigen die Bezeichnung:
  - Funkplan: im Zusatz der Zeile „Führungsstelle“.
  - Fernmeldeskizze: als Zeile im Kasten „Einsatzleitung“.
  - Organigramm: an der Wurzel „Einsatzleitung“. Damit fällt das Non-Goal aus LFH-849, nach dem
    die Führungsstelle nicht ins Organigramm übernommen wird.
- Die Lagekarte zeigt die Führungsstelle **nur lesend** als Marker mit dem DV-102-Zeichen
  „Befehlsstelle“ und ihrer Bezeichnung, sobald eine Koordinate gesetzt ist.
- Checklistenpunkt `aufstellort`:
  - Er heißt jetzt „Standort der Führungsstelle festgelegt“.
  - Er zeigt den erfassten Standort als Wert und verlinkt auf das Paneel.
  - Der Haken bleibt Handarbeit, und der gespeicherte Schlüssel bleibt.
- Die Anwenderdoku wird nachgezogen: `einsatzdaten.md`, `funkplan.md`, `stab.md`, `lagekarte.md`,
  dazu die Bilder.

Nichts davon bricht etwas. Bestehende Führungsstellen lesen sich als `mobil` ohne Bezeichnung und
Standort.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatz-fuehrungsstelle`: neue Angaben Art, Bezeichnung und Standort samt Prüfung, Paneel-Zeilen
  „Führungsfahrzeuge“ und Standort; die Schwärzung leert den Standort mit.
- `stab-funkplan`: Die Zeile der Führungsstelle nennt die Bezeichnung.
- `stab-fernmeldeskizze`: Der Kasten „Einsatzleitung“ nennt die Bezeichnung.
- `fuehrungsorganisation`: Die Wurzel „Einsatzleitung“ nennt die Bezeichnung der Führungsstelle.
- `stab-checkliste`: neuer Wortlaut des ersten Punkts; er zeigt den Standort der Führungsstelle,
  ohne den Haken abzuleiten.
- `lagekarte-taktische-zeichen`: Die Führungsstelle erscheint als lesender Marker mit dem Zeichen
  „Befehlsstelle“.

## Impact

- **Backend:**
  - Migration `0176` mit den neuen Spalten.
  - Domänen- und Routenlogik: `src/einsatz/fuehrungsstelle.rs`, `src/routes/einsatz_fuehrungsstelle.rs`.
  - Neues `wire_enum!` für die Art, eingetragen in `src/api_doc.rs` und `tests/enum_wire_kontrakt.rs`.
  - Schwärzungsregister `src/einsatz/schwaerzung_registry.rs`.
  - Eingabegrenzen samt Spiegel.
  - Tests in `tests/einsatz_fuehrungsstelle.rs`.
- **API:** `GET`/`PATCH /api/einsaetze/:id/fuehrungsstelle` bekommen neue optionale Felder. Die
  Änderung ist rückwärtsverträglich.
- **Generiert:** `frontend/src/api/openapi.json` und `frontend/src/api/types.generated.ts`.
- **Frontend:**
  - Paneel und API-Patch: `pages/EinsatzdatenPage.tsx`, `api/types.ts`.
  - Stab: `stab/fuehrungsstelle.ts`, `stab/funkplan.ts`, `stab/fernmeldeskizze.ts` samt Layout und
    Element, `stab/checkliste.ts`, `stab/ChecklistePaneel.tsx`.
  - Organigramm: `pages/einsatzabschnitte/Organigramm.tsx`.
  - Lagekarte: `pages/lagekarte/*` (Marker, Ebene, Inspector, Objektsuche).
- **Tests:** Unit-Tests der genannten Module. e2e für Lagekarte und Paneel, außerdem die
  Doku-Bild-Skripte.
- **Doku:** Kapitel und Bilder unter `docs/anwender/`.
- **Abhängigkeiten:** keine neuen. Ortssuche und Ortsfeld (LFH-1248) setzen später auf.
