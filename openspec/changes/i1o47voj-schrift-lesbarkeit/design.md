# Design

## Context

Der Scope-Scan vom 15.11.2026 hat am Code bestätigt, was die Messung zeigt:

- `theme/tokens.ts:746` `schriftskala` kennt zehn Rollen mit 9, 10, 11, 12, 14, 22, 30, 32 und
  40 px; `dichten` setzt antds Grundschrift auf 13,5 / 15 / 15. `rollen.css:181–206` spiegelt
  die Skala als `--lfh-typo-*`, `rollen.guard.test.ts` hält beide gleich.
- Im Code stehen rund 240 `fontSize`-Literale in 180 Dateien (häufigste Werte 12 ×121, 13 ×51,
  11 ×33) und rund 400 Aufrufe `monoStil(<px>)` (`components/instrument/rollenwerte.ts:77`),
  dazu `font-size`-Literale in 12 CSS-Dateien (22 davon in `hilfe/Hilfe.css`). Nur 31 Stellen
  lesen `schriftskala`.
- `index.html:13` sperrt den Zoom (`maximum-scale=1.0, user-scalable=no`), Wächter
  `theme/keinZoom.guard.test.ts`, Regel in `frontend/AGENTS.md` „Kein Zoom wie in einer App“.
- `Augenbraue` (`components/instrument/Augenbraue.tsx`) ist Paneeltitel und zugleich Feldetikett
  (`Datenraster.tsx:61`, `als="dt"`), rund 270 Felder hängen daran.
- `schriftskala.meta` ist Mono; `paneelMetaStil`, `seitenMetaStil` und die Meta-Zeilen der
  Bausteine setzen damit Wörter in JetBrains Mono.

Abgestimmt mit Ruben am 15.11.2026 (Kommentar an LLH-1719): Stufen 11/12/14/16/22/32, Faktor
1 / 1,15 / 1,25, Zoom ganz frei, Feldetiketten gemischt geschrieben (Köpfe behalten Versalien),
`meta` in Archivo, und der ganze Bestand wird in diesem PR umgestellt, ohne Schuldmenge.

## Goals / Non-Goals

**Goals:**

- Eine Skala mit sechs Größen, aus der jede Schriftgröße am Schirm kommt; kein Text unter 11 px.
- Die Schrift wächst mit der Dichte an einer einzigen Stelle, beim ersten Paint richtig.
- Ein Wächter, der jedes neue Größen-Literal rot macht.
- Feldetiketten und Metazeilen in der Textschrift, lesbar gesetzt.
- Der Zoom ist frei.

**Non-Goals:**

- Druckansichten (`druck/`, `lageplanDruck.css`, `skizzeDruck.css`): sie rechnen in pt auf
  Papier und bleiben, wie sie sind.
- Text auf der MapLibre-Karte (`text-size` der Kartenstile) und in den taktischen Zeichen: das
  ist Kartenmaßstab, keine Oberflächenschrift.
- Die Fernsicht-Skala des Lagemonitors (`GROSS` in `geraet/LagemonitorPage.tsx`): sie wird nur
  benannt ins Theme gezogen, ihre Werte bleiben.
- Eine eigene Einstellung „Schrift größer“: der freie Zoom deckt das ab.
- Farbrollen und Kontrastböden: unverändert.

## Decisions

### 1. Sechs Größenstufen, Rollen darüber

`theme/tokens.ts` bekommt `groessenstufen` als einzige Liste der Größen:

| Stufe | `kompakt` | wächst mit der Dichte |
| --- | --- | --- |
| `fein` | 11 | ja |
| `klein` | 12 | ja |
| `text` | 14 | ja |
| `titel` | 16 | ja |
| `wert` | 22 | nein |
| `gross` | 32 | nein |

`schriftskala` bleibt die Liste der Rollen, nennt aber statt einer Pixelzahl eine Stufe:
`ueberschrift` gross/600, `seitentitel` titel/600, `uhr` titel/500 Mono (neu), `text` text/400,
`textKlein` klein/400, `warnung` text/600 (neu), `etikett` klein/400 (neu, Feldetikett),
`augenbraue` fein/600 Versalien .08em, `railEtikett` fein/500 Versalien .04em, `meta` klein/400
**Textschrift**, `datenwertKlein` wert/500 Mono, `datenwert` und `datenwertGross` gross/500 Mono.
`ueberschrift` (30) und `datenwertGross` (40) fallen damit auf 32. Die Rollennamen bleiben, weil
`rollen.css`, das Design System und rund 30 Aufrufer sie kennen. Die Stufennamen sind deutsch, weil
die Oberfläche sie nicht zeigt, aber Gestalter so sprechen (Bezeichner-Regel: im Zweifel deutsch).

*Verworfen:* Die sechs Größen ersetzen die Rollen ganz. Dann trüge jeder Aufrufer Gewicht,
Familie und Versalien selbst, und die Augenbraue zerfiele in Einzelteile.

### 2. Kopplung an die Dichte über eine CSS-Variable

