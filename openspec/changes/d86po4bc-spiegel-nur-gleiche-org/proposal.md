# Proposal

## Why

Wird eine Org-Zuordnung widerrufen und dieselbe Org des Gegenübers danach über dieselbe Kopplung
einer **anderen** lokalen Org zugeordnet, hängt sich ein beendeter Spiegel beim nächsten Abgleich
an die neue Zuordnung. Der neu gelieferte Kopf setzt dabei `einsatz.org_id` auf die neue Org, die
Mitgliedschaften der bisherigen Org bleiben stehen. Nachgestellt (LLH-1851, Test in
`tests/instanz_spiegel.rs`): Ein Konto der Org X liest danach einen Einsatz der Org Y und sieht ihn
in seiner Liste, Org Y sieht den Stand aus der Zeit der Org X. Die Mandantentrennung (LFH-115) ist
für diesen Einsatz aufgehoben.

## What Changes

- Ein vorhandener Spiegel hängt sich nur noch an eine Zuordnung **derselben lokalen Org** wieder
  an: Die Org des Einsatzes muss der Org der liefernden Zuordnung gleichen.
- Gleicht sie nicht, wird die Lieferung verworfen. Der Spiegel bleibt, wie er ist: beendet,
  lesbar und geschützt für seine Org. Der Grund steht im Log der empfangenden Instanz.
- Die empfangende Seite meldet für diesen Einsatz Stand 0: Über die neue Zuordnung ist nichts
  übernommen. Der Absender liefert ihn deshalb bis zu seinem Abschluss in jedem Abgleich neu, wie
  heute schon bei einer Lieferung über eine andere Kopplung (design.md D2, nach dem Review
  geändert).
- Keine Reparatur bestehender Daten: Ein Hub, der schon in diesem Zustand ist, bleibt, wie er ist
  (abgestimmt am 13.11.2026).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `einsatz-spiegel`: Die Anforderung „Widerruf beendet den Abgleich, nicht den Spiegel“ legt fest,
  dass ein beendeter Spiegel bei einer neuen Zuordnung nur derselben Org wieder auflebt und für
  eine andere Org nicht umzieht.

## Impact

- Backend: `src/instanz/spiegel/uebernehmen.rs` (Zweig „Neu zugeordnet oder neu gekoppelt“ in
  `uebernehmen`).
- Tests: `tests/instanz_spiegel.rs` (die Nachstellung wird zum Beleg, dazu der Fall „wieder
  dieselbe Org“).
- Kein Schema, keine Migration, kein Protokollwechsel, keine Oberfläche.
