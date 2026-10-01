# Design

## Context

Die Textstufen stehen in `frontend/src/theme/tokens.ts` (`farbenHell`, `farbenDunkel`) und
deckungsgleich in `rollen.css`, gehalten von `rollen.guard.test.ts`. `schwach` erreicht antd
über `colorTextTertiary`, `colorTextPlaceholder` und, von antd abgeleitet,
`colorTextDescription`. Die Bausteine `Augenbraue`, `Paneel` (Meta), `Zeitachseneintrag`,
`Kennzahl` und die Seitenkopf-Brotkrume lesen `rollen.schwach` direkt. Gerechnete Werte des
Bestands (WCAG-Kontrast; L\* nach CIELAB, D65):

| Modus | Stufe | Wert | grund | schwächste deckende Fläche | L\* |
|---|---|---|---|---|---|
| Tag | text2 | `#2b3138` | 11,00 | 10,30 (`flaeche3`) | 20,0 |
| Tag | gedaempft | `#474e57` | 7,05 | **6,60** (`flaeche3`), 6,86 (`alarmFlaeche`) | 32,9 |
| Tag | schwach | `#58606a` | 5,33 | **4,99** (`flaeche3`), 5,20 (`alarmFlaeche`) | 40,4 |
| Nacht | gedaempft | `#9aa2ab` | 7,71 | 6,83 (`flaeche3`) | 66,3 |
| Nacht | schwach | `#7d858e` | 5,33 | **4,72** (`flaeche3`), 4,81 (`flaeche2` = Dialog) | 55,2 |

Die vier Browser-Gates (`abloesung-`, `verpflegung-`, `betroffene-kontrast`,
`betreuung-pruefliste`) messen jeden Text im Inhalt und führen `schwach` bis zu dieser Change
als Ausnahme mit 4,5 : 1. `rahmenFarben.gesperrt` ist `farbenDunkel.schwach` und hängt damit an
der Nachtstufe.

## Goals / Non-Goals

**Goals:**
- Einen benannten Boden für Tertiärtext festlegen, am Wert begründen und mit einem Wächter
  sichern.
- Die Ausnahmen in den Browser-Gates auflösen.
- Die Rangfolge `gedaempft` → `schwach` messbar machen, damit „sichtbar“ prüfbar wird.

**Non-Goals:**
- `text` und `text2` umstimmen. Sie halten den Boden mit Abstand.
- Den Rahmen (`rahmenFarben`) über `gesperrt` hinaus anfassen (LFH-434).
- Status-, Bedien- und Flächenrollen. Weiß auf `bedien` bleibt bei LFH-661, Feldmeldungen in
  `colorError` bei LFH-667.
- Text auf durchscheinenden Füllungen (`*Fuellung`, `*FuellungStark`). Sie tragen Kante, Punkt
  und Balken. Wo doch Text darauf steht, misst ihn das Browser-Gate der Seite.

## Decisions

### D1 — Boden: Tertiärtext hält den vollen Textboden (Tag 7, Nacht 5)

Gewählt: **Option A.** Es gibt keine eigene Tertiärschwelle. `schwach` hält auf jeder deckenden
Fläche dieselbe Schwelle wie jeder andere Text im Inhalt.

Begründung:
- `schwach` trägt Information, die nirgends sonst steht. Platzhalter sind bei mehreren Filtern
  die einzige Beschriftung, die Feldhilfe erklärt das Feld, und die Augenbraue benennt den
  Abschnitt. Mit 10 px und Versalien ist sie die kleinste Schrift der Oberfläche, und gerade
  kleine Schrift braucht Kontrast.
- Der Tagesboden 7 : 1 (WCAG 1.4.6, AAA) gilt, weil die App bei Tageslicht und im Freien
  gelesen wird (LFH-434). Blendung trifft Tertiärtext nicht weniger als Statustext.
- Eine Regel ohne Ausnahme lässt sich prüfen: Die Gates verlieren ihre `TERTIAER`-Listen, und
  eine neue Seite muss keine Selektorliste mehr pflegen, die still veralten kann.

