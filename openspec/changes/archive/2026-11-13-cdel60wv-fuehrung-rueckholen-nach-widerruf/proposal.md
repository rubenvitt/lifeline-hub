# Proposal

## Why

Wird eine Org-Zuordnung widerrufen, während der Schalter `LIFELINE_FUEHRUNG` aus ist, ändert der
Widerruf seit LLH-1704 keine Akte mehr. Das ist richtig, weil die Führung ohne Schalter
eingefroren ist (ADR-0021). Nach dem Wiedereinschalten bleibt so ein Einsatz aber gesperrter
Spiegel einer beendeten Kopplung, und niemand kommt an ihn heran: Das Paneel „Führung“ bietet
nichts an, und die Notübernahme antwortet 409 „Die führende Instanz ist nicht mehr gekoppelt.“
Der einzige Ausweg ist heute, die Org erneut mit derselben Installation zu koppeln. Genau diese
Lage („gesperrt, ohne dass ihn jemand übergeben oder zurückholen kann“) sollte das Rückholen beim
Widerruf verhindern (Zunder LLH-1850).

## What Changes

- Neue Bedienung **„Führung zurückholen“** im Paneel „Führung“ eines Spiegels, dessen Akte eine
  Installation als Führer nennt, zu der die Org nur noch beendete Zuordnungen einer
  Standardkopplung hat. Ein Mensch gibt einen Grund an; danach führt diese Installation den
  Einsatz mit der nächsten Epoche, und er ist wieder schreibbar.
- Der Vollzug folgt dem Rückholen beim Widerruf (Art „Notübernahme“, Erklärung ohne Beweis gegen
  die alte Führung, damit eine dritte meldende Seite die Übernahme ohne Alarm offen hält). Dazu
  kommen der Grund des Menschen, sein Name im Verlauf und ein Eintrag in der Admin-Spur.
  Bruchstelle ist der Widerruf der Zuordnung, über die der Einsatz gespiegelt wurde.
- Bedienen dürfen Einsatzleitung und Admin der Einsatz-Org, in beide Richtungen ohne Unterschrift
  oder Code, weil die alte Führung nichts mehr prüfen kann.
- Das Hinweisband des Spiegels nennt die beendete Kopplung („Kopplung zu … beendet“) und führt
  zum Paneel „Führung“.
- Ohne Handlung eines Menschen bleibt der Einsatz Spiegel; beim Start oder Einschalten gibt sich
  nichts selbst frei.
- Neue Route `POST /api/einsaetze/{id}/fuehrung/zurueckholen`; neue Felder in
  `FuehrungAnzeige` (Zeitpunkt des Widerrufs der alten Führung) und `EinsatzFuehrung` (die
  Führung ist nicht mehr gekoppelt). Additiv, nichts bricht.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `instanz-fuehrung`: neue Anforderung „Einen Spiegel ohne gekoppelte Führung holt ein Mensch
  zurück“; die Anforderung „Wer die Führung bedient“ gilt dafür unverändert.

## Impact

- Backend: `src/instanz/fuehrung/repo.rs` (beendete Führung finden), `src/instanz/fuehrung/dienst.rs`
  (Vollzug, Anzeige), `src/routes/fuehrung.rs` und `src/app.rs` (Route, Admin-Spur),
  `src/einsatz/repo.rs` und `src/instanz/fuehrung/mod.rs` (Kopf), OpenAPI und
  Typ-Codegen.
- Frontend: `frontend/src/instanz/` (Paneel, Texte, API), `frontend/src/einsatz/spiegel/SpiegelBand.tsx`,
  `frontend/src/api/fuehrung.ts`, generierte Typen.
- Doku: Anwenderkapitel `docs/anwender/kapitel/instanzkopplung.md` (Abschnitt „Widerruf“), neue
  ADR-0040 (Entscheidung E1), Verweis in `src/instanz/fuehrung/repo.rs` auf LLH-1850 nachziehen.
- Keine Migration: Alles Nötige steht schon in `instanz_kopplung_org` und `einsatz_fuehrung`.
