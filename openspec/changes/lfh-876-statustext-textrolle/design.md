# Design

## Context

Siehe proposal.md, „Why“. Stand antd 6.6.5:

- `typography/style/index.js` färbt `danger` mit `colorErrorText` (Link unter dem Zeiger
  `colorErrorTextHover`, gedrückt `colorErrorTextActive`), `warning` mit `colorWarningText`,
  `success` mit `colorSuccessText`. Das sind **Map-Tokens**, die antd aus der Palette der
  Signalfarbe ableitet (`genColorMapToken.js`, Stufe 8/9/10), nicht `colorError` selbst.
- Außer `Typography` lesen nur `input/style/variants.js` (Feldzusatz eines Felds mit Status, Text im
  gefüllten Feld mit Status) und `select/style/select-input.js` (Text im gefüllten Select mit
  Status) diese Tokens. Beides ist Text. Heute nutzt die App weder Feldzusätze noch die gefüllte
  Variante, die Wirkung dort ist also vorsorglich.
- Aufgelöst mit `antdTheme.getDesignToken` und `antdAlgorithmus` (gerechnet, nicht gemessen):

  | Token | Tag | Nacht |
  | --- | --- | --- |
  | `colorErrorText` | `#b02318` = `alarm`, 5,31–6,78 | `#dc5e5e`, 4,88–5,51 |
  | `colorErrorTextHover` | `#bd4639`, 4,02–5,12 | `#e88a87`, 7,07–7,98 |
  | `colorErrorTextActive` | `#8a110c`, 7,60–9,69 | `#ad4d4d`, 3,31–3,74 |
  | `colorWarningText` | `#7a5200` = `achtung`, 5,43–6,92 | `#c8b034`, 8,16–9,22 |
  | `colorSuccessText` | `#1c6640` = `normal`, 5,44–6,94 | `#49aa19`, 5,92–6,68 |

  Spannen über `grund`, `flaeche`, `flaeche2`, `paneel`, `kopf`, `flaeche3` und die Statusflächen.
  Die Rollen halten überall: `alarmText` Tag 7,03–8,96 / Nacht 6,35–7,18, `achtungText`
  7,23–9,22 / 11,02–12,45, `normalText` 7,19–9,18 / 10,25–11,58.

## Goals / Non-Goals

**Goals:**
- Jede Stelle mit `Typography` `danger`/`warning`/`success` liest die Textrolle, ohne Änderung
  am Ort.
- Kein Ton, den antd selbst ableitet, in irgendeinem Statustext.

**Non-Goals:**
- Die Füllfarben `colorError`/`colorWarning`/`colorSuccess` bleiben, ebenso `Form`, `Button`,
  `Dropdown` und `Alert` aus LFH-652/LFH-693/LFH-739.
- Die Fundstellen werden nicht auf `StatusZelle` oder eine eigene Komponente umgebaut.
- Kein neuer Rollenwert und kein CSS-Spiegel (die drei Textrollen gibt es schon).

## Decisions

### E1: Global über die Map-Tokens in `antdToken`, nicht als `Typography`-Komponententoken

Gewählt: `antdToken` setzt `colorErrorText`, `colorErrorTextHover`, `colorErrorTextActive`,
`colorWarningText` und `colorSuccessText` aus den Textrollen.

- **Gegen das Komponententoken `Typography: { colorError, colorWarning }`** (Vorschlag im Ticket,
  Muster `Form`): Es träfe nicht. `Typography` liest `colorErrorText`, nicht `colorError`, und
  antd leitet Map-Tokens aus einem Komponenten-Override nicht neu ab. Ein Komponententoken
  `Typography: { colorErrorText, … }` wirkte zwar, ließe aber den gleichen Fehler in Feld und
  Select stehen und müsste bei jedem weiteren Leser wiederholt werden.
- **Warum global hier richtig ist, bei `Form` aber nicht:** Bei `Form` war das Token
  `colorError`, die Füllfarbe, die global auch Ränder, Ikonen und Gefahrknöpfe färbt. Die
  `…Text`-Tokens sind schon bei antd nur Text. Ein Leser, den ein antd-Update dazubringt, ist
  ebenfalls Text und bekommt die richtige Rolle mit.
- **Gegen das Umstellen der Fundstellen** auf `StatusZelle` oder eine eigene Textfarbe: neun
  Stellen heute, jede künftige wieder; die Regel aus LFH-652 („in `antdToken`/`antdKomponenten`,
  nicht je Stelle“) gilt.
- Map-Tokens lassen sich über `token` überschreiben, auch nachts nach `seedTreu`. Gelöscht werden
  nur Seed-Schlüssel (`theme/util/alias.js`). Der Einheitstest löst deshalb mit dem echten
  Algorithmus auf, statt nur `antdToken()` zu lesen.

### E2: Zeiger und Drücken des roten Links tragen ebenfalls `alarmText`

Wie `colorLink` (LFH-652): Ein Link wechselt den Ton nicht, die Rückmeldung unter dem Zeiger ist
die Unterstreichung. antds Ableitung läge am Tag unter dem Zeiger bei 4,02, nachts gedrückt bei
3,31. `alarmHover` ist Knopfton (am Tag dunkler, für Weiß darauf gestimmt) und wäre eine zweite
Bedeutung. Heute gibt es keinen `Typography.Link` mit Typ `danger`. Gesetzt wird trotzdem, damit
der erste nicht auf antds Ableitung fällt.

### E3: `success` gehört dazu

Das Ticket nennt nur `danger`/`warning`. `colorSuccessText` hat dieselbe Ursache (Tag Füllfarbe
5,44, nachts fremder Ton `#49aa19`). Ein Typ, der als einziger auf die Ableitung fällt, wäre die
nächste Fundstelle. Kosten: eine Zeile.

### E4: Nachweis

- Einheitstest je Modus am aufgelösten Token: die fünf Werte gleich der Rolle, die Füllfarben
  unverändert. Dazu der Kontrast der drei Textrollen auf jeder deckenden Fläche (Literale 7 / 5).
- Browser: „Befehl nicht gefunden.“ (danger, Seitengrund) und „nicht verortet“ (warning, Paneel
  der Lagekarte), je Tag und Nacht, über `e2e/kontrast-kern.ts`. Beide Stellen erreicht man ohne
  vorbereitete Daten außer einem neuen Einsatz.

## Risks / Trade-offs

- [Ein antd-Update liest `color…Text` an einer Stelle, die kein Text ist] → Der Kommentar am
  Wert nennt die Leser bei 6.6.5 und den grep, mit dem man sie findet. Der Einheitstest pinnt den
  aufgelösten Wert.
- [Am Tag werden Statuswörter dunkler und sind weniger „signalfarbig“] → Gewollt. Die Füllfarbe
  bleibt an Kante, Punkt und Badge, das Wort muss lesbar sein (Regel Tagmodus LFH-618).
- [Ein Text mit Status steht auf einer Fläche, die keine deckende Rolle ist (z. B. dauerdunkler
  Rahmen)] → Heute keine solche Fundstelle (`grep` der neun Stellen). Der Rahmen hat eigene
  Textfarben (`rahmenKontrast.test.ts`).
