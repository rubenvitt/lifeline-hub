# Design

## Context

Siehe proposal.md, „Why“. Den roten Statustext (`colorErrorText` samt Zeiger- und Drückstufe)
setzt die Change `lfh-874-fehlertext-alarmtext` global in `antdToken` auf `alarmText`/`alarmHover`.
Diese Change folgt demselben Weg für Gelb und Grün und baut auf deren Stand auf `alpha` auf.

Stand antd 6.6.5:

- `typography/style/index.js` färbt `warning` (auch als Link) mit `colorWarningText` und `success`
  mit `colorSuccessText`. Eine Zeiger- oder Drückstufe gibt es für beide nicht. Es sind
  **Map-Tokens**, die antd aus der Palette der Signalfarbe ableitet (`genColorMapToken.js`,
  Stufe 9), nicht `colorWarning`/`colorSuccess` selbst.
- Außer `Typography` liest nur `input/style/variants.js` `colorWarningText` (Feldzusatz eines Felds
  mit Status, Text im gefüllten Feld mit Status). Beides ist Text, und die App nutzt heute weder
  Feldzusätze noch die gefüllte Variante. `colorSuccessText` liest nur `Typography`.
- Aufgelöst mit `antdTheme.getDesignToken` und `antdAlgorithmus` (gerechnet, nicht gemessen):

  | Token | Tag | Nacht |
  | --- | --- | --- |
  | `colorWarningText` | `#7a5200` = `achtung`, 5,43–6,92 | `#c8b034`, 8,16–9,22 |
  | `colorSuccessText` | `#1c6640` = `normal`, 5,44–6,94 | `#49aa19`, 5,92–6,68 |

  Spannen über `grund`, `flaeche`, `flaeche2`, `paneel`, `kopf`, `flaeche3` und die Statusflächen.
  Die Rollen halten überall: `achtungText` Tag 7,23–9,22 / Nacht 11,02–12,45, `normalText`
  7,19–9,18 / 10,25–11,58.
- Fundstellen mit `warning`: „nicht verortet“ und „näher heranzoomen“ in der Leiste der Lagekarte,
  die Warnung zur Aufbewahrungsdauer in den Einstellungen. `success` kommt heute nicht vor.

## Goals / Non-Goals

**Goals:**
- Jede Stelle mit `Typography` `warning`/`success` liest die Textrolle, ohne Änderung am Ort.
- Nachts kein Ton, den antd selbst ableitet.

**Non-Goals:**
- Roter Statustext (Schwester-Change, s. Context).
- Die Füllfarben `colorWarning`/`colorSuccess` bleiben, ebenso `Form` und `Alert` aus
  LFH-652/LFH-739.
- Die Fundstellen werden nicht auf `StatusZelle` oder eine eigene Komponente umgebaut.
- Kein neuer Rollenwert und kein CSS-Spiegel (beide Textrollen gibt es schon).

## Decisions

### E1: Global über die Map-Tokens in `antdToken`, nicht als `Typography`-Komponententoken

Gewählt: `antdToken` setzt `colorWarningText: achtungText` und `colorSuccessText: normalText`,
neben den roten Zeilen der Schwester-Change und mit derselben Begründung.

- **Gegen das Komponententoken `Typography: { colorWarning }`** (Vorschlag im Ticket, Muster
  `Form`): Es träfe nicht. `Typography` liest `colorWarningText`, nicht `colorWarning`, und antd
  leitet Map-Tokens aus einem Komponenten-Override nicht neu ab. `Typography: { colorWarningText }`
  wirkte, ließe aber das Feld stehen und wiche vom roten Weg ab: Rot global und Gelb am Baustein
  wären zwei Regeln für denselben Fall.
- **Warum global hier richtig ist, bei `Form` aber nicht:** Bei `Form` war das Token die Füllfarbe,
  die global auch Ränder und Ikonen färbt. Die `…Text`-Tokens sind schon bei antd nur Text.
- **Gegen das Umstellen der Fundstellen** auf eine eigene Textfarbe: Die Regel aus LFH-652 gilt
  („in `antdToken`/`antdKomponenten`, nicht je Stelle“).
- Map-Tokens lassen sich über `token` überschreiben, auch nachts nach `seedTreu`. Der Einheitstest
  löst deshalb mit dem echten Algorithmus auf, statt nur `antdToken()` zu lesen.

### E2: `success` gehört dazu

Das Ticket nennt nur `danger`/`warning`. `colorSuccessText` hat dieselbe Ursache (Tag Füllfarbe
5,44, nachts fremder Ton `#49aa19`). Ein Typ, der als einziger auf die Ableitung fällt, wäre die
nächste Fundstelle. Kosten: eine Zeile.

### E3: Nachweis

- Einheitstest je Modus am aufgelösten Token: beide Werte gleich der Rolle, Füllfarben
  unverändert, Kontrast auf jeder deckenden Fläche (Literale 7 / 5).
- Browser: „nicht verortet“ in der Leiste der Lagekarte, Tag und Nacht, über
  `e2e/kontrast-kern.ts`. Dafür reicht ein neuer Einsatz ohne Ort. `success` hat keine Stelle und
  bleibt gerechnet.

## Risks / Trade-offs

- [Konflikt mit der Schwester-Change in `antdToken`, im Kommentar über den Paletten und in
  `frontend/AGENTS.md`] → Umsetzung erst nach deren Merge, auf aktuellem `alpha`. Die neuen Zeilen
  stehen neben den roten und verweisen auf deren Begründung statt sie zu wiederholen.
- [Ein antd-Update liest `color…Text` an einer Stelle, die kein Text ist] → Der Kommentar am Wert
  nennt die Leser bei 6.6.5 und den grep. Der Einheitstest pinnt den aufgelösten Wert.
- [Am Tag werden Statuswörter dunkler und weniger „signalfarbig“] → Gewollt. Die Füllfarbe bleibt
  an Kante, Punkt und Badge, das Wort muss lesbar sein (Regel Tagmodus LFH-618).
