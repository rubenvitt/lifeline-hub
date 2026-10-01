# Design

## Context

Den Anlass beschreibt `proposal.md`. Zum Stand:

- **Messkern.** `pruefe()` in `frontend/e2e/kontrast-kern.ts` misst in einer `toPass`-Schleife
  (10 s) und gibt beim ersten Versuch ≥ Boden auf. Gedacht war das für die Einblendung von
  Dialogen: Während der Opacity-Animation wirft `messe()` einen Fehler, und `toPass` versucht es
  erneut. Bei einem Farbübergang wirft `messe()` aber nicht. Die Hintergrundfarbe einer
  antd-Tabellenzelle geht unter dem Zeiger per CSS-Transition von `flaeche` (weiß) nach
  `flaeche3` über. Ein Versuch während des Übergangs liest einen helleren Grund, besteht und
  beendet die Schleife. Ob der Test grün ist, hängt deshalb davon ab, wann gemessen wird. Lokal
  war er 3 von 3 Mal rot, im CI mal grün.
- **Palette.** Gerechnete Werte nach WCAG gegen die opaken Rollenflächen, Tag:

| Textrolle | grund | flaeche | flaeche2 | kopf | paneel | flaeche3 | bedienFlaeche | alarmFlaeche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bedienText` alt `#164f86` | 7,04 | 8,41 | 7,78 | 7,36 | 7,71 | **6,59** | 7,11 | **6,86** |
| `bedienText` neu `#144779` | 7,97 | 9,51 | 8,80 | 8,33 | 8,72 | 7,46 | 8,04 | 7,76 |
| `gedaempft` alt `#474e57` | 7,05 | 8,42 | 7,78 | 7,37 | 7,71 | **6,60** | 7,12 | **6,86** |
| `gedaempft` neu `#40464e` | 7,98 | 9,53 | 8,81 | 8,34 | 8,73 | 7,47 | 8,06 | 7,77 |
| `text2` `#2b3138` (unverändert) | 11,00 | 13,13 | 12,14 | 11,49 | 12,04 | 10,30 | 11,10 | 10,71 |

  Nachts liegen beide Rollen auf jeder Flächenstufe über 5 (`bedienText` ≥ 9,34, `gedaempft` ≥
  6,83, s. LFH-652). Die Nacht bleibt deshalb unberührt.
- `flaeche3` ist laut Leitlinie die Hervorhebungsfläche am Tag (LFH-618). Sie wird in rund 25
  Dateien genutzt, außer für die Hover-Zeile der `KatalogTabelle` (`tabellenTokens.rowHoverBg`)
  auch für Aktiveinträge in Rail, Modulpanel, Segmentleiste und Liste.

## Goals / Non-Goals

**Goals:**
- Jeder Kontrastnachweis misst den eingeschwungenen Wert. Rot oder grün hängt nicht mehr vom
  Zeitpunkt ab.
- `bedienText` und `gedaempft` halten am Tag 7 : 1 auf jeder Flächenstufe, die als Grund für Text
  vorkommt, auch auf der Hervorhebung `flaeche3`.

**Non-Goals:**
- `schwach` auf `flaeche3` (4,99): Die tertiäre Stufe gehört zu LFH-643.
- Nachtpalette, `flaeche3` selbst und die Hover-Fläche der Tabelle bleiben unverändert.
- Lokale Überschreibungen mit `bedienText` (`Datensicht`, `InlineAngabe`, `BemerkungZelle`,
  `EtbAnhaenge`, `personBearbeiten`): Sie lesen die Rolle und ziehen von selbst mit.

## Decisions

### E1 — Die Messung wartet auf den eingeschwungenen Zustand

`kontrast-kern.ts` erhält einen Schritt `eingeschwungen(ziel)`, den `pruefe()` vor jedem
Messversuch aufruft. Er läuft im Browser:

1. `getComputedStyle(element)` stößt die Stilberechnung an. Erst danach existieren Transitions,
   die ein gerade gesetztes `:hover` auslöst.
