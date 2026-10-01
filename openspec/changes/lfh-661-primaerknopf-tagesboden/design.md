# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/farbrollen-kontrast/spec.md`.

- antd zeichnet den Primärknopf aus `colorPrimary` (= `bedien`), unter dem Zeiger aus
  `colorPrimaryHover` (= `bedienHover`); die Beschriftung kommt aus dem Komponenten-Token
  `Button.primaryColor` (= `aufBedien`, am Tag `#ffffff`). Gedrückt (`colorPrimaryActive`)
  leitet antd aus `colorPrimary` ab, dunkler als die Ruhe.
- `bedien` trägt außerdem: antds `colorInfo` und damit Links (`colorLink`), Fokusringe
  (`outline: … var(--lfh-bedien)` in `sprache.css`, `EinsaetzePage.css`), gefüllte Checkbox,
  Schalter und gewählte Radioscheibe. `bedienHover` färbt zusätzlich den Kachellink der
  Einsatzübersicht unter dem Zeiger (`EinsaetzePage.css`).
- Die Knopfschrift folgt `dichten[…].schriftgroesse` (antds große Knöpfe eine Stufe darüber),
  Gewicht 600; gemessen in der kompakten Stufe 13,5 px, der große Anmelde-Knopf 16 px.
- Rechenwerte heute (Tag, WCAG): Weiß auf `bedien` `#1a5fa0` 6,59, auf `bedienHover` `#236aad`
  5,62. Nacht: `aufBedien` `#08090b` auf `bedien` `#4d94d6` 6,19, auf `bedienHover` `#7db3e8`
  höher.

## Goals / Non-Goals

**Goals:**
- Primärknopf in Ruhe und unter dem Zeiger hält am Tag ≥ 7 : 1, nachts ≥ 5 : 1, gerechnet
  (Unit-Test aus den Tokens) und im Browser gemessen (Messkern).
- Boden und Messwerte stehen am Wert in `tokens.ts`.
- Die Ausnahme „Weiß auf `bedien` → LFH-661“ verschwindet aus allen drei Kontrast-Specs.

**Non-Goals:**
- Weiß auf `alarm` im Gefahrknopf und roter Menütext am Tag (LFH-693).
- Tertiärtext `schwach` (LFH-643).
- Links in Bedienfarbe auf `grund` und der Kachellink unter dem Zeiger: sie werden dunkler und
  damit besser, erreichen aber nicht überall 7 : 1 (Werte unter „Risks“). Blauer Bedien-Text
  nimmt nach `frontend/AGENTS.md` ohnehin `bedienText`; wo er es nicht tut, ist das ein eigener
  Befund, kein Teil dieser Änderung.
- Die Nachtpalette.
- `rasterLinie` (`rgba(26, 95, 160, 0.07)`): dekorative Tönung bei 7 % Deckkraft, keine
  Kontrastrolle; sie bleibt.
- Die eingefrorenen Prüflisten unter `docs/superpowers/` werden nicht fortgeschrieben.

## Decisions

### E1 — Anheben statt eigener Boden

Die Beschriftung auf Bedienfläche fällt unter den Tagesboden 7 : 1.

- **Verworfen: eigener Boden 4,5 : 1 „wegen 600er-Gewicht“.** WCAG 1.4.3 senkt die Schwelle
  nur für Großtext: 24 px normal oder 18,66 px fett. Die Knopfschrift misst 13,5 px, der große
  Anmelde-Knopf 16 px; sie ist kein Großtext. Der Browser-Spec sichert die Grenze zu (Schrift
  < 18,66 px), damit die Begründung nicht still wegfällt. Ein eigener Boden wäre eine Hausregel ohne
  Normgrund, genau für den Text, der die folgenreichste Handlung der Seite trägt.
- **Verworfen: dunkle Beschriftung auf dem heutigen Blau.** `#111418` auf `#1a5fa0` misst nur
  rund 2,8 : 1; ein Wechsel der Beschriftungsfarbe trägt bei einem mittleren Blau nicht.
- **Verworfen: eine eigene Rolle nur für die Knopffläche** (z. B. `bedienFuellung`, Links und
  Fokusring blieben auf `#1a5fa0`). Zwei fast gleiche Blautöne für „bedienbar“ widersprechen
  „eine Bedienfarbe“ des Neuentwurfs, und Fokusring wie Checkbox gewinnen am dunkleren Wert
  ebenfalls Kontrast.

### E2 — Werte

| Rolle | alt | neu | Weiß darauf | auf `grund` | Stelle |
| --- | --- | --- | --- | --- | --- |
| `farbenHell.bedien` | `#1a5fa0` | `#154e84` | 6,59 → **8,55** | 5,51 → 7,16 | Ruhe |
| `farbenHell.bedienHover` | `#236aad` | `#185895` | 5,62 → **7,32** | 4,71 → 6,13 | Zeiger |

- Gleicher Farbton (HSL-Ton 0,581) und gleiche Sättigung (0,72) wie heute, nur die Helligkeit
  sinkt: der Knopf bleibt erkennbar dasselbe Blau.
