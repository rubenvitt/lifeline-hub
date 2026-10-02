# Design

## Context

Motivation und Messwerte: `proposal.md`. Hier nur, was den Weg bestimmt.

- `antdToken` setzt `colorInfo = bedien`, `colorWarning = achtung`, `colorError = alarm`,
  `colorSuccess = normal`. Die Flächen `colorInfoBg` usw. setzt es nicht, antd leitet sie aus
  der Farbpalette der Signalfarbe ab (Index 1). Bei den dunklen Rollenfarben des Tagmodus
  (`bedien` `#154e84`, `achtung` `#7a5200`, `normal` `#1c6640`) ergibt das trübe Grautöne statt
  heller Tönungen. Zum Vergleich: antds Standardblau `#1677ff` ergibt `#e6f4ff`.
- Der Knopfrand ist `steuerRahmen` (= antds `colorBorder`). Er ist gegen `grund`, `flaeche`,
  `paneel`, `flaeche2` und `flaeche3` abgestimmt (Tag ≥ 3,30, Nacht ≥ 3,21) und hält dort.
- Das Projekt hat die passenden Flächen schon als Rollen: die deckenden Statusflächen
  `bedienFlaeche`, `achtungFlaeche`, `alarmFlaeche`, `normalFlaeche` („Ampel als Fläche, Zahl
  bleibt lesbar“). Nachgerechnet hält `steuerRahmen` darauf:

  | Fläche | Tag | Nacht |
  | --- | --- | --- |
  | `bedienFlaeche` | 3,34 | 3,32 |
  | `achtungFlaeche` | 3,43 | 3,26 |
  | `alarmFlaeche` | 3,22 | 3,48 |
  | `normalFlaeche` | 3,39 | 3,27 |

  `text` darauf ≥ 15,06 (Tag) bzw. ≥ 14,95 (Nacht), `gedaempft` ≥ 8,96 bzw. ≥ 6,92.
- antd liest `colorInfoBg`/`colorWarningBg`/`colorErrorBg`/`colorSuccessBg` nicht nur im
  `Alert`, sondern auch in `button/style/variant.js` (Tönung des Gefahr-`text`-Knopfs unter dem
  Zeiger, gerechnet in `gefahrKontrast.test.ts`), `input`, `menu`, `select`, `steps`,
  `notification` und `space`.

## Goals / Non-Goals

**Goals:**
- Knopfrand ≥ 3 : 1 auf jeder Hinweisfläche, Tag und Nacht, gerechnet und im Browser gemessen.
- Eine Stelle für die Hinweisflächen, keine Farbe je Hinweis.

**Non-Goals:**
- Den Rand des Hinweises selbst (`colorInfoBorder` usw.) auf 3 : 1 heben. Er begrenzt kein
  Bedienziel und trägt nichts (Prüfliste LFH-690, Stufe 5), er bleibt antds Ableitung.
- `colorPrimaryBg` (am Tag ebenfalls `#b9c1c4`, Auswahl in Menü und Select). Das ist dieselbe
  Ursache an anderer Stelle, aber eine andere Fläche mit anderen Paaren. Sie geht als Nachzug
  aufs Board (Aufgabe 4.2).
- Eine neue Farbrolle.

## Decisions

### E1 — Die Hinweisfläche wird angepasst, nicht der Knopfrand

Gewählt: Komponenten-Tokens am `Alert` in `antdKomponenten`, die vier Flächen lesen die
Statusflächen-Rollen.

```ts
Alert: {
  colorInfoBg: farben.bedienFlaeche,
  colorWarningBg: farben.achtungFlaeche,
  colorErrorBg: farben.alarmFlaeche,
  colorSuccessBg: farben.normalFlaeche,
},
```

Begründung: Der Fehler liegt in der Fläche, nicht im Rand. Die trübe Ableitung ist ein
Nebeneffekt von LFH-661 und trifft drei der vier Typen, nachts auch Warnung und Erfolg. Die
Rollen sind schon gegen Text und Rand abgestimmt und tragen in beiden Modi. Damit gibt es keine
neue Rolle und keinen neuen Wert in `rollen.css`. Optisch werden die Hinweise am Tag zu dem, was
der Neuentwurf für Statusflächen vorsieht: hell getönt statt grau.

