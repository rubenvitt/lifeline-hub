# Proposal

## Why

Für die Übergabe an Behörden und Versicherer braucht die Einsatzleitung die Listen der
Erfassungsmodule auf Papier bzw. als PDF: Betroffene mit Sichtung, Tiere und Schäden. LFH-22
hat nur das Einsatztagebuch druckbar gemacht (Epic LFH-60). Wer heute eine Betroffenenliste
übergeben will, hat keinen sauberen Weg: Ein Bildschirmdruck enthält den App-Rahmen und nur
das geladene Fenster. Den CSV-Export gibt es nur serverseitig, ohne Knopf. Ein Ausdruck mit
Namen und Sichtung verlässt das System außerdem wie ein Export. Beim CSV-Export ist das
protokolliert (`person_zugriff_audit`, Art `export`), beim Druck bisher nicht.

## What Changes

- **Druckansicht je Modul** nach dem ETB-Muster (`etb-druck`): eigene Route
  `/einsaetze/:id/{personen|tiere|schaeden}/druck` mit Druckwurzel, Druckkopf, vollständiger
  Auswahl als schlichter Tabelle (aufsteigend nach Registriernummer), Stand als Schnappschuss,
  „Neu laden“ und „Zurück“.
- **Einstieg** auf jeder der drei Listen: ein sekundärer Knopf „Drucken / als PDF“ im Kopf, der
  den gerade aktiven Seitenfilter in die Adresse der Druckansicht mitnimmt (Personen: Status
  und „nur offene Felder“; Tiere: Statussicht und Spezies; Schäden: Statussicht). Der Druckkopf
  nennt die Auswahl in Worten.
- **Protokollierter Personendruck:** Ein neuer Endpunkt `GET /api/einsaetze/{id}/personen/druck`
  liefert die Personenliste und schreibt dabei genau eine Zeile in `person_zugriff_audit` mit
  der neuen Art **`druck`** (Entscheidung des Product Owners vom 01.10.2026). Die
  Personen-Druckansicht lädt ausschließlich darüber. Tiere und Schäden drucken über ihre
  bestehenden Listen, ohne Protokoll, wie beim Tier-CSV.
- **Migration 0132** baut `person_zugriff_audit` mit erweiterter CHECK-Bedingung
  `art IN ('detail','export','druck')` neu auf. Die Zeilen bleiben erhalten, ebenso die ids und
  die AUTOINCREMENT-Folge. `ZugriffArt` bekommt `Druck`, Codegen und Wire-Kontrakt ziehen nach.
- Rechte wie bei der jeweiligen Liste: Wer die Liste lesen darf, darf drucken. Ein gesperrtes
  Modul zeigt in der Druckansicht „kein Zugriff“ und bietet kein Drucken an.

## Capabilities

### New Capabilities

- `modul-listen-druck`: Papier- und PDF-Ausgabe der Erfassungslisten Personen, Tiere und
  Schäden: Einstieg mit Filter, vollständige Auswahl, Kopf und Ordnung, Rechte. Dazu die
  Protokollpflicht beim Personendruck.

### Modified Capabilities

(keine — `etb-druck` und `druck-dokumente` bleiben unverändert; die Druckmechanik aus
`druck-dokumente` wird nur genutzt)

## Impact

- **Backend:** `src/routes/einsatz_person.rs` (Handler `druck`), `src/app.rs` (Route),
  `src/person/audit_repo.rs` (`ZugriffArt::Druck`), `migrations/0132_…sql`, `src/api_doc.rs`,
  `tests/einsatz_person.rs`, `tests/enum_wire_kontrakt.rs`.
- **Codegen:** `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- **Frontend:** drei Druckseiten und -tabellen, ein gemeinsamer Seitenrahmen für Listen-Druck,
  Pfadbauer und Parser in `routing/deeplinks.ts`, drei nicht-live Query-Keys, Routen in
  `App.tsx`, Einstiegsknöpfe in `PersonenPage`, `TierePage` und `SchaedenPage`.
- **Regeln:** `frontend/src/druck/AGENTS.md` bekommt den Block „Modul-Listen-Druck“, darunter
  die Regel, dass der Personendruck nur über den protokollierenden Endpunkt lädt.
- Keine neue Abhängigkeit. Offline-Lagebild: Die Druck-Keys bleiben bewusst draußen, wie beim
  ETB-Druck.
