# Design

## Context

Motivation: proposal.md. Ausgangslage auf `alpha` (gemessen):

- `useLagekarteDaten` liefert `alleVerortet` (ohne Betroffene) und `personenVerortet` getrennt.
  Betreuungsstellen stehen schon heute nur bei `betreuungZugriff === 'frei'` in
  `alleVerortet` (`stellenRoh` ist sonst `undefined`). `LagekartePage` baut daraus
  `waehlbar = alleVerortet + personenAufKarte`, wobei `personenAufKarte` nur bei
  `layer.person && personenZugriff === 'frei'` gefüllt ist. `onMarkerWaehlen` sucht
  ausschließlich in `waehlbar`.
- Die Leiste bekommt `verortet = alleVerortet` und zeigt davon nur `uhs`/`schaden`.
- `FreiesZeichenPicker` ist ein kontrollierter Editor aus sechs `Select`s plus Farbe und
  Bezeichnung. Er hängt in der Leiste erst nach „Taktisches Zeichen platzieren“ ein
  (`zeichenPickerOffen`) und im Inspector dauerhaft. Der Inspector reicht heute jede Auswahl
  ungebremst als PATCH weiter; bei Selects fiel das nicht auf, weil erst Enter wählte.
- Auf dem C9-Branch (`worktree-feat+lfh-344-lagekarte-einsatztauglich`, nie gemergt) liegen
  `MarkerSuche.tsx`, `zuletztVerwendet.ts`, ein Raster-Picker und ein entprellter Inspector.
  Sie setzen `BERUEHRUNGSMARKE` aus der C9-`Werkzeugleiste` voraus, die es auf `alpha` nicht
  gibt, und kennen `person`/`betreuungsstelle` nicht.

## Goals / Non-Goals

**Goals:**
- Die C9-Bausteine auf den heutigen Stand heben (Neuentwurf S5, neue Markertypen, Rollen).
- Die Modulsperre der Suche an genau EINER reinen Funktion prüfbar machen.
- Den Inspector gegen Schreibsturm UND gegen stilles Zurückschreiben absichern.

**Non-Goals:**
- Keine Suche in „Nicht verortet“ (die hat ihre eigene) und keine Suche nach Zonen,
  Gefahrengebieten oder Fachebenen-Objekten (keine `KarteMarker`).
- Betroffene bei ausgeschalteter Ebene suchbar machen (siehe D1).
- Keine Virtualisierung des Rasters, kein serverseitiges „zuletzt verwendet“.
- Die übrigen C9-Teile (Werkzeugleiste, Overlay-Slots, Klapp-Leiste) bleiben draußen.

## Decisions

**D1 — Suchquelle ist `waehlbar`, gefiltert durch eine reine Funktion `suchbareMarker`.**
`objektsuche.ts` exportiert `suchbareMarker({ verortet, personen, personenZugriff,
personenEbeneAn, betreuungZugriff })`: sie lässt `betreuungsstelle` nur bei
`betreuungZugriff === 'frei'` und `person` nur bei `personenZugriff === 'frei' &&
personenEbeneAn` durch. Upstream ist die Betreuung schon leer, die Funktion prüft trotzdem
selbst: Die Zusicherung „kein Name ohne Recht“ soll nicht an einem Nebeneffekt der Datenquelle
hängen, und das AK verlangt ein prüfbares Paar mit/ohne Recht. Betroffene nur bei
eingeschalteter Ebene, weil `onMarkerWaehlen` nur Gezeichnetes findet. Ein Treffer, der die Ebene
still einschaltete, änderte eine geteilte Ansicht. *Verworfen:* die Ebene beim Treffer
einschalten (Seiteneffekt auf die Ansicht) und alle `personenVerortet` durchsuchen (Klick ohne
Wirkung). Der Leerzustand nennt die Bedingung nicht eigens; das bleibt ein Nachzug, falls es
auffällt.