Verworfen:
- **B — eigener Tertiärboden Tag 6 / Nacht 5** (`schwach` Tag `#4c545d`, min. 6,02). Die Leiter
  bliebe heller (L\* 35,3), aber 6 : 1 hat weder in WCAG noch in der Prüfliste eine Grundlage.
  Die Ausnahmelisten in vier Gates blieben dauerhaft. Auch B müsste `gedaempft` abdunkeln
  (`#3c434c`), sonst lägen die Stufen nur 2,5 ΔL\* auseinander. Die Umstimmung bliebe also
  fast gleich groß, nur ohne einheitliche Regel.
- **C — Status quo als Boden 4,5 (WCAG AA) festschreiben.** Kein sichtbarer Eingriff. Damit
  würde aber die Ausnahme zur Regel, Platzhalter als einzige Beschriftung blieben bei Tageslicht
  schwach, und der Nachtwert der Feldhilfe (4,81) läge weiter unter dem Nachtboden 5.

### D2 — Tagesleiter: `gedaempft` und `schwach` rücken gemeinsam

| Stufe | alt | neu | grund | schwächste deckende Fläche | L\* | ΔL\* zur Stufe davor |
|---|---|---|---|---|---|---|
| text | `#111418` | (bleibt) | 15,46 | | 6,2 | |
| text2 | `#2b3138` | (bleibt) | 11,00 | 10,30 | 20,0 | 13,8 |
| gedaempft | `#474e57` | `#363d45` | 9,20 | 8,6 (`flaeche3`) | 25,4 | 5,4 |
| schwach | `#58606a` | `#424a53` | 7,53 | 7,05 (`flaeche3`) | 31,1 | 5,7 |

`schwach` ist der hellste Wert der Grauachse (R, R+8, R+17, der Farbton des Bestands), der auf
`flaeche3` noch 7 : 1 hält. `gedaempft` liegt in der Mitte zwischen `text2` und dem neuen
`schwach`. So schließt sich nebenbei die Lücke von `gedaempft` auf `flaeche3`/`alarmFlaeche`.

Alternative: auch `text2` abdunkeln, für eine gleichmäßige Leiter (etwa 8 ΔL\* je Stufe).
Verworfen, weil `text2` den Lauftext in Listen trägt und den Boden hält. Der Eingriff wäre
breiter als der Befund.

**Maß für „sichtbar“: ΔL\* ≥ 5 zwischen benachbarten Stufen.** Das Kontrastverhältnis zweier
Grautöne zueinander taugt dafür schlecht, weil es auf hellem Grund kleine Unterschiede
überzeichnet. ΔL\* ist annähernd wahrnehmungsgleich. 5 Einheiten liegen deutlich über der
Wahrnehmungsschwelle (etwa 1 bis 2), und den Tagwert 5,4 sieht man nebeneinander. Die Leiter wird
am Tag flacher: der Bereich L\* 6–40 schrumpft auf 6–31. Das ist der Preis für den Boden.

### D3 — Nacht: nur `schwach`, auf `#838b94`

`#7d858e` → `#838b94`: auf jeder deckenden Nachtfläche ≥ 5,11 (`flaeche3`), auf `flaeche2`
(Dialog) etwa 5,2, auf `grund` 5,77. L\* 57,5, also 8,8 unter `gedaempft` (66,3). Der kleinste
Schritt der Achse, `#828a93`, hielte auf `flaeche3` nur 5,04; `#838b94` lässt eine Stufe Puffer,
und die Nachtpalette bleibt nahe am Entwurf.

`rahmenFarben.gesperrt` bleibt an `farbenDunkel.schwach` gekoppelt. Die Prüfungen in
`rahmenKontrast.test.ts` halten weiter (Leistengrund ≥ 4,5, Luminanzabstand zu `gedaempft`
1,52 > 1,4). Nur die Messangabe im Kommentar (heute 5,17) wird nachgezogen. Eine Entkopplung
wäre eine neue Rahmenrolle gegen LFH-434 und ist nicht nötig.

