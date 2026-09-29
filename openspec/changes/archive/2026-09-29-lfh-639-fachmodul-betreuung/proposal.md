# Proposal

## Why

Das Lage-Dashboard des Neuentwurfs (S3) zeigt „Evakuiert 1 320 · von 1 850 geplant“. Heute
gibt es dafür keine Datenquelle: `PersonStatus` kennt kein „evakuiert“, eine Plangröße
existiert nicht, und `einsatz.anzahl_betroffene_initial` ist die Erstmeldung. Der
Auftraggeber hat am 22.09.2026 entschieden, den Stand nicht als losen Zähler am Einsatz zu
führen, sondern aus einem Betreuungsmodul (LFH-607 → LFH-639). Parallel braucht die
Verpflegung (LFH-634) eine Kopfzahl „in Betreuung“ mit Zeitbezug. Die kann nur ein Modul
liefern, das Betreuungsstellen und ihre Belegung kennt.

Evakuierte sind überwiegend **nicht einzeln** erfasst (Entwurf: 248 namentlich Betroffene
neben 1 320 Evakuierten). Das Modul führt deshalb **Mengen**, keine Personen.

## What Changes

- Neues Fachmodul **Betreuung** (Modul-Key `betreuung`, Kategorie Erfassung nach
  Unfallhilfsstellen, Route `/einsaetze/:einsatzId/betreuung`). Backend und Frontend sind
  vollständig, mit eigenem Live-Ereignis `betreuung`.
- **Evakuierungsbezirk** (Begriff nach IMK-Rahmenempfehlung Evakuierungsplanung): Bezeichnung,
  optionaler Einsatzabschnitt, **Plangröße (Pflicht, ≥ 1)** mit Erhebungsart
  gezählt/geschätzt, Sammelstelle, **Räumungszustand** angeordnet / läuft / geräumt /
  aufgehoben. Die Anlage ist eine ETB-Entscheidung, ebenso jede Änderung der Plangröße.
- **Stand „evakuiert“ je Bezirk** als append-only Reihe **absoluter** Meldungen (Anzahl,
  gezählt/geschätzt, Zeitpunkt). Jede Meldung schreibt in derselben Transaktion einen
  ETB-Eintrag „Bezirk X: 820 evakuiert (vorher 640, gezählt) · Plan 1 850“. Eine Meldung
  lässt sich zurücknehmen (ETB-Berichtigung, Rückgängig-Toast). N > M ist erlaubt.
- **Betreuungsstelle** mit Art (Anlaufstelle, Betreuungsstelle, Betreuungsplatz,
  Notunterkunft), optionaler Kapazität in Personen, Status vorbereitet / in Betrieb /
  geschlossen und einer append-only **Belegungsreihe** (Anzahl, Zeitpunkt). Jede
  Belegungsmeldung schreibt einen ETB-Eintrag.
- **Kopfzahl „in Betreuung“ zu einem Zeitpunkt** als eigener Lese-Endpunkt: je Stelle die
  jüngste Belegung bis zu diesem Zeitpunkt, dazu die Summe, ohne Personenbezug. Das ist der
  Vertrag für LFH-634.
- **Kennzahl-Ableitung „Evakuiert N · von M geplant“** als reine, getestete
  Frontend-Funktion. Sie ergibt keine Kennzahl, solange kein aktiver Bezirk existiert.
  Einbau und Platz im Lage-Dashboard übernehmen LFH-640 und LFH-607; LFH-639 stellt nur die
  Lückenvermerke richtig.
- Modulzähler, Codegen, Schwärzungsregeln, Statusfarben-Verträge, Registry-, Rechte- und
  Deeplink-Einträge.
- **Prüfliste Einsatztauglichkeit** (15 Kriterien) für die neue Seite.

Nicht Teil dieses Changes: Lagekarte (Marker, Bezirk als Fläche), Verknüpfung
Person → Betreuungsstelle, Offline-Erfassung, Zuordnung Bezirk → aufnehmende Stelle und die
Registrierung einzelner Personen (Personenauskunft). Die Grenzen stehen in `design.md`.

## Capabilities

### New Capabilities

- `betreuung-evakuierung`: Evakuierungsbezirke mit Plangröße, Räumungszustand und
  Standreihe „evakuiert“. Betreuungsstellen mit Kapazität und Belegungsreihe. Die Kopfzahl
  „in Betreuung“ zu einem Zeitpunkt, die Kennzahl-Ableitung für das Lage-Dashboard,
  ETB-Nachweis, Live-Verteilung und Rechte.

### Modified Capabilities

(keine: `lagekarte-fachebenen` ist nicht berührt)

## Impact

- **Datenbank:** neue Migration `0117_betreuung.sql` (vor dem Anlegen gegen `origin/alpha`
  prüfen) mit vier neuen Tabellen, ohne Änderung an Bestandstabellen.
- **Backend:** neues Modul `src/betreuung/` und neue Routen in `src/routes/betreuung.rs`.
  Berührt werden außerdem `src/einsatz/modul.rs`, `src/live/mod.rs`,
  `src/einsatz/schwaerzung_registry.rs`, `src/api_doc.rs`, `src/app.rs` und `src/lib.rs`.
- **API:** neue Endpunkte unter `/api/einsaetze/{id}/betreuung`. Bestehende Endpunkte
  bleiben unverändert.
- **Frontend:** neue Seite und API-Client. Berührt werden `modulRegistry.ts`, `App.tsx`,
  `deeplinks.ts`, `queryKeys.ts`, `useModulZaehler.ts` und `theme/statusFarben.ts`, dazu
  die generierten Typen und die Lückenvermerke in `lage-dashboard/`.
- **Tests und Guards:** `tests/modul_override.rs`, `tests/einsatz_kontext_guard.rs`,
  `tests/enum_wire_kontrakt.rs`, `liveEvent.contract.test.ts`, die Guards in `queryKeys`,
  `statusFarben.test.ts`, `modulRegistry.test.ts`, `sprungmarken.test.ts` und die
  e2e-Routen in Gate 1 und Gate 3.
- **Parallelarbeit:** LFH-634 (Verpflegung) berührt dieselben Längenpins und dieselbe
  Migrationsnummer. Wer als Zweiter mergt, zieht nach.