**D2 — `MarkerSuche` ersetzt den Inhalt des Paneels „Verortet“, Beschriftung aus
`OBJEKTART`.** C9 führte eine eigene `TYP_LABEL`-Tabelle byte-gleich zum Inspector. Auf `alpha`
gibt es dafür schon `leistenDaten.ts:OBJEKTART` (alle elf `MarkerTyp`). Eine zweite Tabelle
wäre die Drift, gegen die C9 selbst warnte. Die feste Gleichstand-Reihenfolge
`TYP_REIHENFOLGE` bleibt, erweitert um `betreuungsstelle` und `person`; ein Test hält sie
deckungsgleich mit `OBJEKTART`. Der zirkuläre Import `MarkerSuche → Sidebar`
(`bedienzielStil`) bleibt wie in C9 begründet. `bedienzielStil` ist eine gehobene Funktion und
wird erst beim Rendern gerufen. Das Paneel behält Titel und Kennung „verortet“, damit der
gespeicherte Klappzustand gilt.

**D3 — Kacheln erben die Dichte-Staffel statt der C9-Marke 44.** `kachelStil(token)` setzt
`minHeight`/`minWidth` auf `controlHeight` (30/48/72) plus `paddingXS`. Die Grafik ist 40 px
hoch und macht die Kachel in kompakt ohnehin größer. `BERUEHRUNGSMARKE` gibt es auf `alpha`
nicht, eine eigene 44 außerhalb der Staffel wäre ein erfundenes Maß. Rasterspalten mit
`minmax(max(78px, controlHeight + 2·paddingXS), 1fr)`. Das ergibt in der 300-px-Leiste drei
Spalten in kompakt/komfortabel und zwei im Handschuh. Optik nach Neuentwurf: Radius aus
`token.borderRadius` (0), gewählt = Rand `bedien` + Fläche `flaeche3` + Text `text`, Ruhe =
Rand `linie` + Fläche `paneel`, Hover/Fokus `flaeche3` (LFH-618 Regel 2). Farben über
`useRollen()`. Stilobjekte bleiben per `useMemo` identitätsstabil, sonst hebelt jede
Suchanfrage das `memo` der Kachel aus.

**D4 — Enter-Vertrag.** Der Picker bekommt `onAbsenden?(spec)`. Das ist der einzige Weg, Enter
zu nutzen; ohne ihn (Inspector) macht Enter auf Kachel und Bezeichnung nichts Zusätzliches.
Enter auf einer Kachel wählt sie und sendet die daraus gebaute Spec. Enter im Suchfeld wählt,
falls die Auswahl nicht unter den Treffern steht, den ersten Treffer, und sendet. Enter in
der Bezeichnung übernimmt den getippten Wortlaut und sendet dieselbe frisch gebaute Spec, weil
der Aufrufer seinen State in dieser Runde noch nicht hat (C9-Befund N21). Die Selects unter
„Details“ schlucken Enter selbst (`@rc-component/select`, CLAUDE.md), dort gibt es keinen Weg.
Das ist akzeptiert. Die Leiste reicht `onAbsenden = spec => { setZeichenEntwurf(spec);
onZeichenPlatzierenStart(spec); setZeichenPickerOffen(false) }` durch, denselben Weg wie
der Knopf. `autoFokus` ist in der Leiste an (Einhängen = Absicht) und im Inspector aus.

**D5 — „zuletzt verwendet“ schreibt `useKartenInteraktion` im `onSuccess` des Anlegens.**
`merkeZuletztVerwendet(zeichenPlatzieren)` steht neben `erfolg(...)`. So zählt nur ein
gespeichertes Zeichen, und eine Serie mit gleichem Zeichen ergibt einen Eintrag. Speicher ist
`localStorage` (persönliche Bedienvorliebe, nicht Teil der geteilten Ansicht). Schlüssel sind
die sieben Zeichenfelder in fester Reihenfolge, gepflückt statt kopiert, damit lat/lon/label
den Dublettenschlüssel nicht sprengen. Ein Modul-Abonnement meldet dem montierten Picker das
Merken. Übernommen aus C9 samt Tests.

