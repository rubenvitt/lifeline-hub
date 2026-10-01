# Design

## Context

Motivation in `proposal.md` („Why“), Anforderung in
`specs/einsatztauglichkeit-layout/spec.md`.

Stand heute (`frontend/src/components/instrument/Kennzahl.tsx`):

- `kennzahlenbandStil` legt ein Grid mit `gap: 1` auf `linie` an, jede Zelle trägt `flaeche`
  über die Klasse `.lfh-kennzahl` (`theme/sprache.css`). Die Linien des Rasters sind also der
  durchscheinende Bandgrund.
- Mit `ziel` ist die **ganze Zelle** ein `<Link className="lfh-kennzahl lfh-kennzahl--ziel">`.
  `kennzahlStil` gibt ihr `minHeight: controlHeight` (30 / 48 / 72) und die Polsterung
  `padding` / `paddingLG` (handschuh 26 / 44 px). Hover tönt die Zelle `flaeche3`, Fokus
  zeichnet einen nach innen versetzten 2-px-Rahmen.
- Klickbare Bänder: Lage-Dashboard „Lage in Zahlen“ (sechs Links, Gate 3 misst ihre Höhe) und
  Führung · Überblick. Alle anderen Bänder haben keine Ziele.
- Prüfanker, auf die sich Tests stützen: `a[data-lfh="kennzahl"]` (Gate 3,
  `pegel-pruefliste`, `lage-dashboard-schmal`), `[data-lfh="kennzahl"][data-ton]` mit
  `kennzahl-wert`/`kennzahl-notiz` darin (Kontrast-Specs), `kennzahlStil(...).boxShadow`
  (Unit-Test der Eskalationskante).

## Goals / Non-Goals

**Goals**

- Abstand zwischen Treffflächen nach Stufe (Spec), Fugenraster bleibt 1 px.
- Keine optische Verschiebung von Zahl, Augenbraue, Notiz; keine Höhenänderung der Zelle;
  `kompakt` pixelgleich mit dem Bestand.
- Keine Änderung an den Verbrauchern, keine geänderten Prüfanker.

**Non-Goals**

- Andere Fugenraster-Bausteine mit Bedienzielen (`Segmentleiste`, Kartenknöpfe) — Nachzug.
- Eine allgemeine „Abstandsregel“-Infrastruktur für alle Raster. Der Einzug bleibt eine
  Eigenschaft der Kennzahl-Zelle.

## Decisions

### D1 · Trefffläche innerhalb der Zelle (statt breiterer Fuge)

Die Zelle bleibt die Fläche im Raster, der Link wird ein Block **in** ihr, der zu jedem
Zellrand den Einzug `e` hält. Zwischen zwei Treffflächen liegen dann `2e + 1` px: Zellfläche,
Fuge, Zellfläche.

Erwogene Alternativen:

- **A · dichteabhängige Fuge** (`gap: 16` in `handschuh`): Der Bandgrund `linie` schiene als
  16-px-Balken durch. Aus der Haarlinie würde ein Gitter, das Fugenraster der
  Gestaltungssprache (`umsetzung.md`: „n Zellen im Fugenraster“) wäre in dieser Stufe weg.
  Verworfen, weil der Task das Fugenraster ausdrücklich erhalten will.
- **C · Kacheln mit Zwischenraum** in `handschuh` (Bandgrund transparent, jede Zelle mit
  eigenem 1-px-Rahmen, `gap: 16`): Abstand erfüllt, aber das Band wechselt je Stufe die
  Formensprache (Raster ↔ Kacheln) und wird 75 px breiter pro Reihe. Bei sechs Spalten auf dem
  Führungs-Tablet (1024 px) bricht das Band früher um. Verworfen.
- **D · Trefffläche per `pointer-events`/`clip-path` verkleinern**, ohne neues Element: Der
  `<a>` bliebe so groß wie die Zelle, nur ein Kind wäre trefferfähig. Die gemessene
  `boundingBox()` des Links stimmte dann nicht mehr mit seiner Trefffläche überein; Gate 3
  maße das Falsche, und `clip-path` schnitte zusätzlich den Zellgrund ab (die Linienfarbe
  schiene durch wie in A). Verworfen.

