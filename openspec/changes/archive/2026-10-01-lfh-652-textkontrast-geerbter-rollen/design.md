# Design

## Context

Der Anlass steht in `proposal.md`. Die Ursachen liegen in antd 6.6.5 und in `theme/tokens.ts`:

| Befund | Ursache | Tag (Grund der Messung) | Nacht |
| --- | --- | --- | --- |
| Titel-Link | `colorLink` ist ein antd-**Seed** und nicht gesetzt, also abgeleitet aus `colorInfo` = `bedien`. Nachts verdunkelt ihn `darkAlgorithm`, und `seedTreu` holt ihn nicht zurück. | 6,59 (`flaeche`) | 4,55 |
| Link unter dem Zeiger | `colorLinkHover` wird aus der antd-Palette von `colorLink` abgeleitet und ist heller | ≈ 5,6 | — |
| Tabellenkopf | `tabellenTokens.headerColor = schwach` | 5,58 (`kopf`) | 5,17 |
| „—“, Seitenbeschreibung | `Typography` `secondary` → `colorTextDescription` → antd-Vorgabe `colorTextTertiary` = `schwach` | 6,37 (`flaeche`), 5,33 (`grund`) | 5,03 / 5,33 |
| Formularmeldung | Form-Stil `-item-explain-error { color: token.colorError }`, `colorError` = `alarm` | 6,27 | 6,48 |
| Standardknopf unter dem Zeiger | Button `defaultHoverColor` = `colorPrimaryHover` = `bedienHover` | 5,62 (`flaeche`) | 8,49 |

Gerechnete Werte der Zielrollen (WCAG, gegen die opaken Rollenflächen):

| Rolle | grund | flaeche | flaeche2 | kopf | paneel | flaeche3 |
| --- | --- | --- | --- | --- | --- | --- |
| Tag `bedienText` `#164f86` | 7,04 | 8,41 | 7,78 | 7,36 | 7,71 | 6,59 |
| Tag `gedaempft` `#474e57` | 7,05 | 8,42 | 7,78 | 7,37 | 7,71 | 6,60 |
| Tag `alarmText` `#8f1c12` | 7,51 | 8,96 | 8,29 | 7,85 | 8,22 | 7,03 |
| Nacht `bedienText` `#8ec2f0` | 10,55 | 9,95 | 9,52 | 10,24 | 10,38 | 9,34 |
| Nacht `gedaempft` `#9aa2ab` | 7,71 | 7,27 | 6,96 | 7,48 | 7,59 | 6,83 |
| Nacht `alarm` (= `alarmText`) | 7,18 | 6,77 | 6,48 | 6,96 | 7,06 | 6,35 |

Bisher half man sich an fünf Stellen mit einem lokalen `style={{ color: bedienText }}` (`Datensicht`,
`InlineAngabe`, `BemerkungZelle`, `EtbAnhaenge`, `personBearbeiten`). `frontend/AGENTS.md` schreibt
das als Regel vor: „Blauer Bedien-TEXT nimmt `rollen.bedienText`, nicht `colorLink`“.

## Goals / Non-Goals

**Goals:**
- Die fünf Stellen halten ihren Boden dort, wo sie geerbt werden: an der antd-Ableitung, für jeden
  Konsumenten. Ein neues Modul erbt den richtigen Wert, ohne etwas dafür zu tun.
- Die Ableitung ist ohne Browser prüfbar (aufgelöste Tokens). Der Boden ist im Browser gemessen.

**Non-Goals:**
- Den Wert von `schwach` ändern (LFH-643: Augenbraue, Platzhalter, `colorTextTertiary`).
- Hervorhebungsflächen (`flaeche3`, Hover- und Aktivzeile) am Tag auf 7 : 1 heben. Dort liegen
  `bedienText` und `gedaempft` bei 6,59 und 6,60. Das betrifft jede Textrolle unter dem Zeiger
  und wird als eigener Task erfasst (s. Risiken).
