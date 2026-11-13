---
id: ADR-0039
titel: Ein Spiegel nimmt Lieferungen nur über eine Zuordnung seiner eigenen Org an
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/instanz/spiegel/uebernehmen.rs
herleitung:
  - openspec/changes/archive/2026-11-13-d86po4bc-spiegel-nur-gleiche-org/design.md
---

# ADR-0039: Ein Spiegel nimmt Lieferungen nur über eine Zuordnung seiner eigenen Org an

## Regeln

- MUST: Bevor eine Lieferung an einen vorhandenen Spiegel etwas umhängt oder schreibt, vergleicht
  `spiegel::uebernehmen::uebernehmen` die Org des Einsatzes mit der Org der liefernden Zuordnung
  (`Empfaenger::org_id`); weichen sie ab, wird die Lieferung verworfen.
- MUST NOT: Eine Lieferung ändert nie die Org eines vorhandenen Spiegels und hängt ihn nie an
  eine Zuordnung einer anderen Org, auch nicht nach Widerruf und Neuzuordnung derselben Gegen-Org.
- MUST: Eine so verworfene Lieferung nennt dem Absender den Stand am Ende der Lieferung und keine
  `einsatz_id`; der Grund steht nur im Log, nie am Spiegel der bisherigen Org.

## Prüfung

```sh
verlange 'if org != e\.org_id' src/instanz/spiegel/uebernehmen.rs
verlange 'fn eine_zuordnung_einer_anderen_org_haengt_den_spiegel_nicht_um' src/instanz/spiegel/tests.rs
verlange 'fn neue_zuordnung_an_eine_andere_org_laesst_den_spiegel_bei_seiner_org' tests/instanz_spiegel.rs
```

## Kontext

Eine Org-Zuordnung lässt sich widerrufen und dieselbe Gegen-Org danach über dieselbe Kopplung
einer anderen Org zuordnen. Der beendete Spiegel hing sich dann an die neue Zuordnung, der Kopf
setzte die neue Org, und Mitgliedschaften der alten Org blieben stehen: Konten der einen Org
lasen einen Einsatz der anderen (LLH-1851). Mandantentrennung hängt an `einsatz.org_id` und der
Mitgliedschaft, deshalb muss ein Spiegel dieselbe Org behalten, solange er besteht.

## Konsequenzen

Die bisherige Org behält ihren beendeten, lesbaren Spiegel, wie nach jedem Widerruf. Die neue Org
bekommt diesen einen Einsatz nicht; neue Einsätze des Gegenübers kommen bei ihr normal an. Einen
eigenen Spiegel je Org für denselben Einsatz gibt es nicht (verworfen in design.md D4). Ein Hub,
der schon im falschen Zustand ist, wird nicht repariert.
