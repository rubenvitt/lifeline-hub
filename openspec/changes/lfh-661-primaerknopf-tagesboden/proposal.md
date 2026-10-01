# Proposal

## Why

Die Beschriftung jedes Primärknopfs (Weiß `aufBedien` auf `bedien` `#1a5fa0`) misst am Tag
6,59 : 1, unter dem Zeiger (`bedienHover` `#236aad`) 5,62 : 1. Kriterium 5 der Prüfliste
Einsatztauglichkeit verlangt für Text am Tag ≥ 7 : 1. Drei Kontrast-Specs (Ablösung,
Verpflegung, Betreuung) führen die Lücke deshalb als app-weite Ausnahme mit Untergrenze 4,5,
und drei Prüflisten halten Kriterium 5 allein ihretwegen offen. Gerade der Primärknopf trägt die
folgenreichste Handlung einer Seite („Schicht beginnen“, „Vollziehen“, „Speichern“), und er wird
bei Tageslicht im Freien gelesen.

## What Changes

- **Entscheidung:** Die Beschriftung auf satter Bedienfläche bekommt **keinen eigenen Boden**;
  sie fällt unter den Textboden aus Kriterium 5 (Tag ≥ 7 : 1, Nacht ≥ 5 : 1), in Ruhe und unter
  dem Zeiger. Ein „Großtext“-Boden (4,5 : 1 nach WCAG 1.4.3) trägt nicht: die Knopfschrift ist
  höchstens 15 px bei Gewicht 600, WCAG verlangt für fetten Großtext 18,66 px.
- **Tagpalette:** `farbenHell.bedien` wird dunkler, `farbenHell.bedienHover` ebenso; beide
  tragen Weiß ≥ 7 : 1, der Hover-Schritt bleibt so groß wie heute. Werte und Boden stehen am
  Wert in `theme/tokens.ts`, gespiegelt in `theme/rollen.css`.
- **Nachtpalette unverändert** (`aufBedien` auf `bedien` 6,19, auf `bedienHover` höher).
- **Ausnahme fällt:** „Weiß auf `bedien` → LFH-661“ verschwindet aus
  `e2e/abloesung-kontrast.spec.ts`, `e2e/verpflegung-kontrast.spec.ts` und
  `e2e/betreuung-pruefliste.spec.ts`; der Primärknopf misst dort gegen den vollen Textboden.
- **Neuer Nachweis:** Ein Browser-Spec misst den Primärknopf in Ruhe und unter dem Zeiger, Tag
  und Nacht, mit dem Messkern `e2e/kontrast-kern.ts`; ein Unit-Test rechnet dieselben Paare
  aus den Tokens.
- Nachbarn, die `bedien` mitnehmen (Fokusring, antds `colorPrimary`/`colorInfo`, Checkbox,
  Schalter), werden dunkler und damit kontrastreicher; geprüft, nicht umgebaut.

## Capabilities

### New Capabilities
- `farbrollen-kontrast`: Kontrastböden, die die Farbrollen der Paletten tragen müssen —
  beginnend mit der Beschriftung auf satter Bedienfläche (Primärknopf). Heimat für die
  verwandten app-weiten Lücken (Tertiärtext LFH-643, Rot am Tag LFH-693), wenn sie landen.

### Modified Capabilities
- keine

## Impact

- `frontend/src/theme/tokens.ts` (`farbenHell.bedien`, `farbenHell.bedienHover`, Kontrast-Kommentar)
- `frontend/src/theme/rollen.css` (`--lfh-bedien`, `--lfh-bedien-hover` im Tagblock)
- `frontend/src/theme/gate5.guard.test.ts` (Rollenwert-Muster kennt die neuen Hex-Werte)
- `frontend/src/theme/` neuer Unit-Test der Knopfpaare
- `frontend/e2e/abloesung-kontrast.spec.ts`, `verpflegung-kontrast.spec.ts`,
  `betreuung-pruefliste.spec.ts` (Ausnahme entfernt), neuer `e2e/primaerknopf-kontrast.spec.ts`
- Sichtbar: Primärknöpfe, Links in Bedienfarbe, Fokusringe und gewählte Checkboxen werden am Tag
  einen Ton dunkler. Kein Backend, keine API, keine Migration.
