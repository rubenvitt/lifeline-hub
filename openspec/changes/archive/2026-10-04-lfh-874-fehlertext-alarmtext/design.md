# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderung: `specs/textkontrast-rollen/spec.md`.

So zeichnet antd 6.6.5 roten Text (Quellen unter `frontend/node_modules/antd/es/`):

- **`colorErrorText`** ist ein abgeleitetes Map-Token (`theme/themes/shared/genColorMapToken.js`:
  `colorErrorTextHover` = Stufe 8, `colorErrorText` = Stufe 9, `colorErrorTextActive` = Stufe 10
  der Fehlerpalette). Kein Seed-Token, also über `token` überschreibbar. Das gilt auch nachts:
  `seedTreu` hält nur `colorError`, und antd legt den Override hinter den Algorithmus.
- **Wer es liest** (vollständig, per `grep -rln colorErrorText node_modules/antd/es`):
  - `typography/style/index.js`: `.ant-typography-danger` färbt die Schrift mit `colorErrorText`,
    ein Link `danger` unter dem Zeiger mit `colorErrorTextHover`, gedrückt oder fokussiert mit
    `colorErrorTextActive`.
  - `input/style/variants.js`: Eingabefeld der Variante `filled` im Fehlerzustand
    (`inputColor`) und das Beiwerk (`addonColor`).
  - `select/style/select-input.js`: Select der Variante `filled` im Fehlerzustand (`color`).

  Alle drei Stellen nutzen das Token nur als **Schriftfarbe**. Ränder, Flächen und Ikonen lesen
  `colorError`. Die Variante `filled` kommt in der App heute nicht vor.
- `theme/tokens.ts:antdToken` setzt `colorError = alarm`. `colorErrorText` folgt daraus: am Tag
  `#b02318` (= `alarm`), nachts `#dc5e5e` aus dem `darkAlgorithm`.
- **Vorbilder**: Formularmeldung (LFH-652/667, `Form.colorError = alarmText` als
  Komponenten-Token) und Gefahrrot (LFH-693, `Dropdown`/`Button`). Dort war ein Komponenten-Token
  nötig, weil das globale `colorError` auch Ränder und Ikonen färbt.

Rechenwerte (WCAG, `theme.getDesignToken` aus `antdToken` + `antdAlgorithmus`):

| Fläche | Tag heute | Tag `alarmText` | Nacht heute | Nacht `alarmText` |
| --- | --- | --- | --- | --- |
| `grund` | **5,67** | 7,51 | 5,51 | 7,18 |
| `flaeche` | **6,78** | 8,96 | 5,19 | 6,77 |
| `flaeche2` (Schublade, Dialog) | **6,27** | 8,29 | **4,97** | 6,48 |
| `flaeche3` (Hervorhebung) | **5,31** | 7,03 | **4,88** | 6,35 |
| `paneel` | **6,21** | 8,22 | 5,42 | 7,06 |
| `alarmFlaeche` (alarmierte Karte) | **5,52** | 7,31 | 5,28 | 6,89 |

Ein Link `danger` unter dem Zeiger (antds `colorErrorTextHover`) misst am Tag heute 4,02 bis 5,12.
Mit `alarmHover` sind es ≥ 8,19 am Tag und nachts ≥ 6,62.

## Goals / Non-Goals

**Goals:**
- Jeder rote Text, den antd aus `colorErrorText` färbt, hält auf jeder deckenden Fläche am Tag
  ≥ 7 : 1 und nachts ≥ 5 : 1. Das wird aus den Tokens gerechnet und an zwei Stellen im Browser
  gemessen.
- Eine Stelle trägt das app-weit: `antdToken`. Kein Aufrufer bekommt ein `style`.

**Non-Goals:**
- Das globale `colorError` (Gefahrknöpfe, Fehlerränder, Kartenkante, Ikonen, `Badge`). Diese
  Flächen und Ränder brauchen 3 : 1, nicht den Textboden.
- Roter Text, der seine Farbe schon selbst aus `alarmText` nimmt (`StatusChip`, `Zeitachseneintrag`,
  `etbTypFarben`, Statusflächen). Er bleibt unberührt.
- Die gedrückte Tönung unter einem `text`-Gefahrknopf. Sie ist als eigener Nachzug erfasst und
  gehört nicht hierher.

## Decisions

### E1 — Globales `colorErrorText` statt Komponenten-Token an `Typography`

`antdToken` bekommt:

- `colorErrorText: farben.alarmText`
- `colorErrorTextHover: farben.alarmHover`
- `colorErrorTextActive: farben.alarmHover`

Der Grund: Anders als `colorError` ist `colorErrorText` in antd schon die **Textrolle**. Jeder Leser
färbt damit Schrift (s. Context). Global gesetzt trifft der Wert deshalb nur Text, und der muss
den Textboden halten.