`rollen.css` setzt `--lfh-schrift-faktor` auf `:root` (1) und in den bestehenden Blöcken
`[data-dichte='komfortabel']` (1,15) und `[data-dichte='handschuh']` (1,25). Jede
`--lfh-typo-<stufe>-groesse` der vier wachsenden Stufen ist `calc(<px> * var(--lfh-schrift-faktor))`;
`wert` und `gross` stehen fest. Das Merkmal `data-dichte` sitzt schon vor dem ersten Paint am
`<html>`, also ist die Größe beim ersten Bild richtig.

TS liest Größen nur über `schriftStil(rolle)` und `zahlStil(stufe, gewicht)` aus `rollenwerte.ts`.
Beide geben `fontSize: 'var(--lfh-typo-<stufe>-groesse)'` zurück, keine Zahl. Wo eine Zahl
gebraucht wird (Höhenrechnung, antd-Token, Canvas), liefert `schriftPx(stufe, dichte)` sie aus
derselben Tabelle mal `dichteFaktor[dichte]`; `rollen.guard.test.ts` hält Faktor und Werte auf
beiden Seiten gleich.

antd bekommt in `antdToken(…, dichte)` die Größen aus der Tabelle mal Faktor: `fontSize` =
text, `fontSizeSM` = klein, `fontSizeLG` = titel, `fontSizeXL` = wert, `fontSizeHeading1` = gross,
`fontSizeHeading2` = wert, `fontSizeHeading3`/`4` = titel, `fontSizeHeading5` = text. Damit
entfallen die 13,5 / 15 / 15 in `dichten` (`schriftgroesse` wird aus Stufe und Faktor gerechnet),
und die Folgerechnungen (Switch-Spur, Klappkopf, Kästchen) laufen mit, weil sie schon aus
`stufe.schriftgroesse` rechnen. Die Kontrastbegründung des Primärknopfs (`tokens.ts:184`,
„Knopfschrift misst 13,5 px“) wird auf 14 px nachgezogen.

*Verworfen:* rem-Skala über `html { font-size }`. Sie respektierte auch die Systemschrift, aber
antd rechnet in px-Zahlen, und alle Abstände müssten mit auf rem. Größerer Umbau, gleiches
Ergebnis.

### 3. Der Zoom ist frei

`index.html`: `content="width=device-width, initial-scale=1.0"`. `touch-action: manipulation` auf
`html` bleibt (kein Doppeltipp-Zoom, kein Klickverzug). `keinZoom.guard.test.ts` wird zu
`zoomFrei.guard.test.ts`: kein `maximum-scale`, kein `user-scalable=no`, `manipulation` bleibt.
iOS zoomt beim Fokus in ein Feld unter 16 px. In `komfortabel` misst die Feldschrift 14 × 1,15 =
16,1 px, also kein Fokus-Zoom auf Touchgeräten, die von selbst in `komfortabel` starten. Wer auf
einem iPhone `kompakt` wählt, bekommt den Fokus-Zoom; das ist hingenommen.

### 4. Ein Wächter gegen Literale, ohne Schuldmenge

ESLint mit `--max-warnings 0` würde rot geboren, deshalb ein Vitest-Wächter nach dem Muster von
`cssFarbquelle.guard.test.ts`: `theme/schriftLiteral.guard.test.ts` liest alle Quellen unter
`frontend/src` (ohne Tests und ohne das Theme) und meldet:

- `fontSize:` und `fontSize=` mit Zahl, Zahlstring oder Template-Literal;
- `font-size:` in CSS, das nicht `var(--lfh-typo-…)` oder `inherit` ist, außer in den
  Druck-Dateien (benannte Liste, pt);
- `monoStil(` (der Name verschwindet);
- `fontFamily` mit `monospace` oder `ui-monospace` außerhalb des Themes.

Erlaubt bleiben `token.fontSize*` (antd, gekoppelt) und Werte aus `schriftskala`, `zahlStil` und
`fernsicht`. Die Fernsicht-Skala zieht als `fernsicht` nach `theme/tokens.ts`. Es gibt keine
Liste OFFEN: der Bestand wird vorher ganz umgestellt.

### 5. Migrationsregel für den Bestand

Jede Größe fällt auf die nächste Stufe, nach Rolle im Kontext:

| alt | neu | Ausnahme |
| --- | --- | --- |
| 8, 9, 10, 11 | `fein` | – |
| 12 | `klein` | – |
| 13 | `text` (Lauftext, Bedientext, Zellen) | `klein`, wenn es eine Nebenzeile unter oder neben 14er Text ist |
| 13,5, 14, 15 | `text` | – |
| 16, 18, 20 | `titel` | – |
| 22, 24 | `wert` | – |
| 28, 30, 32, 40 | `gross` | – |

`monoStil(n, g)` wird `zahlStil(stufe, g)` nach derselben Tabelle, wenn der Inhalt ganz Zahl,
Zeit, Kennung oder Funkrufname ist; sonst `schriftStil` mit der passenden Rolle in der
Textschrift (Entscheidung 7). `monoStil(token.fontSize)` wird `zahlStil('text')`. SVG-Text
bekommt die Größe über `style`, nicht als Attribut, damit `var()` greift. Die Umbenennung
`monoStil` → `zahlStil` ist ein eigener `refactor`-Commit (Bezeichner-Regel).