### D2 · Einzug 0 / 4 / 8 px, abgeleitet aus der Steuerhöhe des Themes

`kennzahlZielEinzug(token)` (rein, exportiert, Muster `bedienzielStil`) liefert den Einzug
aus `token.controlHeight`: ab 72 → 8, ab 48 → 4, sonst 0. Die Werte stehen als **Literale**,
die Schwellen sind die Böden der Staffel. Damit gilt: `komfortabel` 2 · 4 + 1 = 9 ≥ 8,
`handschuh` 2 · 8 + 1 = 17 ≥ 16.

Warum `controlHeight` und nicht `useDichte()`: Die Zelle liest ihre Höhe und Polsterung
schon aus dem Token. Eine zweite Quelle (der gespeicherte Dichte-Wert) könnte unter einem
lokal überschriebenen `ConfigProvider` von der gerenderten Stufe abweichen; dann hielte die
Zelle die Höhe der einen und den Abstand der anderen Stufe. Ein Token, eine Wahrheit.

Warum `komfortabel` mit erfasst wird, obwohl der Task nur den Handschuh nennt: Dieselbe
Zeile der Leitlinie (Abstand zwischen Zielen: kompakt Ausnahme, komfortabel ≥ 8 px,
handschuh ≥ 16 px) wird heute auch in `komfortabel` verfehlt, und der Mechanismus ist
derselbe. `kompakt` bleibt bei 0: dort gilt die Spacing-Ausnahme der Leitlinie (Fükw, Maus).

### D3 · Aufbau der klickbaren Zelle

```
<div class="lfh-kennzahl" data-lfh="kennzahl-zelle"      ← Rasterzelle: flaeche, padding e,
     style="position: relative; padding: e">                position: relative
  <Link class="lfh-kennzahl__ziel" data-lfh="kennzahl"   ← Trefffläche: Inhalt, minHeight,
        data-ton=… aria-label=…>                            Polsterung − e
    Augenbraue · Zahl · Notiz
  </Link>
  <span data-lfh="kennzahl-kante" aria-hidden            ← nur bei achtung/alarm: Auflage
        style="position:absolute; inset:0;                  über dem Link, ohne Treffer
               pointer-events:none; box-shadow: inset …"/>
</div>
```

- Der **Link behält** `data-lfh="kennzahl"`, `data-ton` und `aria-label`. Alle Selektoren in
  Tests und e2e treffen weiter die Trefffläche; Gate 3 misst also genau das, was man tippt.
- Die **Zelle** bekommt den Grund (`.lfh-kennzahl`) und `padding: e`.
- Die **Eskalationskante** wird eine Auflage nach dem Link (`inset: 0`,
  `pointer-events: none`, derselbe `inset`-Schatten wie bisher). Sie bleibt so am Zellrand,
  nimmt keinen Treffer und kein Layout. Am Zellgrund selbst ginge das nicht: ein
  `inset`-Schatten malt unter den Kindern seines Elements, die Hover-Tönung des Links deckte
  ihn in `kompakt` (Einzug 0) ganz und in `komfortabel` zur Hälfte der Alarmkante zu
  (Review-Fund während der Umsetzung, im Browser gegengeprüft).
- Der Link bekommt `kennzahlStil` mit um `e` verringerter Polsterung
  (`paddingBlock: padding − e`, `paddingInline: paddingLG − e`) und unverändert
  `minHeight: controlHeight`. Außenmaß der Zelle = Inhalt + Polsterung wie heute.
- Die Aufteilung steht in einer zweiten reinen Funktion (`kennzahlZielStil`, liefert
  `zelle`, `ziel`, `kante`), damit Einzug, Restpolsterung und Kante ohne Render prüfbar sind.
  `kennzahlStil` selbst bleibt für Zellen **ohne** Ziel unverändert.
- `style` des Aufrufers geht an das Element, das `kennzahlStil` trägt (ohne Ziel die Zelle,
  mit Ziel der Link) — wie heute „überschreibt den Zellstil“. Kein heutiger Aufrufer mit
  `ziel` setzt `style`.