2. Aus `document.getAnimations()` werden die Animationen gefiltert, deren Ziel (`effect.target`)
   das Element selbst oder einer seiner Vorfahren ist. Endlos laufende Animationen
   (`iterations === Infinity`, etwa ein Ladekreisel) bleiben außen vor.
3. Auf deren `finished` wird mit einer Obergrenze gewartet. Läuft die Obergrenze ab, ist das ein
   Fehler und keine Messung.

Der Schritt sitzt in `messe()` und gilt damit für `pruefe`, `kontrast` und `randKontrast`
(Review-Befund: zuerst hing er nur an `pruefe`, die Spec gilt aber jedem Nachweis). Einen
Zustand, den erst JavaScript setzt, sieht er nicht kommen: antds Zeilen-Hover ist die Klasse
`ant-table-cell-row-hover` aus `onMouseEnter`, kein `:hover`. Der Test sichert ihn deshalb vorher
als Vorbedingung zu.

`toPass` bleibt um den Messversuch herum stehen, und zwar für den ursprünglichen Zweck: Ein Dialog
kann noch gar nicht im DOM sein, oder eine Animation startet erst einen Frame später. Weil jeder
Versuch zuerst einschwingt, misst schon der erste Versuch den Endwert. Liegt der unter dem Boden,
bleibt jeder weitere Versuch rot, und `toPass` scheitert nach Ablauf. Der Test ist damit
deterministisch rot.

- **Verworfen: eine feste Wartezeit nach `hover()`.** Sie hängt an der Dauer der Transition in
  antd und an der Last der Maschine. Genau das soll wegfallen.
- **Verworfen: zwei gleiche Messwerte in Folge verlangen.** Zwei Frames mit gleichem Zwischenwert
  sind bei Easing-Kurven möglich. `getAnimations()` liefert den Zustand selbst und muss ihn nicht
  aus Werten erraten.
- **Verworfen: Transitions im Test abschalten** (`reducedMotion`, Stil-Injektion). Gemessen würde
  dann eine Seite, die niemand so sieht. Den eingeschwungenen Wert sieht der Nutzer, und an ihm
  wird gemessen.

### E2 — Textrollen am Tag abdunkeln statt Fläche aufhellen

`farbenHell.bedienText` wird `#144779`, `farbenHell.gedaempft` wird `#40464e`. Beide Werte sind
die alten Kanäle mal 0,9: gleicher Farbton, gleiche Sättigung, nur dunkler. Der Abstand zu 7 : 1
beträgt auf `flaeche3` knapp 0,5 und deckt Rundung und Kantenglättung ab. `theme/rollen.css`
spiegelt beide Werte (`--lfh-bedien-text`, `--lfh-gedaempft`, Tagblock). Die ETB-Typfarbe
`system.wort` zeigt in `etbTypFarbenHell` auf `farbenHell.gedaempft` und zieht mit, also auch ihr
Spiegel `--lfh-etb-system-wort` (beim Umsetzen festgestellt, `rollen.guard.test.ts`).

Am Phase-1-Checkpoint entschieden (LFH-702, 01.10.2026):
- **Verworfen: `flaeche3` aufhellen.** Für 7 : 1 mit dem alten `bedienText` müsste `flaeche3` bei
  etwa `#e9ebee` liegen, und das ist `grund`. Damit wäre die Hervorhebung auf dem Seitengrund
  verschwunden, in rund 25 Dateien.
- **Verworfen: nur `rowHoverBg` auf `kopf` (`#eef0f2`, 7,36).** Das bleibt lokal: Aktiveinträge
  und andere Hervorhebungen auf `flaeche3` blieben unter 7. Die Hover-Zeile hätte außerdem den Ton
  des Kopfbands, und ihr Abstand zu Weiß fiele von 1,28 auf 1,14.
- **Verworfen: Hover als benannte Ausnahme.** Der Unterschuss bliebe bekannt und gewollt bestehen.
  Die Aktivzeile ist dabei nicht vorübergehend.