### 6. `Schrift` und `Feldetikett` als Bausteine

`components/instrument/Schrift.tsx`: `<Schrift rolle="meta" als="span">` setzt `schriftStil`
und optional einen Ton (`text2`, `gedaempft`, `schwach`). Der Name ist nicht `Text`, weil viele
Dateien antds `Typography.Text` als `Text` importieren.

`components/instrument/Feldetikett.tsx`: Rolle `etikett`, Ton `gedaempft`, gemischt geschrieben,
ohne Sperrung, `als="dt" | "label" | "span"`. `Datenfeld`, `DatenfeldEingabe` und `FeldLabel`
nutzen es. `Augenbraue` verliert `'dt'` aus `AugenbraueElement`; ein Feldetikett per Augenbraue
kompiliert dann nicht mehr. Die rund 44 Augenbrauen als `span` werden einzeln gesichtet: Was ein
Feld benennt, wird Feldetikett; Paneelköpfe, Kennzahl-Titel, Tabellenköpfe und Gruppenköpfe
bleiben. Die Kontrastmessung der Augenbraue (`textstufen-kontrast`, Messstelle „Betroffene“)
zieht auf eine verbleibende Augenbraue um, falls die bisherige ein Feldetikett wird; die
Anforderung selbst bleibt.

### 7. Mono-Grenze

`schriftskala.meta` wechselt auf die Textschrift. `schriftStil` gibt jeder Rolle
`fontVariantNumeric: 'tabular-nums'` mit (Archivo hat `tnum`). Damit wechseln
`paneelMetaStil`, `seitenMetaStil`, der Datenstand und die Metazeilen von `Zeitachseneintrag`,
`ListenPaneel`, `Schnellerfassungszeile`, `Sammelbanner` und `Aufgliederung` zentral. Gemischte
Knoten stehen ganz in Archivo, keine Span-Zerlegung. In Mono bleiben: Zeiten (`ZeitAnzeige`),
Zahlen und Kennzahlen, Kennungen (ETB-Nummer, Einsatznummer, Typwort der Zeitachse, `/typ`,
Tastenkürzel, Wortmarke, FMS-Kürzel) und Funkrufnamen.

Durchsetzung: Der Literal-Wächter (Entscheidung 4) verbietet freie Mono-Familien. Dazu misst eine
e2e-Spec auf Überblick, ETB, Einsatzdaten und Betroffenen jeden Mono-Textknoten: er darf kein Wort
aus vier oder mehr Kleinbuchstaben enthalten, außer er steht in einem Element mit
`data-schrift="kennung"` (Funkrufnamen). `zahlStil` setzt kein Attribut; die Bausteine für
Funkrufnamen setzen es.

### 8. Rail-Etikett und Seitenkopf

Das Rail-Etikett wächst von 9 auf 11 px. Damit „FÜHRUNG“ und „ERFASS.“ in die 60-px-Rail passen,
sinkt die Sperrung auf .04em; reicht das nicht, werden die Kurzetiketten gekürzt, die Rail bleibt
60 px breit. `e2e/rail-etikett.spec.ts` misst den Überlauf. Der Seitentitel in 16 px passt in den
44-px-Kopf (16 × 1,4 = 22,4 px bei 37 px Innenhöhe); die Uhr in `Kopfleiste.tsx:189` liest die
Rolle `uhr`.

## Risks / Trade-offs

- **Sehr großer, sichtbarer Diff** (rund 190 Dateien) → Migration nach Bereichen in eigenen
  Commits; die Tabelle in Entscheidung 5 macht jede Zeile nachprüfbar; Bilder je Bereich im PR.
- **Layout-Verschiebungen in `komfortabel` und `handschuh`** (Tabellenspalten, Kennzahlenbänder,
  ETB-Zeilenhöhe, Seitenkopf auf 390 px) → e2e-Messungen der Trefffläche, des Seitenkopfs und
  des Rail-Etiketts in allen drei Stufen; `wert`/`gross` wachsen bewusst nicht.
- **e2e- und Unit-Pins auf alte Pixelwerte** (Augenbraue „10px“, Brotkrume 12 px,
  `rollen.guard.test.ts:419`) → werden mit den neuen Werten als Literal gepinnt, Quelle
  „umgekehrt 15.11.2026“.
- **Fokus-Zoom auf iOS in `kompakt`** → hingenommen (Entscheidung 3).
- **Anwender-Doku-Bilder** ändern sich überall → der Bildlauf wird nach dem Merge neu gefahren,
  nicht in diesem PR (eigene Aufgabe über `zunder-task-anlegen`).
- **13 → 14 oder 12** ist eine Ermessensfrage je Stelle → Standard `text`, Ausnahme nur mit
  sichtbarer Nebenrolle; der Review prüft die Stichproben.