### D4 — Wächter als Unit-Test, Gate im Browser

- **Neuer Wächter** `frontend/src/theme/textstufen.test.ts`. Er rechnet für beide Paletten jede
  Textstufe gegen jede deckende Fläche (Liste als Literal im Test, damit eine neue Fläche
  bewusst aufgenommen wird) und prüft den ΔL\*-Abstand und die Reihenfolge. Er ersetzt den
  Satz „vergleicht nur gegen den bisherigen Stand“. Die Kontrastrechnung folgt
  `rahmenKontrast.test.ts`, die L\*-Rechnung der in `statusFarben.test.ts`. Gilt die Regel des
  Projekts zu geteilten Helfern, kommen beide in eine gemeinsame Testhilfe, statt eine dritte
  Kopie anzulegen.
- **Browser:** Die Augenbraue misst ein neuer Fall in `e2e/hellmodus-kontrast.spec.ts` mit
  `pruefe`/`kontrast` aus `kontrast-kern.ts`, je Modus auf `grund`, `paneel` und `flaeche`.
  Fundstellen: Paneel-Kopf auf `paneel`, eine Kennzahl- oder Datenraster-Augenbraue auf `flaeche`
  und eine Sektions-Augenbraue auf `grund`. Welche Stelle die jeweilige Fläche wirklich trägt,
  klärt der Lauf. Die Messung sichert dazu den gemessenen Grund gegen die Rolle zu.
- **Ausnahmen entfernen:** Die `TERTIAER`-Konstante, die Ausnahmezweige und die Kopfkommentare
  der drei Gates fallen. Im `betroffene-kontrast`-Gate messen die zwei „(LFH-643)“-Fälle gegen
  `minimum`. Die LFH-661-Ausnahme bleibt unberührt.

### D5 — Dokumentation am Wert

Der Kopfkommentar von `farbenHell` und der Abweichungsblock von `farbenDunkel` nennen den
Boden, die neuen Messwerte und die ΔL\*-Regel. Die Zeile „Tagmodus“ in `frontend/AGENTS.md`
(Farbachsen) nennt den Boden für alle Textstufen und verweist auf diese Change. Weitere
Kommentare mit alten Messwerten (`colorTextPlaceholder`: „≥ 5 : 1“, `rahmenFarben`: „5,17“)
werden nachgezogen.

## Risks / Trade-offs

- [Die Tagesoberfläche wirkt dunkler, Tertiärtext tritt weniger zurück] → Die Rangfolge
  sichert ΔL\* ≥ 5. Die Augenbraue unterscheidet sich zusätzlich durch Größe, Versalien und
  Sperrung. Die Abschlussmeldung nennt die Stellen zum Ansehen.
- [Ein Gate ohne Tertiär-Ausnahme findet Text auf einer Fläche, die der Wächter nicht kennt
  (etwa auf einer durchscheinenden Füllung)] → Der Lauf zeigt den Fund mit Messwert. Dann wird
  die Fläche in die Liste des Wächters aufgenommen oder der Baustein korrigiert. Es entsteht
  keine neue Ausnahme.
- [Geteilte Werte ziehen mit: ETB-System-Kante (`schwach`) und -Wort (`gedaempft`)] →
  Kante bleibt ≥ 3 : 1, das Wort wird kontrastreicher. Die `rollen.css`-Literale
  (`--lfh-etb-system-*`, `--lfh-rahmen-gesperrt`) hält `rollen.guard.test.ts` deckungsgleich.
- [Snapshot- oder Literal-Tests pinnen alte Hexwerte] → Die Suche nach `#58606a`, `#474e57`
  und `#7d858e` außerhalb von `docs/` findet heute nur `tokens.ts` und `rollen.css`. Pins auf
  `farbenDunkel.schwach` (`statusFarben.test.ts`) lesen die Rolle und ziehen mit.

## Migration Plan

Reine Frontend-Werte, kein Datenbestand. Ein Rückbau ist ein Revert des Commits.