- Zellen **ohne** Ziel bleiben ein einzelnes `<div class="lfh-kennzahl" data-lfh="kennzahl">`.

### D4 · Hover und Fokus auf der Trefffläche

`sprache.css`: `.lfh-kennzahl--ziel:hover` / `:focus-visible` wandern auf
`.lfh-kennzahl__ziel` (Hover `flaeche-3`, Fokus 2 px `bedien`, `outline-offset: -2px`,
`cursor: pointer`). Der Link ist sonst transparent, die Zelle zeigt ihren Grund. In `kompakt`
deckt der Link die Zelle, das Bild ist gleich wie heute; die Kante liegt als Auflage (D3) über
der Tönung. In `handschuh` tönt der Hover nur die Trefffläche: man sieht den 8-px-Rand, auf dem
ein Tippen nichts auslöst.

Verworfen: Hover über `:has(> a:hover)` auf die ganze Zelle legen. Das sähe wie heute aus,
würde aber den Rand als trefferfähig ausgeben.

### D5 · Nachweis

- **Gate 3** (`e2e/gate3-trefflaeche.spec.ts`, Block „Lage-Dashboard: Kennzahl-Zellen …“):
  je Stufe zusätzlich der kleinste Abstand jedes der sechs Links zu seinen Nachbarn über den
  vorhandenen Helfer `abstandZuNachbarn` (Bereich: das Band). Soll als Literal: `handschuh`
  ≥ 16, `komfortabel` ≥ 8, `kompakt` nur gemessen und annotiert. Dazu im Handschuh die
  berechnete Fuge: `getComputedStyle(band).columnGap === '1px'` (die Fuge bleibt eine Fuge).
- **Unit** (`Kennzahl.test.tsx`): `kennzahlZielEinzug` mit Literalen je Stufe und die
  Ungleichung `2e + 1 ≥ 16` bzw. `≥ 8`; Restpolsterung + Einzug = Polsterung der Zelle ohne
  Ziel (keine optische Verschiebung); die Kante ist eine Auflage und weder Zelle noch Link
  tragen sie; Render: mit Ziel ist der Link Kind von `[data-lfh="kennzahl-zelle"]`, trägt
  `data-ton`, und die Kantenauflage steht nach ihm im DOM.
- **Mutationsprobe** statt Abdeckung: Einzug testweise auf 0 → Gate-3-Block rot, danach
  zurück.

## Risks / Trade-offs

- [Toter Rand: ein Tippen in die äußeren 8 px einer Zelle löst nichts aus] → Das ist der
  verlangte Abstand, kein Fehler. Der Hover zeigt die Trefffläche; die Trefffläche selbst ist
  weiterhin ≥ 72 px hoch und fast so breit wie die Zelle.
- [Neue Verschachtelung bricht Tests, die die Zelle als `<a>` erwarten] → Der Link behält
  alle Anker; der Zellwrapper bekommt einen eigenen Anker (`kennzahl-zelle`). Vor der
  Umsetzung `grep -rn 'data-lfh="kennzahl"\|lfh-kennzahl' frontend/` und die Treffer
  durchsehen (Stand: acht e2e-Specs, sieben Unit-Tests).
- [Kontrastmessung gegen den falschen Grund, weil der Link jetzt transparent ist] →
  `e2e/kontrast-kern.ts` geht transparente Vorfahren hoch und landet auf der Zellfläche
  `flaeche`, wie bisher. Die Kontrast-Specs laufen im e2e-Gate mit.
- [Die Trefffläche ist in `handschuh` 16 px schmaler als die Zelle] → Die Inhaltsbreite bleibt
  gleich, weil die Polsterung um denselben Betrag sinkt (schmalste Spalte 160 px: Link 144 px,
  Polsterung 2 × 36 statt 2 × 44, Inhalt 72 px wie heute). `lage-dashboard-schmal.spec.ts`
  prüft weiter, dass kein Inhalt aus seiner Zelle läuft.

## Migration Plan

Reine Frontend-Änderung, kein Datenbestand, keine API. Rückweg: Revert des Commits.
