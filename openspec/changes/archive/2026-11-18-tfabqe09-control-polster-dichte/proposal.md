# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/tfabqe09jiieafaax95mvhem (LLH-1941)

## Why

Seit LLH-1809 folgen antds `padding*`/`margin*` dem Abstandsraster der Dichte, die seitlichen
Polster der Steuerelemente aber nicht: `controlPaddingHorizontal` (12) und
`controlPaddingHorizontalSM` (8) stehen auf antds festen Werten. Im Handschuh-Betrieb kleben
deshalb Optionen einer Auswahlliste, Einträge eines Dropdown-Menüs und der Text in kleinen und
großen Eingabefeldern so eng am Rand wie in `kompakt`, während Zeilenhöhe und alle übrigen
Abstände gewachsen sind.

## What Changes

- `controlPaddingHorizontal` folgt der Rasterstufe `md` der aktiven Dichte (12 · 20 · 24),
  `controlPaddingHorizontalSM` der Stufe `sm` (8 · 12 · 16). In `kompakt` bleibt jeder Wert
  pixelgleich mit antds Vorgabe.
- Sichtbar wirkt das an: Optionen und Gruppeneinrückung der Auswahlliste (Select), Einträgen
  des Dropdown-Menüs, seitlichem Polster kleiner und großer Eingabefelder, Segmented und
  Mentions.
- Die `paddingContent*`-Token (seitliches Knopfpolster, Inhaltsrand von Modal und
  Benachrichtigung, Polster von Hinweis und Liste) bleiben bewusst antds feste Werte. Die Spec
  nennt diese Ausnahme künftig ausdrücklich mit Grund, statt alle „abgeleiteten Polster“
  pauschal auszunehmen.
- Abgestimmt mit Ruben am 18.11.2026 (Variante B). Verworfen: alle acht Token mitwachsen lassen
  (A), nichts ändern (C); Begründung in `design.md`.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `abstandsraster`: Die Anforderung „Alle Abstandstoken der Komponentenbibliothek folgen dem
  Raster“ schließt die seitlichen Steuerelement-Polster ein und nimmt nur noch die
  Inhaltspolster (`paddingContent*`) mit Grund aus.

## Impact

- Code: `frontend/src/theme/tokens.ts` (`antdToken`), Tests in `frontend/src/theme/tokens.test.ts`.
- Regeltext: `frontend/AGENTS.md`, Gestaltungssprache, „Abstandsraster“ (ein Halbsatz zur
  Ausnahme).
- ADR-0059 bleibt unverändert: ihre Regel nennt die Token XXS bis XL, die Steuerelement-Polster
  fallen nicht darunter, und eine akzeptierte ADR ändert sich nicht.
- Keine Schnittstelle, kein Backend, keine Migration. Sichtbar nur in `komfortabel` und
  `handschuh`.
