# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/bq8dvx19e6sl5u8l9zycb8pa (LLH-1924, Folge von LLH-1722)

## Why

LLH-1722 hat das Lösen über alle Module vereinheitlicht (Spec `bedien-muster`), aber Lücken
offen gelassen, die in `frontend/AGENTS.md` und in der Spec als „Bekannte Lücke“ stehen:

- Das Rückgängig von Material am Ort, von „Vom Fahrzeug lösen“ und von UHS-„Abziehen“ bucht
  blind zurück. Steht der Datensatz inzwischen woanders, nimmt es ihn dort still weg.
- „Austragen“ am Bereitstellungsraum und an der Person in der UHS hat gar kein Rückgängig.
  Wer sich vertippt, muss neu eintragen. Dann beginnen „seit“ und „wartet seit“ neu, und an der
  UHS rutscht ein Patient in der Dringlichkeit nach hinten. Ein Platz, der durch das Austragen
  auf Aufbereitung ging, nimmt ihn nicht mehr an.
- UHS-„Abziehen“ und „Vom Fahrzeug lösen“ in der Fahrzeugliste halten die gelöste Zeile nicht.
  Ein schneller zweiter Tipp trifft die nachrückende Zeile. In der Fahrzeugliste schickt er
  sogar denselben DELETE noch einmal.
- Material am Ort zeigt „Lösen“ als Knopf neben „Ausgeben“. Die Regel will es dann im ⋮.

## What Changes

- **Rückgängig nur, wenn frei:** Die Rückwege von Material am Ort (`PATCH …/material/{id}`),
  Besatzung (`PUT …/fahrzeuge/{ef}/besatzung/{ep}`) und UHS-Kraft
  (`PUT …/uhs/{uid}/kraefte/{ep}`) nehmen `?nur_wenn_frei=1` an, wie die Einheit-Routen seit
  LLH-1722. Steht der Datensatz inzwischen an einem anderen Ort, auf einem anderen Fahrzeug
  oder an einer anderen UHS, lehnt der Server mit 409 ab und nennt diesen Ort. Ohne Schalter
  verschieben die Routen weiter wie bisher (bewusstes Zuordnen).
- **Austragen zurücknehmen, lückenlos:** Zwei neue Routen nehmen einen Austritt zurück, am
  Bereitstellungsraum und an der Person in der UHS. Die Rücknahme ist ein neues Ereignis
  (beide Reihen bleiben nur anhängend), das auf den Austritt verweist. Das gilt nur, solange der
  Austritt das jüngste Ereignis der Kraft bzw. Person ist und höchstens zehn Minuten alt. „Seit“,
  die längste Wartezeit und „wartet seit“ übergehen das Paar aus Austritt und Rücknahme. Die
  Person kehrt auf ihren Platz zurück, wenn er noch frei oder nur in Aufbereitung ist, sonst in
  den Wartebereich. Das gilt auch für „zurückweisen“ im Grundriss. „Ausrücken“ bleibt ohne
  Rückgängig.
- **Gehaltene Zeile** in UHS-Kräften und im Besatzungsblock der Fahrzeugliste: „Gelöst“ träge an
  der Stelle des Knopfs, „Rückgängig“ an der Stelle von Funktion bzw. Position, Sperre je Zeile.
- **Material am Ort:** Bietet eine Zeile „Ausgeben“, steht „Lösen“ in ihrem ⋮. „Ausgeben“
  bleibt Knopf.
- Die Lücken verschwinden aus `frontend/AGENTS.md` und aus der Spec `bedien-muster`.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `bedien-muster`: Die Szenarien „Bekannte Lücke …“ für Material am Ort sowie für Abziehen und
  Besatzung entfallen. Neu: Rückgängig einer gelösten Zuordnung nimmt nichts woanders weg, für
  alle Rückwege einschließlich Besatzung und UHS-Kraft. Die gehaltene Zeile gilt auch an der UHS
  und im Besatzungsblock der Fahrzeugliste. „Austragen“ hat ein Rückgängig, das den Zustand
  davor herstellt.
- `material-am-ort`: Lösen steht im ⋮, wenn die Zeile „Ausgeben“ anbietet. Das Rückgängig lehnt
  ab, wenn der Posten inzwischen an einem anderen Ort liegt.
- `bereitstellungsraum-belegung`: Austragen zurücknehmen (Route, Riegel, ETB, Oberfläche).
  „Seit“ und Kennzahlen übergehen ein Paar aus Austritt und Rücknahme. Der Verlauf zeigt die
  Rücknahme.
- `personen-detail`: „Austragen“ zeigt ein Rückgängig, das die Person mit Platz und Wartezeit
  zurückbringt.
- `uhs-grundriss`: „zurückweisen“ zeigt dasselbe Rückgängig.

## Impact

- **Backend:** `src/routes/einsatz_material.rs`, `src/routes/einsatz_fahrzeug.rs`,
  `src/fahrzeug/besatzung_repo.rs`, `src/routes/einsatz_uhs_kraefte.rs`,
  `src/routes/einsatz_bereitstellungsraum.rs`, `src/bereitstellungsraum/belegung_repo.rs`,
  `src/routes/einsatz_uhs.rs`, `src/uhs/belegung_repo.rs`, `src/app.rs` (zwei Routen),
  `src/geraet/mod.rs` (Routen der Geräte), eine Migration (Spalte `ruecknahme_von` an
  `br_belegung` und `person_uhs_belegung`), Antwort-DTOs mit dem neuen Feld (Typ-Codegen).
- **Frontend:** `api/einsatzMaterial.ts`, `api/einsatzFahrzeuge.ts`, `api/einsatzUhs.ts`,
  `api/einsatzBereitstellungsraum.ts`, `kraefte/MaterialAmOrt.tsx`, `kraefte/useMaterialOrt.ts`,
  `pages/einheit/FahrzeugeBesatzung.tsx`, `pages/FahrzeugePage.tsx`, `pages/uhs/UhsKraefte.tsx`,
  `pages/bereitstellungsraum/BrDetailPage.tsx`, `pages/PersonenDetailPage.tsx`,
  `pages/uhs/Grundriss.tsx`, `pages/uhs/dringlichkeit.ts` (`wartetSeit`).
- **Regeln und Doku:** `frontend/AGENTS.md` („Beenden: Verb, Ort und Sicherung je Art“),
  Anwenderdoku (`fahrzeuge.md`, `geraet-uhs.md`, `bereitstellungsraeume.md`, Personen/UHS).
- **e2e:** `material-am-ort.spec.ts` und `trefflaeche-pruefflaechen.spec.ts` (C15) ziehen am
  Umbau von Ausgeben und Lösen mit.
