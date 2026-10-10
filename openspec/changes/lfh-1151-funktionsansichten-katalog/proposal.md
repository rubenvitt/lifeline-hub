# Proposal

## Why

Die Spec `funktionsansichten` beschreibt noch den Stand von LFH-892: drei Ansichten
(`uhs-tablet`, `uhs-laptop`, `lagemonitor`). Der Code kennt seit LFH-1041 bis LFH-1044 sieben
(`Funktionsansicht` in `src/geraet/mod.rs`). Das Szenario „Unbekannte Ansicht“ erwartet sogar
400 für `betreuungsstelle`, eine heute gültige Ansicht. Für Betreuungsstelle und
Einsatzabschnitt fehlen die Anforderungen ganz, obwohl Server, Hülle und Tests stehen.
Aufgefallen beim Nachklicken für die Anwenderdoku (LFH-1127, Befund in LFH-1151).

## What Changes

- **Katalog:** Die Anforderung „Katalog der Funktionsansichten“ nennt alle sieben Ansichten
  samt Stellenbindung je Ansicht. Das Beispiel für einen unbekannten Wert ist ein Wert, den es
  nicht gibt.
- **Scope-Matrix:** Die Einleitung sagt, dass die Tabelle die drei Ansichten aus LFH-892 regelt
  und die übrigen je eine eigene Anforderung haben. Die Tabelle bekommt die Zeile für die
  Kräfte der eigenen UHS am Laptop (LFH-1045). Die Lagemonitor-Zeile bleibt das Soll; der Code
  zieht in LFH-1296 nach.
- **Stellenbindung:** Die Anforderung bleibt für die UHS-Ansichten wörtlich; ein Satz verweist
  für die übrigen Stellenarten auf deren Anforderungen.
- **Neu: Ansicht Betreuungsstelle** (LFH-1041) mit Rechtetabelle und Szenarien, im Stil der
  bestehenden Anforderungen „Ansicht Bereitstellungsraum“ und „Ansicht Verpflegung“.
- **Neu: Ansicht Einsatzabschnitt** (LFH-1043), ebenso.
- **Kein Verhalten ändert sich.** Die Spec folgt dem Code; jede neue Aussage ist an Code und
  Test belegt. Wo Code und Spec auseinanderliegen und der Code falsch scheint, wird ein Ticket
  daraus, die Spec bleibt am Ist-Stand.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `funktionsansichten`: Katalog auf sieben Ansichten, Szenario „Unbekannte Ansicht“ mit
  ungültigem Wert, Scope-Matrix und Stellenbindung auf die drei LFH-892-Ansichten eingegrenzt,
  neue Anforderungen „Ansicht Betreuungsstelle“ und „Ansicht Einsatzabschnitt“.

## Impact

- Nur `openspec/specs/funktionsansichten/spec.md` (über Sync beim Archivieren). Kein Code,
  keine Migration, keine API.
- `frontend/src/geraet/AGENTS.md` nennt die Spec bereits als Quelle; der Verweis bleibt gültig.
