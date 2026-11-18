# Design

## Context

Die Vorschauen des Design Systems entstehen mit `react-dom/server` (`renderToString`) im Vitest-Lauf
(`frontend/scripts/design-system/previews.tsx`). Dort laufen keine Effekte: `useVorlauf` (Rail) und
`useFitToWindow` (Modulpanel) messen nichts, `useMinutenTakt` liefert `Date.now()` des Laufs. Im
statischen HTML bleiben aber `position: sticky` und `height: calc(100dvh - var(--lfh-kopf-oben) …)`
stehen; die Karte wäre so hoch wie das Fenster, in dem sie jemand ansieht. Der Wächter
`designSystem.guard.test.ts` vergleicht das Erzeugte bytegenau, eine laufende Einsatzdauer bräche
ihn bei jedem Lauf.

Vorbild für einen Schalter am Baustein: `EinsatzSeite` mit `kopfKlebt={false}`, den die Karte
`Seitenkopf` schon nutzt.

## Goals / Non-Goals

**Goals:**
- Rail und Modulpanel als echte Bausteine in einer Karte fester Höhe, ohne Nachbau.
- Das Verhalten im Einsatzrahmen bleibt unverändert (Vorgabe des Schalters: an).

**Non-Goals:**
- Kein Umbau der klebenden Spalten (LLH-1273, LLH-1734, zjt7c073 bleiben, wie sie sind).
- Keine Karte für den Navigations-Drawer unter `lg` und keine für den eingeklappten Zustand.
- Keine Uhr-Schnittstelle am Modulpanel.

## Decisions

**D1: Schalter `kleben?: boolean` an `IconRail` und `ModulPanel`, Vorgabe `true`.** Mit `false`:
- Die Spalte (`rail-spalte`, `modul-panel-spalte`) klebt nicht und hat `height: 100%`; die Höhe gibt
  der Träger vor. Die Rail-Landmarke und das Panel füllen ihn über die Streckung der Flex-Zeile.
- Keine Messung: `useVorlauf` und `useFitToWindow` bekommen ein `aktiv` und hängen ohne nichts an
  `window`, `document.body` oder `abonniereRahmenOben`; die Rail setzt `--lfh-rail-vorlauf` nicht.
- Alles andere (Ziele, Griff, Liste, Fuß, Rollen der Liste in sich, `bringIntoView`) bleibt.

Name wie die Familie `kopfKlebt`/`useSeitenkopfKleben`; `kleben` statt `kopfKlebt`, weil es hier
keinen Kopf gibt.

Verworfen:
- **B, eigener Baustein `RahmenSpalte`**, aus dem Rail und Panel ihre klebende Spalte beziehen und
  dessen Inhalt die Karte ohne Spalte zeigt. Sauberere Trennung, aber ein Umbau fein abgestimmter,
  per e2e gemessener Spalten (Fuß hinter den Kategorien, Vorlauf, Fit-to-Window) für eine Karte.
- **C, nur Vorschau-CSS**: die Karte setzt `--lfh-kopf-oben: calc(100dvh - <Höhe>)`, damit die
  calc eine feste Höhe ergibt. Kein Eingriff in die App, hängt aber still an der internen Formel;
  ändert sie sich, bricht die Karte, ohne dass ein Test rot wird.

**D2: Feste Einsatzdauer über einen abgeschlossenen Einsatz.** `dauerZwischen` nimmt bei gesetztem
`abgeschlossen_at` dessen Zeitpunkt statt der Uhr; die Karte reicht `begonnen_at` und
`abgeschlossen_at` fest (z. B. 3 h 12 min). Keine `jetzt`-Schnittstelle nötig.

**D3: Inhalt der Karte.** Ein Träger fester Höhe (`display: flex`, Höhe bei 720 px Breite in
Chromium bemessen), darin `IconRail` mit den echten `kategorien`, aktiver Kategorie und `panel`
offen (Griff „Menü einklappen“), daneben `ModulPanel` derselben Kategorie aus
`moduleNachKategorie` und `sprungmarkenNachKategorie`, mit aktivem Modul, einem Zähler, einem vom
Server gesperrten Modul über `freigaben` und dem Fuß „Einsatzdauer“. Kategorie: eine, die Zähler,
Sprungmarke und ein sperrbares Modul zugleich trägt (beim Umsetzen aus der Registry gewählt).
Ohne `kategoriePfad` sind die Ziele Knöpfe; die Modulzeilen bleiben Links (`einsatzId` fest).
Rail ist in beiden Modi dunkel; Nacht und Tag wie jede Karte.

**D4: Bausteinwahl.** Gruppe **Rahmen**, Zeile „Navigation im Einsatz (Kategorien und Module)“ →
`IconRail`/`ModulPanel` (ab `lg`; darunter Navigations-Drawer, „UI-Form-Leitlinie“) → Karte
`Navigation`. Der Abdeckungswächter in `designSystem.test.ts` hält Zeile und Karte deckungsgleich.

## Risks / Trade-offs

- [Ein Schalter, den nur die Karte setzt] → Er ist klein, hat eine Vorgabe ohne Wirkung auf die App
  und wird durch Komponententests in beide Richtungen festgehalten (kleben an: sticky und
  Fensterhöhe; aus: keines davon, keine Messung).
- [Bytegleichheit] → Dauer fest (D2); `useId` ist im Server-Render deterministisch, wie bei den
  übrigen Karten. Der Wächter zeigt eine Abweichung sofort.