Verworfene Alternativen:
- **(B) Eigener Rand für Knöpfe auf Hinweisen** (Komponenten-Override `colorBorder` am `Alert`,
  dazu eine neue Rolle „steuerRahmenAufHinweis“). Damit bliebe die trübe Fläche, und es gäbe eine
  zweite Randfarbe neben `steuerRahmen`. Je Hinweistyp bräuchte es einen anderen Wert, weil die
  vier Flächen weit auseinanderliegen (relative Luminanz 0,37–0,80 am Tag). Außerdem würde jedes
  Eingabefeld im Hinweis anders umrandet als außerhalb.
- **(C) `steuerRahmen` am Tag global abdunkeln.** Gegen die Erfolgsfläche `#9ca69f` bräuchte der
  Rand eine relative Luminanz ≤ 0,09 (heute 0,22). Jedes Eingabefeld der App bekäme einen schweren
  Rahmen, und die Nachtwerte (Warnung 2,83) blieben offen.
- **(D) Die vier Flächen global in `antdToken` setzen.** Das wäre eine einzige Zeile mehr, aber
  sie träfe auch Knopf, Eingabefeld, Menü, Select, Schritte und Notification (s. Context). Die
  Tönung des Gefahr-`text`-Knopfs ist in `gefahrKontrast.test.ts` gegen die heutige Ableitung
  gerechnet. Diese Wirkungen müssten einzeln nachgewiesen werden, ohne dass das Ticket sie
  verlangt. Wenn sich (A) bewährt, kann ein späteres Ticket die Zuordnung global ziehen.

### E2 — Reichweite des Overrides im Teilbaum

antd setzt Komponenten-Overrides als CSS-Variablen auf die Wurzel der Komponente, sie gelten im
ganzen Teilbaum (dieselbe Grenze ist am `Dropdown` dokumentiert, LFH-693). Im `Alert` liest damit
auch ein Knopf darin die neuen Flächen. Für den Gefahr-`text`-Knopf im Live-Banner
(`live/LiveStatusBanner.tsx`, ein Fehlerhinweis) wird `colorErrorBg` zur Tönung unter dem Zeiger,
also `alarmFlaeche`. Seine Schrift `alarmHover` muss darauf den Textboden halten (Tag ≥ 7,
Nacht ≥ 5). Der Unit-Test rechnet dieses Paar mit, und Aufgabe 1.3 belegt per Browser, dass die
Variable tatsächlich im Teilbaum ankommt. Kommt sie nicht an, ist das kein Fehler dieser Change:
dann gilt für den Knopf weiter die bisher gerechnete Tönung.

### E3 — Nachweis an zwei echten Stellen

Gemessen wird am Demo-Hinweis (Info, Knopf in der Beschreibung) und an einem Ladefehler mit
„Erneut abrufen“/„Erneut laden“ (Fehler, Knopf im `action`-Slot), jeweils Tag und Nacht. Beide
Zustände entstehen im e2e per `page.route`: Der Demo-Status antwortet „freigeschaltet, nicht
importiert“, und die Listenabfrage antwortet mit 500. Warnung und Erfolg haben heute keine Stelle
mit Knopf. Sie werden im Unit-Test gerechnet, nicht im Browser gemessen.

## Risks / Trade-offs

- [Sichtbare Tonänderung aller Hinweise am Tag] → Gewollt, denn sie entspricht den
  Statusflächen. Nachts liegen die Rollen nahe an antds Ableitung.
- [antd liest in einer künftigen Version die Fläche über ein anderes Token] → Der Browser-Spec
  misst die gezeichnete Farbe und fällt dann rot.
- [Der Override erreicht Bausteine im Teilbaum, die heute niemand prüft] → Grenze im Kommentar an
  `antdKomponenten` nennen, wie beim `Dropdown`.
