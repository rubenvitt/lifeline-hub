# Design

## Context

antds `Tag` mit einem Preset (`color="blue"`) färbt Text, Fläche und Rand aus antds eigener
Presetpalette (Stufe 1/3/7 bzw. im dunklen Algorithmus die abgeleiteten Töne). Die Rollen in
`theme/tokens.ts` erreichen das Preset nicht. Ein `Tag` ohne `color` liest dagegen die globalen
Tokens: Text `colorText` (= Rolle `text`), Fläche `colorFillQuaternary` (`defaultBg`), Rand
`colorBorder` (= `steuerRahmen`). Die Demo-Marke (`components/DemoMarke.tsx`, LFH-733 D5) nutzt
genau das und begründet: „Blau schiede aus, weil Blau bedient“.

Der bestehende Guard 2 in `theme/statusVertrag.guard.test.ts` scannt jedes `<Tag …>` im Baum,
löst Umbenennungen des Tags auf, überspringt Kommentare und Zeichenketten und liest die
`color`-Prop auf Attributebene (`farbAusdruck`). Ein Import aus einer `*.test.ts` ist dort
ausdrücklich ausgeschlossen (doppelte `describe`-Läufe).

## Goals / Non-Goals

**Goals:**
- Jede heutige blaue Marke hält den Textboden und trägt keine Bedienfarbe.
- Eine neue blaue Marke wird im Gate rot.

**Non-Goals:**
- Die übrigen Presets an `Tag` (`green`, `red`, `orange`, `gold`, `purple`, `cyan`,
  `geekblue` außerhalb der Funk-Erreichbarkeit, `magenta`, `processing`). Sie haben vermutlich
  dasselbe Kontrastproblem. Gemessen wird das hier nur, um den Nachzug zu begründen (Task 3.2),
  umgestellt wird es nicht. Das Ticket schneidet Blau, weil Blau zusätzlich die Bedeutung
  „bedient“ trägt.
- Statusmarken (`StatusTag`, `SichtungsTag`): Sie haben ihren eigenen Vertrag.
- Keine neue Farbrolle, keine Änderung an `antdToken`/`antdKomponenten`.

## Decisions

### D1 Neutral statt Bedienrolle

Die Marken werden zu `Tag` ohne `color`.

- **Verworfen: `bedienText` auf `bedienFlaeche`** (Tag 8,04, Nacht 9,65 laut `tokens.ts`). Das
  hielte den Boden, behielte aber Blau an etwas, das nicht bedient. Das widerspricht „Blau
  bedient“ und der Präzedenz der Demo-Marke. Es bräuchte außerdem `style` je Stelle oder eine
  eigene Komponente, also eine vierte Darstellungssorte, die `statusFarben.ts` benennen müsste.
- **Verworfen: `StatusChip`/`StatusTag`.** „ad-hoc“, „Führungskraft“, eine Registriernummer und
  eine Sprechgruppe sind kein Status. Sie gehören weder in den Vertrag noch an `wort`/Rolle.
- **Gewählt: neutral.** Das Wort trägt die Bedeutung (WCAG 1.4.1 bleibt erfüllt, weil Blau nie
  der einzige Kanal war), die Umrandung die Form. Der Text ist `text` auf einer fast
  transparenten Fläche über dem Grund, gemessen im Browser an „ad-hoc“: Tag 16,94 : 1, Nacht
  12,87 : 1 (Task 2.1).

### D2 Die Ampel der Besatzungsstärke

`BesatzungsStaerkeBadge` zeigt blau „kein Soll hinterlegt“, grün „erfüllt“, rot „unterbesetzt“.
Blau stand dort für „kein Urteil möglich“. Neutral sagt das genauer als eine Signalfarbe. Grün
und Rot bleiben in dieser Change unverändert (Non-Goals). Der Dateikommentar wird auf „neutral“
fortgeschrieben, der `title` bleibt der zweite Kanal.

### D3 TMO und DMO als Paar

Die Funk-Erreichbarkeit zeigt TMO-Sprechgruppen blau und DMO-Sprechgruppen `geekblue`. Würde nur
TMO neutral, stünde DMO als einzige farbige Marke da und läse sich wie hervorgehoben. Beide werden
neutral. Das Präfix „TMO:“/„DMO:“ unterscheidet sie schon heute im Wort. Der Guard verbietet nur
`blue`, `geekblue` fällt unter den Nachzug (Non-Goals). Dasselbe gilt für den Kacheltyp der
Online-Kartenquellen (`vektor` blau, `raster` `geekblue`), den erst der Guard fand: beide
neutral, das Wort ist der Drahtwert selbst.

### D4 Guard im bestehenden Tag-Scanner

Ein dritter `describe`-Block in `theme/statusVertrag.guard.test.ts` (Guard 3) nutzt die
vorhandenen Bausteine (`lieseQuellen`, `tagNamenIn`, `tagEnde`, `farbAusdruck`,
`literalInhalte`, `ohneKommentare`). Er meldet jedes `Tag`, dessen `color`-Ausdruck das Literal
`blue` enthält, auch in einem Ausdruck (`color={x ? 'blue' : 'default'}`).

- **Verworfen: eigene Guard-Datei.** Sie müsste den Scanner kopieren (Import aus einer
  `*.test.ts` ist gesperrt) und hätte die Blindflecken doppelt zu pflegen.
- **Verworfen: ESLint-Regel.** Das Projekt führt Bauform-Guards als Vitest-Guards
  (`dichte.guard.test.ts`, Guard 1/2).
- Er gilt im ganzen Baum, auch in der Vertragsdatei. Er trägt keine Schuldmenge, weil alle
  Fundstellen in derselben Change fallen. Die Blindflecken des Dateikopfs gelten auch für ihn;
  der Kopf nennt Guard 3 mit.

### D5 Nachweis an zwei Listen

Ein neuer Spec `e2e/marken-kontrast.spec.ts` seedet per API eine Ad-hoc-Kraft und ein
Ad-hoc-Fahrzeug und misst die Marke „ad-hoc“ in Personal- und Fahrzeugliste mit `pruefe`
(`kontrast-kern.ts`), Tag ≥ 7 und Nacht ≥ 5, Böden als Literale. Die Messung läuft gegen die
eigene Fläche der Marke (`grund: 'selbst'`), komponiert über die Vorfahren. Das deckt die
Ticketforderung „mindestens eine Fundstelle je Modus“ ab. Die übrigen Stellen nutzen dieselbe
Bauform (`Tag` ohne `color`) und hängen an denselben Tokens.

## Risks / Trade-offs

- [Die neutrale Marke tritt optisch zurück, „ad-hoc“ fällt weniger auf] → Gewollt: Herkunft ist
  keine Lageinformation, die ins Auge springen muss. Das Wort bleibt und steht an derselben
  Stelle.
- [antd ändert `defaultBg` in einer späteren Version] → Der Browser-Nachweis misst die
  tatsächlich gezeichnete Fläche und wird dann rot.
- [Der Guard sieht keine Indirektion (`const f = 'blue'`)] → Derselbe dokumentierte Blindfleck
  wie bei Guard 2. Ein Fehlalarm oder eine Lücke ist in Minuten geklärt.