Kosten: Links und Beschreibungstext rücken am Tag näher an den Lauftext. `bedienText` gegen
`text` fällt von 2,20 auf 1,94, `gedaempft` gegen `text2` in der Leuchtdichte von 1,56 auf 1,38.
Ein Link bleibt an Farbton und Sättigung erkennbar, die zweite Stufe an Größe und Gewicht. Das
nehmen wir in Kauf, weil der Boden am Tag die Lesbarkeit im Freien trägt (Kriterium 5).

### E3 — Nachweis

- **Einheit, gerechnet:** `theme/bedienKontrast.test.ts` (oder ein Nachbar-Describe dort)
  rechnet `bedienText` und `gedaempft` gegen jede Flächenstufe, die Text trägt (`grund`,
  `flaeche`, `flaeche2`, `kopf`, `paneel`, `flaeche3`), Tag ≥ 7, Nacht ≥ 5. Die Böden stehen als
  Literale. `rollen.guard.test.ts` hält den CSS-Spiegel schon heute gleich.
- **Browser:** `e2e/dokumente.spec.ts` misst im Kontrasttest Titel-Link und „—“ zusätzlich mit
  dem Zeiger über der Zeile. `e2e/betroffene-kontrast.spec.ts` behält „Zustand-Knopf
  leer+hover“ unverändert und ist jetzt deterministisch.
- **Befund beim Umsetzen:** Seit LFH-652 trägt ein Link-Knopf unter dem Zeiger die eigene Fläche
  `bedienFlaeche` (`Button.linkHoverBg`). Der Zustand-Knopf der Betroffenenliste misst deshalb auf
  `alpha` schon mit dem alten `bedienText` 7,11. Der Wert 6,59 auf `flaeche3` aus LFH-702 stammt
  von einem Stand davor. Ohne eigene Fläche stehen Titel-Anker und „—“ einer Tabellenzeile, und
  an ihnen wird die Zeitabhängigkeit belegt.
- **Determinismus-Probe:** Mit den alten Werten und dem neuen Messkern ist der Kontrasttest der
  Dokumentenablage (light) mit `--repeat-each 3` in 3 von 3 Läufen rot (6,59 auf `flaeche3`). Mit
  den neuen Werten ist er 3 von 3 grün.
- **Mutationsproben:** (a) Den Einschwing-Schritt in `pruefe()` auskommentieren: Die Probe oben
  wird wieder zeitabhängig (mindestens ein grüner Lauf mit altem Wert, belegt das Problem).
  (b) `bedienText` zurück auf `#164f86`: Der Einheitstest auf `flaeche3` und die Hover-Messung
  werden rot. (c) `gedaempft` zurück: Einheitstest und „—“ unter dem Zeiger werden rot.

## Risks / Trade-offs

- [Der strengere Messkern macht weitere Hover-Messungen rot, die bisher nur zufällig grün
  waren] → Alle Kontrast-Specs laufen in beiden Modi mit `--repeat-each 3`. Fällt dabei eine
  Stelle mit `bedienText`/`gedaempft` auf, löst die Palette sie. Bei einer anderen Rolle
  (etwa `schwach`) ist das ein Blocker, den der Mensch entscheidet. Es gibt keine stille
  Ausnahme und keinen gesenkten Boden.
- [Eine Animation endet nie, etwa ein Lade-Shimmer an einem Vorfahren mit endlicher, aber langer
  Laufzeit] → Obergrenze für das Warten. Wer sie überschreitet, bekommt einen Fehler mit dem Namen
  der Animation und ihres Ziels, kein stilles Bestehen.
- [Links wirken am Tag etwas schwerer] → Gewollt, s. E2. Nachts ändert sich nichts.
- [Literal `#164f86` in `personen/personBearbeiten.test.ts`] → Es ist ein Eingabewert einer
  reinen Stilfunktion und keine Rollenbehauptung. Er wird auf die Rolle umgestellt
  (`farbenHell.bedienText`), damit kein alter Wert stehen bleibt.

## Migration Plan

Keine Daten und kein Server betroffen. Die Werte wirken mit dem nächsten Frontend-Build. Rücknahme
ist ein Revert.
