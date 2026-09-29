# Proposal

## Why

Die Lagekarte kennt Energieinfrastruktur bisher nur als Umspannwerke in der OSM-basierten
KRITIS-Ebene (LFH-69). LFH-81 sollte das um **amtliche** Anlagen aus dem
Marktstammdatenregister (MaStR) der Bundesnetzagentur ergänzen. Die Machbarkeitsprüfung
(21.09.2026, gegen den Live-Endpunkt gemessen) widerlegt dabei zwei Annahmen des Tickets:

- **MaStR veröffentlicht für konventionelle Großkraftwerke keine Koordinaten.** Bei den
  Einheiten über 50 MW sind 0 von 202 Erdgas-, 0 von 100 Kohle- und 0 von 25
  Mineralöl-Einheiten georeferenziert. Speicher, Solar, Wasser und Wind sind dagegen fast
  vollständig georeferenziert. Die Abdeckung hängt an der Anlagenart, nicht an der Größe.
- **Umspannwerke führt MaStR gar nicht.** Laut MaStR-Hilfe werden sie nicht registriert.
  In der Lagekarte stehen sie bereits als `power=substation` in der KRITIS-Ebene.

Eine reine MaStR-Ebene zeigte also genau die Anlagen nicht, die im Einsatz am meisten
zählen (Gas-, Kohle- und Heizkraftwerke). Entschieden ist deshalb (Rückfrage an den Nutzer,
21.09.2026) eine **hybride Fachebene „Energieanlagen“**:

- **OSM `power=plant`** liefert die Kraftwerksstandorte samt der konventionellen Anlagen.
- **MaStR** liefert die amtlich registrierten Großanlagen mit Koordinaten, und zwar ab
  **10 MW**.

## What Changes

- Neue Fachebene mit der Kennung **`energie`**:
  `GET /api/karte/fachebenen/energie?bbox=…`, bbox ist Pflicht. **Die Kennung weicht bewusst
  vom Ticketwortlaut ab** (dort `/mastr`): der Großteil der Standorte kommt aus OSM, und ein
  Name, der eine einzige amtliche Quelle behauptet, beschriebe die Ebene falsch.
- **OSM-Anteil:** `power=plant` im Kartenausschnitt, abgefragt über Overpass (dieselben
  Endpunkte wie KRITIS). Konventionelle Kraftwerke (Kohle, Braunkohle, Gas, Öl, Kern,
  Abfall) werden immer gezeigt. Erneuerbare Anlagen und Speicher nur mit getaggter Leistung
  ab 10 MW. Anlagen ohne Quellenangabe und ohne Leistung fallen weg. `power=generator` und
  `power=substation` gehören **nicht** dazu: das eine sind Einzelaggregate, das andere
  steht schon in KRITIS und würde doppelt eingezeichnet.
- **MaStR-Anteil:** ein bundesweiter Abzug aller Stromerzeugungseinheiten mit
  Nettonennleistung über 10 MW, mit Koordinaten und im Status „In Betrieb“ oder
  „Vorübergehend stillgelegt“. Gemessen sind das 1.267 Einheiten, ein Abruf dauert rund
  7 s. Der Abzug wird serverseitig einen Tag gecacht und je Anfrage lokal auf die bbox
  gefiltert.
- **Zusammenführung:** Liegt eine MaStR-Einheit nahe an einer OSM-Anlage gleicher
  Anlagenart, bekommt die OSM-Anlage die amtlichen Angaben (MaStR-Nummer, Leistung,
  Betreiber, Status) und die MaStR-Einheit wird nicht zusätzlich eingezeichnet. Alle
  übrigen MaStR-Einheiten erscheinen als eigene Punkte.
- **Quellennennung:** ODbL für OSM und „Datenlizenz Deutschland – Namensnennung – 2.0“ für
  die Bundesnetzagentur/MaStR. Genannt werden nur die Quellen, die in der Antwort
  tatsächlich Daten beitragen.
- **Frontend:** die Ebene in der Ebenenauswahl mit eigenem Layer, einem eigenen
  Inspector-Inhalt, gespeicherter Sichtbarkeit und dem üblichen Offline-Grau.
  Voraussetzung dafür: der **bbox-Pfad der Lagekarte wird verallgemeinert**. Heute bekommt
  nur KRITIS einen Kartenausschnitt, fest verdrahtet. Künftig bekommen ihn alle Ebenen, die
  in der Registry als `bboxAbhaengig` stehen. Ohne diese Änderung bliebe die neue Ebene bei
  ausgeschalteter KRITIS-Ebene still leer.

## Capabilities

### New Capabilities

- `lagekarte-fachebene-energie`: Die Fachebene „Energieanlagen“ auf der Lagekarte. Sie
  legt fest, welche Anlagen erscheinen (Rauschfilter), woher sie stammen, wie OSM- und
  MaStR-Angaben zusammengeführt werden, welche Quellen genannt werden und wie sich die
  Ebene verhält, wenn eine oder beide Quellen ausfallen.

### Modified Capabilities

- keine (`openspec/specs/` ist leer; die Bestands-Fachebenen haben noch keine Spec)

## Impact

- **Backend:** `src/karte/quellen.rs` (neuer Abschnitt ENERGIE),
  `src/karte/normalisierung.rs` (zwei Normalisierer und die Zusammenführung),
  `src/routes/karte.rs` (ein Match-Arm), `tests/karte.rs`. Keine neue Route, keine
  Migration, kein neuer OpenAPI-Typ und keine neue Abhängigkeit.
- **Frontend:** `api/fachebenen.ts`, `api/queryKeys.ts`, `pages/lagekarte/`
  (`fachebenen.ts`, `useFachebenen.ts`, `fachebenenAuswahl.ts`, `useKartenAnsicht.ts`,
  `FachebenenInspector.tsx`, `Kartenflaeche.tsx`, `Sidebar.tsx`),
  `pages/LagekartePage.tsx` sowie die zugehörigen Tests.
- **Extern:** ein neuer Upstream. Der MaStR-JSON-Endpunkt ist öffentlich, aber nicht
  offiziell dokumentiert (kein SLA, WAF davor). Er wird höchstens einmal am Tag angefragt.
- **Doku:** `docs/fachebenen-quellen.md` und `CHANGELOG.md`.
