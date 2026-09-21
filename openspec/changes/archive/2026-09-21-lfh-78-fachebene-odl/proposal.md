# Proposal

## Why

Bei CBRN- und kerntechnischen Lagen (Reaktorereignis, radiologischer Notfall,
„Dirty Bomb") fehlt der Führung auf der Lagekarte bislang ein flächiges Bild der
Gamma-Ortsdosisleistung (ODL). Das Bundesamt für Strahlenschutz (BfS) betreibt dafür ein
bundesweites Messnetz mit rund 1 700 ortsfesten Sonden und stellt die aktuellen
Stundenwerte frei zur Verfügung (LFH-78). Die Lagekarte hat mit den Fachebenen
(LFH-69, zuletzt LFH-77/LFH-80) bereits den Unterbau, um solche Quellen anzubinden.

## What Changes

- Neue Fachebene **„Strahlung / ODL (BfS)"** auf der Lagekarte: jede Sonde als Punkt mit
  aktuellem Stundenwert (µSv/h), Messzeitraum und Betriebsstatus.
- Das Backend holt die Sonden aus dem dokumentierten BfS-WFS-Layer
  `opendata:odlinfo_odl_1h_latest` und liefert sie über den bestehenden Aggregator
  `GET /api/karte/fachebenen/odl` im einheitlichen Umschlag aus — mit demselben
  Offline- und Cache-Verhalten wie die übrigen Quellen.
- **Bewertung „erhöht" als Projekt-Einteilung, nicht als BfS-Schwelle.** Das BfS
  veröffentlicht keinen absoluten Schwellenwert, sondern nennt 0,05–0,2 µSv/h als
  natürlichen Bereich in Deutschland und „Besorgnis" erst ab Faktor 3 über dem Standort.
  Entschieden (Rückfrage an den Menschen, 21.09.2026): absolute Bänder —
  bis 0,2 µSv/h *im natürlichen Bereich*, darüber *über natürlichem Bereich*, über
  0,6 µSv/h (3 × Obergrenze) *stark erhöht*. Sonden ohne Messwert (defekt, Testbetrieb)
  bleiben sichtbar und tragen eine eigene neutrale Stufe. Oberfläche und Doku sagen
  ausdrücklich, dass die Einteilung vom Projekt stammt.
- Die Stufe wird doppelt kodiert (Farbe aus dem Statusfarb-Vertrag + Punktdurchmesser),
  das Wort und der Zahlenwert stehen im Inspector.
- Die Sichtbarkeit der Ebene wird wie bei den übrigen Fachebenen je Einsatz/Ansicht
  gespeichert; ein älterer gespeicherter Stand ohne den neuen Schlüssel liest sich als
  „aus".
- Lizenz und Attribution (GeoNutzV / Datenlizenz Deutschland – Namensnennung 2.0,
  Quellennennung „Bundesamt für Strahlenschutz (BfS)") werden in
  `docs/fachebenen-quellen.md` dokumentiert, samt der gemessenen Eigenschaften der Quelle.
- Ausdrücklich **nicht** Teil dieser Änderung: ein standortbezogener Grundpegel je Sonde
  (die BfS-Zeitreihen liefern gemessen nur eine Sonde je Abruf) — als Folgeticket
  festzuhalten.

## Capabilities

### New Capabilities
- `lagekarte-fachebenen`: Externe Lagedaten-Ebenen der Lagekarte. Diese Änderung legt die
  Capability mit der ODL-Ebene an (Abruf, Bewertung, Darstellung, Offline-Verhalten,
  Quellennennung, Persistenz der Sichtbarkeit); weitere Fachebenen können später
  hinzukommen.

### Modified Capabilities
<!-- keine — openspec/specs/ trägt noch keine Capability -->

## Impact

- **Backend:** `src/karte/quellen.rs` (Abruf mit Cache), `src/karte/normalisierung.rs`
  (Normalisierung + Stufenbildung), `src/routes/karte.rs` (neuer `match`-Arm),
  `tests/karte.rs` (Route-Test). Keine neue Abhängigkeit, keine Migration.
- **Frontend:** `api/fachebenen.ts` (Quellen-Union, Stufen-Typ), `theme/statusFarben.ts`
  (17. Vertragskarte), neues `pages/lagekarte/odlStil.ts`, `fachebenen.ts`,
  `fachebenenAuswahl.ts`, `fachebenenLayer.ts`, `useFachebenen.ts`,
  `useKartenAnsicht.ts`, `FachebenenInspector.tsx`, `api/queryKeys.ts` (Kommentar) samt
  Tests.
- **Doku:** `docs/fachebenen-quellen.md`.
- **Extern:** ein zusätzlicher Abruf beim BfS-GeoServer je Cache-Refresh (~890 KB,
  ~1 s gemessen), nicht je Nutzeranfrage.
