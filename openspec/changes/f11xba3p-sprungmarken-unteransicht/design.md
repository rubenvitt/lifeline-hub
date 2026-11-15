# Design

## Context

Die Zeilen des Modulmenüs entstehen in `ModulListe` (`frontend/src/einsatz/ModulPanel.tsx`), die
das Modulpanel und das Akkordeon des Navigations-Drawers gemeinsam nutzen. Die Reihenfolge legt
`navZeilen` aus `nach` jeder Marke fest (`frontend/src/einsatz/sprungmarken.ts`). Heute ist
„Entscheidungen“ die einzige Marke, deren `kategorie` (Führung) nicht die ihres Zielmoduls (ETB,
Erfassung) ist. Die Markenzeile nutzt `modulZeilenStil` wie eine Modulzeile, mit
`IconExternPfeil` rechts. Die Ansichtsfilter der Marken werden nach dem Sprung aus der URL
geräumt (apply-then-clean), deshalb kann die Marke selbst nicht als aktuelle Seite gelten.

## Goals / Non-Goals

**Goals:**

- Marke und Zielmodul stehen untereinander; nach dem Klick bleibt die Hervorhebung sichtbar in
  derselben Kategorie.
- Die Marke liest sich als Unteransicht, nicht als Link nach außen.

**Non-Goals:**

- Die Marke selbst hervorheben, solange ihr Filter gilt (bräuchte den Filter dauerhaft in der
  URL oder einen gemeldeten Zustand; am 15.11.2026 bewusst nicht gewählt).
- Die Sprungpalette ändern: ihr Kontext ist das Zielmodul, nicht die Kategorie.
- Den Zweig `verweistAuf` in `ModulListe` anfassen (heute ohne Registry-Eintrag).

## Decisions

**D1 Entscheidungen nach Erfassung, hinter ETB.** `kategorie: 'erfassung'`, `nach: 'etb'`.
Verworfen: in Führung lassen und nur die Optik ändern — der Kategoriesprung, den das Ticket
bemängelt, bliebe. Damit die Regel hält, prüft ein Test für jede Marke, dass ihre `kategorie`
die ihres Zielmoduls ist; eine künftige Marke in fremder Kategorie wird rot.

**D2 Einzug mit Führungslinie.** Die Markenzeile behält `modulZeilenStil` (Trefffläche aus
`controlHeight` und `mindestTrefflaeche`, Schriftgröße, Sperrfarbe) und trägt an der Stelle der
Modulmarke eine 1-px-Linie in `farben.linie` mit eigenem reinem Stil (`sprungLinieStil`,
exportiert und prüfbar wie `modulMarkeStil`). Die Linie streckt sich mit negativem Block-Rand
durch die Polsterung der Zeile, damit aufeinanderfolgende Marken eine durchgehende Linie bilden;
ihr Rand nach rechts (`token.padding`) ist der Einzug des Etiketts. Der transparente
Markenplatzhalter (`modulMarkeStil`) entfällt in der Markenzeile: eine Marke wird nie aktiv. Verworfen: nur einrücken ohne Linie (am 15.11.2026 abgewogen;
die Linie bindet die Marke sichtbar an ihr Modul).

**D3 Kein Pfeil, Schloss bleibt.** `IconExternPfeil` fällt aus der Markenzeile. Das Schloss
bei Sperre bleibt als zweiter Kanal neben `disabled`. Der zugängliche Name bleibt „<Marke>,
springt zu <Hinweis>“; der Kommentar dazu nennt den Pfeil nicht mehr.

**D4 Drawer ohne eigenen Weg.** Das Akkordeon rendert `ModulListe`; Einzug und Linie gelten dort
mit, die Trefffläche hebt `mindestTrefflaeche` wie bisher an.

## Risks / Trade-offs

- [e2e `nav-schmal.spec.ts` zählt darauf, dass die gesperrte Marke „Entscheidungen“ im
  offenen Führungsmenü des Überblicks steht] → Die Prüfung öffnet stattdessen die Kategorie
  Erfassung (oder startet auf einer Seite dort), mit ETB als gesperrter Zeile und
  „Entscheidungen“ als gesperrter Marke.
- [Der Einzug kostet in 208 px Panelbreite Platz für lange Namen] → Die längste Marke
  („Kommunikationsplan“) wird mit Einzug geprüft; überläuft sie, kürzt `text-overflow` wie bei
  Modulzeilen.
- [Doku-Bilder zeigen das alte Menü] → Bilder der Kapitel, deren Ansicht das Modulmenü mit einer
  Marke zeigt, im selben Branch neu erzeugen (Mitänderungsregel, `docs/anwender/AGENTS.md`).
