# Design

## Context

`antdToken()` (`frontend/src/theme/tokens.ts`) setzt seit der Change `m113c8ln-abstandsraster`
(D2) `padding*`/`margin*` aus `dichten[dichte].abstand`. antd 6.7 kennt daneben zwei Gruppen
fester Polster, die nicht aus diesen Token abgeleitet sind (`theme/util/alias.js`):

| Token | antd | liest (antd 6.7, `es/*/style`) |
| --- | --- | --- |
| `controlPaddingHorizontal` | 12 | Select `optionPadding` und Gruppeneinrückung (×2), Dropdown-Menüeinträge, Input `paddingInlineLG`, Mentions, Segmented |
| `controlPaddingHorizontalSM` | 8 | Input `paddingInlineSM`, Segmented SM |
| `paddingContentHorizontal` | `sizeMS` 16 | Button `paddingInline`/`paddingInlineLG`, List SM |
| `paddingContentHorizontalLG` | `sizeLG` 24 | Modal `contentPadding`, Notification, Alert mit Beschreibung, List LG |
| `paddingContentVertical(SM/LG)` | 12 / 8 / 16 | Alert, List |

Das normale Eingabefeld liest `paddingSM` und folgt dem Raster schon. Die App ersetzt antds
`List` durch `components/Liste.tsx` und `Segmented` weitgehend durch `Segmentleiste`; beide
Wirkorte sind deshalb klein.

## Goals / Non-Goals

**Goals:**
- `controlPaddingHorizontal(SM)` folgen der Dichte; `kompakt` bleibt pixelgleich.
- Die Ausnahme der `paddingContent*`-Token steht mit Grund in der Spec, nicht als pauschales
  „abgeleitete Polster“.

**Non-Goals:**
- Kein Eingriff in die `paddingContent*`-Token oder in die `size*`-Map-Token.
- Kein neuer Wert im Raster, keine Änderung an `rollen.css`.

## Decisions

**D1: Abbildung nach antds Größenrang.** `controlPaddingHorizontal` ← `abstand.md`
(12 · 20 · 24), `controlPaddingHorizontalSM` ← `abstand.sm` (8 · 12 · 16). Das sind genau die
Stufen, die in `kompakt` antds Vorgaben 12 und 8 treffen; damit ändert sich am Fükw kein
Pixel, und in den anderen Stufen wachsen die Polster wie `padding` und `paddingSM`.
Verworfen: `controlPaddingHorizontal` ← `lg` (16 · 28 · 44) — verschöbe `kompakt` und gäbe im
Handschuh 88 px Gruppeneinrückung.

**D2: Nur die Steuerelement-Polster (Variante B, mit Ruben am 18.11.2026).**
Verworfen A, alle acht Token (`paddingContentHorizontal` ← `lg`, `…LG` ← `xl`,
`paddingContentVertical` ← `md`, `…LG` ← `lg`, `…SM` ← `sm`): ergäbe im Handschuh 44 px
seitliches Knopfpolster und 64 px Dialogrand je Seite; auf einem 390-px-Handschirm blieben dem
Dialoginhalt rund 260 px, Knopfreihen brächen um. Die Treffläche der Knöpfe trägt schon
`controlHeight` und der Knopfboden aus `antdKnopf`, das Polster bringt dort nichts.
Verworfen C, nichts ändern: Auswahllisten und Menüs sind im Handschuh-Betrieb die dichtesten
Bedienflächen, gerade dort klebte der Text am Rand.

**D3: ADR-0059 bleibt.** Ihre MUST-Regel nennt die Abstandstoken XXS bis XL; die neuen
Abbildungen widersprechen ihr nicht. Eine akzeptierte ADR ist unveränderlich
(`docs/architektur/AGENTS.md`); die Entscheidung steht in Spec und diesem Design. Eine neue ADR
lohnt nicht: die Regel ist eine Zeile in `antdToken`, die ein Test festhält.

## Risks / Trade-offs

- [Select-Gruppeneinrückung wächst im Handschuh auf 48 px] → Gruppierte Auswahlen sind selten;
  das Bild der Auswahlliste in Handschuh prüft die Wirkung, notfalls Komponenten-Token
  `Select.optionPadding` statt Rückbau.
- [Eingabefeld LG/SM bekommt mehr Innenrand und damit weniger Textbreite] → Größen-Props an
  Eingaben sind in der App selten; die Höhe bleibt durch `controlHeight` bestimmt.
- [Ein antd-Update liest die Token an neuen Stellen] → Der Test pinnt nur die Token, nicht die
  Wirkorte; die Tabelle oben nennt den geprüften Stand (antd 6.7).