- `Typography` `type="danger"`, `Alert` und weitere Stellen, an denen `colorError` als Text
  erscheint. Diese sind nicht gemessen und gehören nicht zu den Befunden. Sie werden beim
  Umsetzen gesichtet und bei Bedarf als Task erfasst.
- Die fünf lokalen Überschreibungen entfernen. Sie werden wertgleich und damit wirkungslos. Ihr
  Ausbau ist reine Aufräumarbeit ohne Kontrastgewinn. Nur ihre Kommentare werden berichtigt.

## Decisions

### E1 — Global an der antd-Ableitung statt lokal je Stelle

`antdToken`, `antdKomponenten` und `seedTreu` in `tokens.ts` setzen die abgeleiteten Textfarben
auf bestehende Rollen. `tabellenTokens` in `KatalogTabelle.tsx` setzt den Kopftext.

- **Verworfen: weiter lokal überschreiben.** So ist es heute an fünf Stellen gelöst. Jede neue
  Stelle erbt den Fehler wieder, und kein Gate fängt ihn ab. Die Prüfliste fand ihn erneut.
- **Verworfen: eine neue Rolle „Linktext“.** Sie hätte denselben Wert wie `bedienText` und
  dieselbe Bedeutung. Das verletzt „eine Farbe = eine Bedeutung“ und `rollen.guard.test.ts`
  (keine wertgleiche Doppelung).

### E2 — Link: `colorLink`, `colorLinkHover` und `colorLinkActive` = `bedienText`, Rückmeldung unter dem Zeiger ohne Farbwechsel

`colorLink` ist ein Seed. antd nimmt ihn nur als Eingabe des Algorithmus, nicht als Override
(`formatToken` streicht Seeds aus dem Override). Am Tag gibt `genColorMapToken` die Eingabe
unverändert aus (Palettenstufe 6 ist der Seed selbst), also reicht das Setzen. Nachts rechnet die
dunkle Palette den Seed um. Deshalb pinnt `seedTreu` `colorLink` wie die übrigen Signalfarben.
`colorLinkHover` und `colorLinkActive` sind Map-Tokens und werden als Override gesetzt.

Unter dem Zeiger trägt ein Link denselben Ton. Die Rückmeldung kommt aus `linkHoverDecoration:
'underline'` für Anker und `Typography.Link` und aus `Button.linkHoverBg = bedienFlaeche` für
Knöpfe vom Typ `link`. `bedienText` auf `bedienFlaeche` hält 7,11 am Tag und 9,65 in der Nacht.

- **Verworfen: Hover = `bedienHover`.** Am Tag 4,41–5,62. Genau dieser Befund kam als Nachtrag.
- **Verworfen: eine dunklere Hover-Rolle am Tag.** Das wäre eine neue Farbe für einen Zustand, den
  Unterstreichung oder Fläche ohne neue Farbe tragen.

### E3 — Beschreibung und Tabellenkopf auf `gedaempft`

`colorTextDescription` = `gedaempft` (wie `colorTextSecondary`). `colorTextTertiary` und
`colorTextPlaceholder` bleiben `schwach`. Der Kopftext der `KatalogTabelle` wird ebenfalls
`gedaempft`.

- **Verworfen: `schwach` anheben.** Dann bräche die Hierarchie, denn ≥ 7 : 1 wäre am Tag
  praktisch `gedaempft` (7,05). Der Boden der tertiären Stufe ist eine eigene Entscheidung
  (LFH-643). Abgrenzung: Die „Seitenbeschreibung 5,33“, die die Prüfliste LFH-643 zuordnet, läuft
  über `colorTextDescription` und wird hier mit gelöst. LFH-643 behält Augenbraue, Platzhalter
  und `colorTextTertiary`.
