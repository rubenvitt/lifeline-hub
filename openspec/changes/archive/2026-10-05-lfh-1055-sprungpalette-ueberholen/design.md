# Design

## Context

Motivation in `proposal.md`. Stand `alpha` c972a096, nachgestellt im Browser (Chromium, Playwright,
1440 × 900, Nacht und Tag, drei Dichten). Prototyp als Patch und Vorher/Nachher-Bögen im
Projektordner `lfh-1055/` (nicht im Repo).

Befunde aus der Sonde:

- **Zeiger stiehlt die Markierung.** Die Zeile setzt die Markierung in `onMouseEnter`. Steht der
  Zeiger nach einem Klick (z. B. „Anlegen“ im Einsatz-Dialog) mitten im Bild, zieht das
  Einblenden der Palette und jedes Neuordnen beim Tippen Zeilen unter ihm durch; der Browser
  meldet `mouseenter`, die Markierung springt. Gemessen: leere Palette markiert
  „Darstellung: System“ statt der ersten Zeile, „hell“ markiert „Darstellung: Dunkel“ an
  Platz 8. ↵ führte das aus. In der Sonde liefen dadurch „Darstellung: Hell“ und
  „Dichte: Kompakt“ ins Leere.
- **Strg/⌘+Rücktaste geschluckt.** `tastaturAktionFuerEreignis` liest die Taste als
  `filter-zuruecksetzen`; bei offener Palette ruft der Provider `preventDefault`. Gemessen:
  „einsatz tage“ bleibt stehen (erwartet „einsatz “).
- **⌘A:** Strg+A markiert in Chromium den ganzen Begriff, Fokus bleibt. Für ⌘A unter macOS gibt es
  in der Palette keinen Zuhörer, der die Taste nimmt (Provider, Palette, übrige globale
  Zuhörer geprüft); die Desktop-Hülle hat „Alles auswählen“ im Menü. Nicht auf macOS
  nachstellbar, siehe Open Questions.
- **Kasten im Kasten:** das `borderless`-Feld trägt im Fokus `outline: 1px solid bedien` aus
  der globalen Fokusregel.
- **Fußzeile** bricht in jeder Dichte auf zwei Zeilen (lange Legenden, Mono 10 px, Polsterung
  der Tastenmarke wächst mit der Dichte).
- Gruppenkopf (16 px Einzug) und Icon (8 px) fluchten nicht; eine Zeile ohne Icon
  („Filter zurücksetzen“) rückt nach links.

## Goals / Non-Goals

**Goals:**
- Die Palette liest sich als ruhige Liste der Instrumententafel: eine Kante, eine Schriftfamilie
  im Satz, Mono nur in Tastenmarken.
- Tastenwege und Markierung verhalten sich vorhersagbar, auch mit Maus im Bild.

**Non-Goals:**
- Keine neue Ordnung der Gruppen, keine neuen Befehle, keine Änderung an Suche/Fuse.
- Kein Ausblenden der Fußzeile auf Touch (eigenes Ticket).
- Kein Umbau der Vorschau über Schriftgrößen hinaus.

## Decisions

**D1 Zeiger: Markierung nur bei echter Bewegung.** `onMouseMove` statt `onMouseEnter`; die Zeile
merkt die letzte Zeigerposition und markiert nur, wenn sie sich geändert hat (die erste
Bewegung nach dem Öffnen setzt die Grundlinie). Chromium schickt nach Layoutwechseln
synthetische Mausereignisse mit unveränderter Position, die so wirkungslos bleiben.
*Verworfen:* `pointer-events: none` während des Tippens (bricht Klicks), Zeitsperre nach
Tasten (rät eine Frist).

**D2 Strg/⌘+Rücktaste bei offener Palette nicht verhindern.** Im Provider kehrt
`filter-zuruecksetzen` bei offener Palette ohne `preventDefault` zurück; die Ebene darunter
bekommt die Taste weiter nicht. Speichern (Strg/⌘+S) bleibt verhindert (sonst Browser-Dialog),
Strg/⌘+↵ nimmt die Palette selbst. *Verworfen:* die Taste nur im Suchfeld freigeben (die
Palette hat nur dieses Feld; der Unterschied wäre ein Zweig ohne Fall).

