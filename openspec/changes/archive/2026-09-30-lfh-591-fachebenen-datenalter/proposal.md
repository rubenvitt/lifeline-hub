# Proposal

## Why

Die Fachebenen liefern nach dem Stale-Serving-Prinzip (`karte::quellen::liefere_mit_swr`) einen
veralteten Cache-Eintrag bis zum Cache-Deckel von 48 h unverändert mit `status: "ok"` aus. Das
ist gewollt: ein alter Stand ist besser als eine leere Karte. Die Oberfläche sagt aber nirgends,
wie alt der ausgelieferte Stand ist. Seit LFH-77 trägt die Hochwasser-Ebene amtliche
Meldeklassen. „Großes Hochwasser“ kann damit zwei Tage alt sein, und die Führungskraft sieht es
der Karte nicht an. Eine solche Aussage darf in der Lage nicht geraten werden (LFH-591, Befund
aus dem Review zu LFH-77).

## What Changes

- Der Fachebenen-Umschlag bekommt das Feld **`abgerufen`**: den Zeitpunkt (RFC 3339, UTC), zu
  dem das System den ausgelieferten Stand bei der Quelle geholt hat. Das Feld steht bei jeder
  Antwort mit Daten (`ok`, `leer`) und fehlt bei `offline`. Es gilt für alle neun Quellen,
  auch für einen Stand aus dem Cache.
- `stand` bleibt, was es heute schon bei KRITIS, Energie und Luftqualität ist: der
  Datenstand **der Quelle** (Extrakt-Datum, MaStR-Abzug, jüngster Messzeitpunkt). Das Ticket
  schlug vor, `stand` mit dem Abrufzeitpunkt zu füllen. Das kollidiert mit der bestehenden
  KRITIS-Anforderung („`stand` MUST den Datenstand des Extrakts nennen“) und mit zwei weiteren
  Quellen. Deshalb gibt es ein eigenes Feld.
- Jede Fachebene erhält in der Registry eine **Veraltungsschwelle**, abgeleitet aus dem
  Erneuerungstakt ihrer Quelle (Tabelle in `design.md`, D3, und in
  `docs/fachebenen-quellen.md`).
- Die Fachebenen-Zeile im Kartenpanel zeigt für jede sichtbare Ebene mit Daten ihren
  Abrufzeitpunkt in taktischer Form („Stand 1430“, an einem Vortag „Stand 291430“). Jenseits
  der Schwelle steht zusätzlich das Wort **„veraltet“** mit dem Zeichen ⧖ in der Achtung-Farbe.
  Das Wort ist der zweite Kanal neben der Farbe (WCAG 1.4.1). Die Anzeige altert ohne neuen
  Abruf mit, im Minutentakt.
- Der Inspector einer angewählten Fachebenen-Einheit nennt denselben Abrufzeitpunkt als volle
  DTG und gegebenenfalls „veraltet“.
- **Kein neuer `FachebeneStatus`.** Eine veraltete Ebene bleibt `ok`. Poll-Takt, Attribution
  und Ausgrauen hängen weiter an den drei bestehenden Zuständen.
- Der Stale-Serving-Vertrag bleibt: eine unerreichbare Quelle liefert weiter HTTP 200 mit dem
  letzten bekannten Stand, nie einen 5xx.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lagekarte-fachebenen`: neue Anforderungen zum Abrufzeitpunkt im Umschlag, zur sichtbaren
  Altersangabe je Ebene und zur Veraltungsschwelle mit zweitem Kanal. Die bestehende
  KRITIS-Anforderung an `stand` bleibt unverändert.

## Impact

- **Backend:** `src/karte/typen.rs` (`FachebeneAntwort.abgerufen`, Konstruktoren),
  `src/karte/cache.rs` (Rückfall für Einträge ohne das Feld über `gespeichert_at`),
  `src/karte/quellen.rs` (Energie: älterer beitragender Teil), `src/karte/kritis/bestand.rs`
  (letzter gelungener Abgleich). Keine Migration: das Feld reist im gespeicherten JSON mit.
- **Typ-Codegen:** `frontend/src/api/openapi.json` und `types.generated.ts` neu erzeugen
  (`scripts/check-typ-codegen.sh`).
- **Frontend:** `pages/lagekarte/fachebenen.ts` (Schwelle je Ebene, reine Einstufung),
  `pages/lagekarte/useFachebenen.ts` (Abrufzeitpunkt je Ebene), `pages/lagekarte/Sidebar.tsx`
  (Zeile), `pages/lagekarte/FachebenenInspector.tsx` (Zeile). Keine neue Statuskarte in
  `theme/statusFarben.ts` (siehe design.md, D5).
- **Doku:** `docs/fachebenen-quellen.md` (Umschlag, Schwellen-Tabelle, Offline-Absatz).
- **API:** additiv. Ältere Clients ignorieren das neue Feld.