- **Verworfen: `text2` für den Tabellenkopf.** Der Kopf (10 px, Versalien) stünde dann so kräftig
  wie der Lauftext der Zellen und verlöre seine Unterordnung. Mit `gedaempft` bleibt eine Stufe
  Abstand, und Größe und Versalien tragen den Rest.

### E4 — Formularmeldung über Komponenten-Tokens des `Form`

`antdKomponenten` setzt `Form: { colorError: alarmText, colorWarning: achtungText }`. antd wendet
Alias-Tokens, die unter `components.Form` stehen, nur auf die Stile des `Form` an: Meldung,
Pflichtmarke (`labelRequiredMarkColor`) und Feedback-Ikone. Rahmen und Status der Eingabefelder
rechnet `Input` in seinem eigenen Kontext, sie bleiben bei `alarm` und `achtung`.

- **Verworfen: das globale `colorError` = `alarmText`.** Das färbte auch Füllungen, Badges, Ränder
  und den Gefahrknopf mit der Textrolle. Gerade das trennt LFH-618 (Füllfarbe für Kante, Punkt und
  Balken).
- **Verworfen: eine CSS-Regel auf `.ant-form-item-explain-error`.** Das wäre ein zweiter Ort neben
  den Tokens und hinge an Spezifität und Klassennamen der Bibliothek.

### E5 — Standardknopf: `defaultHoverColor` und `defaultActiveColor` = `bedienText`

Nur die Beschriftung wechselt die Rolle. `defaultHoverBorderColor` bleibt `bedienHover` (Kante,
Boden 3 : 1, am Tag 5,62).

### E6 — Nachweis

- **Einheit:** `tokens.test.ts` löst die Tokens über antds `theme.getDesignToken` mit
  `antdToken` und `antdAlgorithmus` je Modus auf und prüft `colorLink`, `colorLinkHover`,
  `colorLinkActive` und `colorTextDescription` gegen die Rolle. Das deckt auch die Falle des
  Nacht-Algorithmus ab. `antdKomponenten` wird als reines Objekt geprüft (Form, Button).
  `KatalogTabelle` prüft `tabellenTokens`.
- **Browser:** `e2e/dokumente.spec.ts` hebt den „geerbt“-Block von 4,5 auf `KONTRAST_ZIEL`. Dazu
  kommen ein Datensicht-Titel-Link ohne lokale Überschreibung, die Pflichtmeldung und „Abbrechen“
  unter dem Zeiger. Die Böden bleiben Literale.
- **Mutationsprobe:** Je eine Zeile in `tokens.ts` zurückdrehen (`colorLink`,
  `colorTextDescription`, Form-`colorError`, `defaultHoverColor`), dazu `headerColor`. Jede
  Rücknahme muss ihren Test rot machen.

## Risks / Trade-offs

- [Hover- und Aktivzeile (`flaeche3`) am Tag 6,59/6,60] → Wird benannt und nicht hier gelöst. Ein
  eigener ClickUp-Task für die Hervorhebungsfläche wird angelegt. Die Messung läuft ohne Zeiger
  über der Zeile (`page.mouse.move(0, 0)`), wie bisher.
- [Links am Tag sichtbar dunkler, Formularfehler dunkelrot] → Gewollt. Es sind die Werte, die
  LFH-613/LFH-618 für Bedien- und Statustext schon festgelegt haben.
- [`gedaempft` nachts auf `flaeche2` 6,96, auf `flaeche3` 6,83] → Über dem Nachtboden 5. Kein Risiko.
- [Seed-Pinning nachts übersehen] → Der Einheitstest löst mit dem echten Nacht-Algorithmus auf.
  Ohne `seedTreu`-Zeile wird er rot.
- [antd ändert Token-Namen beim Upgrade] → Die aufgelösten Tokens im Einheitstest und die
  Browsermessung fallen dann auf.

## Migration Plan

Keine Daten, kein Server. Die Werte wirken beim nächsten Frontend-Build. Rücknahme ist ein Revert.
