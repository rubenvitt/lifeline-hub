# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/m113c8lnw4sm66dlgnhcpwuu (LLH-1809, Teil von LLH-1724)

## Why

Heute laufen drei Abstandsskalen nebeneinander:
- die Dichte-Staffel 3/7/11/18 (kompakt), die antd als `padding*`/`margin*` übernimmt;
- antds feste Vorgaben für XXS/MD/XL, die der Dichte nicht folgen (191 Verwendungen);
- rund 300 rohe Pixel-Literale, vor allem 8/12/16 (rund 227).

Dazu kommt der statische Export `abstand`, der fest auf `kompakt` steht. Eine neue Seite kann deshalb jeden Wert setzen. In `komfortabel` und `handschuh` wachsen nur die Token-Abstände mit, die Literale nicht. LLH-1724 will, dass Bausteine statt Regeltext das System tragen. Der erste Baustein dafür ist ein einziges benanntes Raster, auf das sich spätere Stapel- und Textbausteine (LLH-1810) stützen.

## What Changes

- **BREAKING (sichtbar):** Die Dichte-Staffel wird auf Vielfache von 4 gerundet und um die Stufen `xxs` und `xl` ergänzt. Die genauen Werte stehen in `design.md`. In `kompakt` verschieben sich Token-Abstände um 1–2 px, so werden `7` und `11` zu `8` und `12`, `18` wird `16`.
- Alle antd-Abstandstoken (`padding`/`margin` in XXS, XS, SM, Basis, MD, LG und XL) kommen aus dem Raster der aktiven Dichte. Keine antd-Vorgabe läuft mehr ungestaffelt durch.
- Der statische Export `abstand` (fest `kompakt`) entfällt. Seine 8 Nutzer lesen den Abstand aus dem Token der aktiven Dichte.
- Ein neuer Ratschen-Wächter verbietet neue Zahl-Literale für Abstände in TS/TSX und px-Abstände in handgeschriebenem CSS. Was es heute gibt, steht als Schuld je Datei in einer Liste, die nur schrumpft. Feste Ausnahmen haben einen eigenen Grund (Großbild-Lagemonitor, Hilfe-Prosa, Anmeldung, Druck).
- Erster Migrationsschnitt: die Bausteine unter `components/instrument/` und `components/`, `sprache.css`, `EinsaetzePage.css` und die Stellen mit dem Ladeflächen-Abstand 80 (→ `flaeche.zustandOben`). Die übrigen Seiten folgen als Folgeaufgaben je Bereich.
- Die Regel kommt in `frontend/AGENTS.md` (Gestaltungssprache), die Zahlen unter „Aktionen“ werden nachgezogen. Das Design System wird neu erzeugt, dazu eine ADR.

## Capabilities

### New Capabilities

- `abstandsraster`: Ein benanntes Abstandsraster je Dichtestufe ist die einzige Quelle für Innen- und Außenabstände sowie Lücken. Neue Literale sind verboten, die Altlast schrumpft nur.

### Modified Capabilities

(keine; `einsatztauglichkeit-layout` mit seinen Mindestabständen ≥ 8 / ≥ 16 px bleibt erfüllt, `design-system-artifact` zeigt das Raster ohne Änderung seiner Anforderungen)

## Impact

- `frontend/src/theme/tokens.ts`, `theme/rollen.css` (`--lfh-luft-*`), `theme/tokens.test.ts`, `theme/rollen.guard.test.ts`.
- Neu: `frontend/src/theme/abstandsraster.guard.test.ts`.
- Die 8 Importeure von `abstand`: ETB-Filterleiste, Wiedervorlage, Entlassen, Fahrzeuge, Personal, Einsätze, BR-Verlauf und BR-Detail.
- Bausteine unter `components/instrument/` und `components/`, `theme/sprache.css`, `pages/EinsaetzePage.css`.
- e2e-Pins: `dialogfuss-dichte.spec.ts`, `katalogtabelle-kopf-dichte.spec.ts`, dazu Wächter mit Stufenwerten (`aktionsabstand`, `aktionenSpace`, `dichte`).
- Generator `frontend/scripts/design-system/` (`ABSTAND_ANTD`) und das erzeugte `docs/design/design-system/project/` (`tokens.json`, README, Vorschauen).
- `frontend/AGENTS.md` (Regel und Zahlen), neue ADR unter `docs/architektur/entscheidungen/`.
- Die Bilder der Anwenderdoku verschieben sich um 1–2 px. Sie werden in einer Folgeaufgabe neu aufgenommen, so abgestimmt am 16.11.2026.