**D3 Dubletten in der Startansicht: oberste Gruppe gewinnt.** Beim Aufbau der Gruppen wird ein
Kernschlüssel geführt (`ausgefuehrt:<id>` → `<id>`, `zuletzt:<modul>` → `modul:<modul>`); was
schon in einer höheren Gruppe stand, fällt weg. *Verworfen:* den Klon weglassen und das
Original markieren (dann wäre „Zuletzt ausgeführt“ keine Abkürzung mehr, sondern Schmuck).
Bei aktiver Suche gilt weiter `ohneOrdnungsdubletten`.

**D4 Schnellaktionen: Modul-Icon, Modulname als Kontext, Objekt + Verb.** Ids bleiben, damit
Gedächtnis und Guards gelten. Die alte Beschriftung wandert in `schlagworte`.
*Verworfen:* Plus-Abzeichen auf dem Modul-Icon (zweites Zeichen in 16 px, liest sich nicht);
nur das Icon tauschen und die Beschriftung lassen (drei Satzmuster bleiben).

**D5 Kopf.** Feld ohne eigenen Umriss (`outline: none`); den Fokus zeigen der Bedienrahmen der
Palette und die Schreibmarke, das Feld ist das einzige Ziel. 16 px bleiben (iOS zoomt
darunter). Modusanzeige als Marke `bedienFlaeche`/`bedienText` im Kopf, `data-lfh="palette-modus"`
bleibt. *Verworfen:* Unterkante des Kopfs im Fokus blau färben (doppelt zum Rahmen).

**D6 Zeile.** Label `schriftskala.text` (14), Kontext `textKlein` (12, `schwach`), Icon-Spalte
18 px fest, Icon `gedaempft`, aktiv `bedien`. Aktiv: `flaeche3` plus `inset 2px 0 0 bedien`
(die Marke des Modulpanels). ↵-Marke reserviert ihren Platz in jeder Zeile (`visibility`), damit
der Kontext beim Pfeilen nicht springt. Liste mit 4 px Innenrand, Gruppenkopf bündig mit der
Icon-Spalte, 12 px darüber, 2 px darunter. Boden weiter `palettenZeilenStil`.

**D7 Fußzeile.** Sans 12 `schwach`, Tastenmarken in festem Maß (`0 4px`, 11 px, Ein-Zeichen-
Tasten 18 px breit), Abstände fest (12/6 px), Polsterung 6 × 16 px. Links ↵ öffnen, neuer Tab
(`⌘ ↵`/`Strg ↵`), → Vorschau; rechts die Präfixe mit Kurzwort aus `PALETTE_MODI.kurz`, der
Langtext als `title`. Der Koordinatenhinweis entfällt: er passt nicht in die Zeile, und die
Koordinatenzeile erscheint beim Tippen selbst. Gemessen 31–32 px Höhe in allen drei Dichten.
*Verworfen:* „?“ mit Legende (ein neues Bedienziel für drei Zeichen).

## Risks / Trade-offs

- [Ein Lesezeichen im Kopf: „Neuer ETB-Eintrag“ steht nicht mehr da] → alte Beschriftung als
  Schlagwort; Szenario „Alte Beschriftung findet“.
- [Ohne Feldumriss sieht ein Screenreader-/Tastaturnutzer den Fokus nur am Palettenrahmen] → die
  Palette hat genau ein fokussierbares Ziel und öffnet mit Fokus darin; Rahmen ist `bedien`.
- [Erste Mausbewegung nach dem Öffnen markiert noch nicht] → bewusst; die zweite tut es,
  Klicks wirken ohnehin sofort.
- [Module verschwinden aus „Module“, wenn sie in „Zuletzt besucht“ stehen] → sie stehen eine
  Gruppe höher; bei Suche erscheinen sie normal.

## Migration Plan

Reines Frontend, keine Daten. Rückweg: Revert des PR.

## Open Questions

- ⌘A unter macOS: im Code findet sich nichts, was die Taste nimmt. Ruben fragen, ob es im
  Browser oder in der Desktop-App auftrat; bleibt es nach diesem Change, eigenes Ticket für die
  Hülle. Ändert weder Specs noch Aufgaben.