- **Hover bleibt heller als die Ruhe**, wie bisher und wie antds Vorgabe; der Schritt ist mit
  8,55 / 7,32 = 1,17 so groß wie heute (6,59 / 5,62 = 1,17). Der Zeigerzustand bleibt also
  genauso sichtbar.
- Der gedrückte Zustand liegt dunkler als die Ruhe und trägt damit mehr als 8,55.
- `bedien` liegt danach dicht an `bedienText` (`#164f86`, 1,02 : 1 zueinander). Beide Rollen
  bleiben getrennt: `bedienText` ist für Text auf der getönten `bedienFlaeche` gerechnet, und
  ein Zusammenlegen wäre eine eigene Entscheidung.
- **Verworfen: nur `bedien` anheben, Hover dunkler als Ruhe** (z. B. Ruhe `#185895`, Hover
  `#134676`). Dreht die gewohnte Richtung des Zeigerzustands um und lässt die Ruhe mit 7,32
  knapp am Boden.
- **Verworfen: knapp an 7 : 1 in Ruhe** (z. B. `#1a5a99`, 7,08). Dann bliebe für einen
  helleren Hover kein Raum über 7.

### E3 — Wo der Boden steht und wer ihn prüft

- **Am Wert:** Der Kontrast-Kommentar über `farbenHell` nennt die neuen Werte und den Boden
  („Weiß auf `bedien` ≥ 7 : 1 in Ruhe und unter dem Zeiger, kein eigener Knopfboden, LFH-661“).
  `rollen.css` spiegelt die Hex-Werte (`rollen.guard.test.ts` hält beide deckungsgleich).
- **Gerechnet:** neuer Unit-Test `theme/bedienKontrast.test.ts` nach dem Muster von
  `rahmenKontrast.test.ts` (WCAG-Formel, Böden als Literale): `aufBedien` auf `bedien` und auf
  `bedienHover`, Tag ≥ 7, Nacht ≥ 5; `bedien` ≠ `bedienHover` in beiden Paletten. Er ist der
  schnelle TDD-Anker und läuft im Bündel `schnell`.
- **Gemessen:** neuer Browser-Spec `e2e/primaerknopf-kontrast.spec.ts` mit dem Messkern
  `kontrast-kern.ts`, Tag und Nacht, Ruhe und Zeiger. Gemessen am Knopf „Anmelden“ der
  Anmeldeseite (ohne Saat erreichbar) und am Absende-Knopf des Dialogs „Neuer Einsatz“ der
  Einsatzübersicht (`ErfassungsModal`, dieselbe Hülle wie „Schicht beginnen“ der Ablösung).
  Unter dem Zeiger wird erst nach dem Farbübergang gemessen (`toPass`), und der Spec sichert
  zu, dass die gemessene Knopffläche unter dem Zeiger eine andere ist als in Ruhe, sonst wäre
  „Hover gemessen“ trivial wahr.
- **Ausnahme fällt:** In `abloesung-kontrast.spec.ts`, `verpflegung-kontrast.spec.ts` und
  `betreuung-pruefliste.spec.ts` entfällt der Zweig „`tag && primaer` → LFH-661“ samt
  Kopfkommentar; die Primärknöpfe zählen dort als tragender Text. Wo ein Spec zusichert, dass
  ein Text unter einer Ausnahme gesehen wurde (`pruefeGesehen`), wird der Primärknopf auf
  „ohne Ausnahme gesehen“ umgestellt, damit der Nachweis nicht still schrumpft.
- **Gate 5:** `gate5.guard.test.ts` kennt die Rollenwerte als Hex-Muster; `1a5fa0` weicht
  `154e84`, `185895` kommt hinzu (der Hover-Wert der Nacht steht schon darin).

## Risks / Trade-offs

- [Links in Bedienfarbe auf `grund` erreichen nur 7,16 (Ruhe) bzw. der Kachellink unter dem
  Zeiger auf `flaeche3` 5,74] → Verbesserung gegenüber heute (5,51 bzw. 4,41), aber kein
  Ziel dieser Änderung; beim Umsetzen gemessen und als Nachzug auf dem Board erfasst, falls ein
  Text dort unter 7 bleibt.
- [Sichtbare Farbänderung app-weit am Tag] → gleicher Ton und gleiche Sättigung, nur dunkler;
  Nacht (Vorgabe) unberührt.
- [Hover mit 7,32 knapp über dem Boden] → Unit-Test und Browser-Spec halten die Schranke als
  Literal; eine spätere Aufhellung wird rot.
- [Andere Kontrast-Specs mit hart erwarteten Werten] → `betroffene-`, `hellmodus-`,
  `kraefte-`, `fachebenen-kontrast.spec.ts` beim Umsetzen gegen den neuen Wert laufen lassen.

## Migration Plan

Reiner Frontend-Wert, kein Datenbestand. Rückweg: die zwei Hex-Werte zurücksetzen.