- **Verworfen: `Typography: { colorErrorText: … }` in `antdKomponenten`.** Das ginge auch und
  folgte dem Muster von `Form`. Ein Eingabefeld oder Select der Variante `filled` im
  Fehlerzustand trüge dann aber weiter die schwache Ableitung. Wer die Variante einführt, bräuchte
  einen zweiten und dritten Eintrag. Außerdem gilt für Komponenten-Tokens die Grenze, die an
  `antdKomponenten` beschrieben ist: Die Variable sitzt auf der Wurzel des Bausteins. Ein globales
  Token hat diese Grenze nicht.
- **Verworfen: globales `colorError` auf `alarmText`.** Das träfe Ränder, Ikonen und die Fläche des
  gefüllten Gefahrknopfs (Begründung wie LFH-652/693). Die Akzeptanz verlangt ausdrücklich, dass
  Gefahrknöpfe und Fehlerränder `alarm` behalten.
- **Verworfen: jeden Aufrufer auf `style={{ color: rollen.alarmText }}` umstellen.** Das sind acht
  Stellen, und jede neue `type="danger"` fiele wieder auf antds Wert zurück.

### E2 — Zeiger und Drücken nehmen `alarmHover`

Wie am Gefahrknopf (LFH-693, E2): am Tag dunkler als die Ruhe, nachts antds eigene Hover-Stufe
(`#e88a87`). antds Aktivstufe wäre nachts `#ad4d4d` (auf `grund` rund 3,6). Heute gibt es keinen
Link `danger` in der App. Die Werte gelten trotzdem, damit der erste nicht auf antds Ableitung fällt.

### E3 — Aufrufer prüfen, nicht umschreiben

Die Stellen mit `type="danger"` (acht, s. proposal) brauchen keine Änderung. Für jede Stelle mit
`token.colorError` wird belegt, dass sie keine Schrift färbt. Heute sind das Ränder
(`personenSpalten`, `Anmeldeverfahren`, `ModulEinstellungsListe`), `Badge` (`LiveStatusBanner`) und
`rollenFarbe('alarm')` für Kanten, Punkte und Formzeichen. Färbt eine davon doch Schrift, stellt
die Umsetzung sie auf `alarmText` um.

### E4 — Wo der Boden steht und wer ihn prüft

- **Am Wert**: Die Kontrast-Kommentare über `farbenHell` und `farbenDunkel` nennen den
  Fehlertext. Ein Kommentar an den drei Zeilen in `antdToken` begründet, warum der Weg hier
  global ist und beim Gefahrrot nicht.
- **Gerechnet**: neuer Unit-Test `theme/fehlertextKontrast.test.ts` nach dem Muster von
  `gefahrKontrast.test.ts`. Die Werte kommen aus `theme.getDesignToken({ token: antdToken(…),
  algorithm: antdAlgorithmus(…) })`, nicht aus den Rollen. So wird ein vergessenes Token oder ein
  Algorithmus, der den Override schluckt, rot. Gerechnet wird `colorErrorText`,
  `colorErrorTextHover` und `colorErrorTextActive` gegen `grund`, `flaeche`, `flaeche2`,
  `flaeche3`, `paneel`, `kopf` und `alarmFlaeche`. Die Böden stehen als Literale: Tag 7, Nacht 5.
  Dazu kommt: `colorError` bleibt `alarm`.
- **Gemessen**: neuer Browser-Spec `e2e/fehlertext-kontrast.spec.ts` mit `pruefe` aus
  `kontrast-kern.ts`, Tag und Nacht. Er misst „Befehl nicht gefunden.“ auf dem Seitengrund und
  „Überfällig“ auf der alarmierten Auftragskarte. Gesät wird wie in `stab-vorbereitung.spec.ts`,
  mit einem Auftrag, dessen Frist in der Vergangenheit liegt. Dazu kommt die Zusicherung, dass die
  Kante der Karte weiter `alarm` trägt (Akzeptanz: Fehlerränder behalten die Füllfarbe).

## Risks / Trade-offs

- [Am Tag wird roter Fehlertext dunkler, nachts heller] → Es ist derselbe Ton wie Feldmeldung,
  Gefahrmenü und Statusetiketten, die schon `alarmText` tragen. Die Darstellung wird dadurch
  einheitlicher, nicht neu.
- [`colorErrorTextActive` nachts gleich der Hover-Stufe] → Es gibt keinen dritten Ton. Das
  Drücken eines Links zeigt antd ohnehin nur kurz.
- [Ein späteres antd liest `colorErrorText` auch als Fläche] → Der Unit-Test belegt nur Werte,
  nicht Leser. Der Kommentar am Wert nennt die drei Leser von antd 6.6.5. Wer antd hebt, prüft den
  grep erneut. Den Schritt nennt der Kommentar.
- [Andere Kontrast-Specs] → `betroffene-`, `hellmodus-`, `gefahr-`, `hinweis-`,
  `kraefte-kontrast.spec.ts` laufen gegen die neuen Tokens.

## Migration Plan

Nur Frontend-Werte, kein Datenbestand. Rückweg: die drei Zeilen in `antdToken` entfernen.