**D6 — Inspector: Entprellung plus Eigen-Merker (Abweichung von C9).** C9 verglich nur
`entwurf` gegen den Serverstand. Kommt eine fremde Änderung per Live-Invalidierung, während der
Inspector offen und unberührt ist, weicht der alte Entwurf vom neuen Serverstand ab, und nach
600 ms würde er zurückgeschrieben. Das ist genau der Fall aus CLAUDE.md C7 (1). Deshalb ein
eigener State `eigeneAenderung` (nicht `isFieldsTouched`, C7 (2)): Nur Picker-Änderungen
setzen ihn. Ohne ihn übernimmt ein Effekt den Serverstand in den Entwurf. Mit ihm wird nach
600 ms Ruhe gesendet, sofern `entwurf ≠ Serverstand`. Kommt der eigene Stand zurück
(`entwurf = Serverstand`), fällt der Merker. Der Nachhol-Ref für das Schließen innerhalb der
Frist bleibt aus C9. Getestet als Paar: ohne eigene Änderung übernimmt er den fremden Stand und
schreibt nichts; mit eigener Änderung sendet er genau einmal.
Nachzug aus der Review: Der Merker fällt auch, sobald der Entwurf wieder dem Serverstand
gleicht. Sonst bliebe er nach „dieselbe Kachel erneut“ ohne Sendung stehen und schaltete die
Übernahme dauerhaft ab. Die Bezeichnung ist kontrolliert, mit eigenem Tipp-Merker; ein
`defaultValue` fror den alten Wortlaut ein und schrieb ihn beim bloßen Verlassen zurück.
„Löschen“ verwirft eine offene Änderung, statt sie beim Abbau als PATCH auf das gelöschte
Zeichen nachzuholen. „Zuletzt verwendet“ merkt die gesendete Spec aus dem Ergebnis der
Mutation, nicht den Platzier-Modus beim Eintreffen der Antwort.
*Verworfen:* ein expliziter „Übernehmen“-Knopf. Er kostet einen Klick je Änderung und passt
nicht zum Sofort-Verhalten der übrigen Inspectors.

**D7 — Feldbudget.** Offen liegen in der Leiste Grundzeichen-Suche + Raster und, falls
akzeptiert, Symbol-Suche + Raster, also zwei Eingabefelder und zwei Radiogruppen. Der Rest
steht unter „Details“ mit `forceRender`. Die Zählung im Test beweist dann etwas (CLAUDE.md,
Erfassungs-Norm).

## Risks / Trade-offs

- [Rasterkosten im Test und auf schwachen Tablets: ~120 SVG-Kacheln] → `memo` +
  Klick-Delegation an der Gruppe. C9 hat einen Element-Cache gemessen und verworfen. Hakt es
  auf echter Hardware, ist Virtualisierung der Nachzug.
- [Betroffene bei ausgeschalteter Ebene nicht suchbar] → bewusst (D1). Der Leerzustand bleibt
  wahr, weil er nur über Suchbares spricht.
- [Enter im Suchfeld platziert mit dem ersten Treffer] → Das Platzieren beginnt erst mit dem
  Kartenklick und ist mit „Abbrechen“ umkehrbar; ein falscher Treffer kostet keinen Datensatz.
- [Eigene und fremde Änderung in derselben Frist: gesendet wird die ganze Spec, fremde Felder,
  die die Person nicht berührt hat, gehen verloren] → hingenommen. Ein feldweises Zusammenführen
  gegen die Basis wäre ein eigener Schritt, die Spec schweigt dazu.
- [Gescheiterter PATCH: der Picker zeigt weiter den ungesendeten Stand, gemeldet nur per
  Fehlertoast] → Bestand vor LFH-716, mit der Frist nur weniger auffällig.
- [Zirkulärer Import `MarkerSuche ↔ Sidebar`] → wie in C9 begründet; eine Modulebenen-Ableitung
  aus `Sidebar` in `MarkerSuche` würde ihn brechen und steht als Warnung im Kopf.

## Migration Plan

Reines Frontend, kein Datenbestand. Der neue `localStorage`-Schlüssel startet leer. Rückweg:
Revert.
