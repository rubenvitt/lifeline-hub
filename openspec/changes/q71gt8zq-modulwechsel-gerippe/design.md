# Design

## Context

Den Anlass beschreibt `proposal.md`, „Why“. Für den Weg zählt Folgendes:

- `RouterProvider` aus `react-router` (v8) führt jede Navigation in `React.startTransition` aus
  (`useTransitions` ist nicht gesetzt). React zeichnet den neuen Baum dann im Hintergrund und hält
  das alte Bild, bis er fertig ist. Fast alle Modulseiten werden synchron gezeichnet
  (`MODUL_ELEMENTE` in `App.tsx`), sie hängen also an keiner Suspense-Grenze. Ein Fallback
  greift deshalb nie.
- Die Wartezeit kommt aus dem Zeichnen, nicht aus dem Netz: Auch beim zweiten Besuch, mit
  gefülltem Query-Cache, dauert es gleich lang. Am Produktions-Build ist die längste Blockade
  135–255 ms, ein einziger Task am Stück.
- Der Einsatzrahmen (`einsatz/EinsatzLayout.tsx`) kennt das Modul der Route
  (`aktuellesModul = modulAusPfad(pathname)`) und rendert vor dem `<Outlet />` schon zwei
  Zustände: den Modulwächter (`SeitenSkeleton` während die Freigaben laden) und das gesperrte
  Modul.
- Jede Modulseite hat einen `EinsatzSeite`-Kopf mit `titel={modulName(key)}`. Die Ausnahme ist
  die Lagekarte, die ohne `EinsatzSeite` als Fläche arbeitet.

## Goals / Non-Goals

**Goals:**
- Die Rückmeldung auf den Klick im ersten Bild, unabhängig davon, wie teuer die Zielseite ist.
- Eine Stelle im Rahmen statt Arbeit in jeder Seite, gültig auch für künftige Module.

**Non-Goals:**
- Das Zeichnen der Seiten beschleunigen (LLH-1974).
- Gerippe für Wechsel innerhalb eines Moduls, für Ebene 1, die Verwaltung oder die Gerätehülle.
- Ein Gerippe in der Form jeder einzelnen Seite. Es gibt ein gemeinsames Gerippe
  (`SeitenSkeleton`).

## Decisions

### D1: Zwei Schritte im Rahmen statt eines Abschaltens der Router-Übergänge

Ein kleiner Baustein `ModulWechselGerippe` um das `<Outlet />` merkt sich, für welches Modul die
Seite freigegeben ist (`freigegeben`, Startwert das aktuelle Modul). Weicht das Modul der Route
davon ab, zeichnet er statt des Outlets die Gerippe-Seite. Diese ist billig, also schließt der
Router-Übergang sofort ab und das Bild wechselt. Ein Effekt setzt danach in
`startTransition` `freigegeben` auf das neue Modul. React zeichnet die echte Seite im
Hintergrund und tauscht sie gegen das Gerippe, sobald sie fertig ist.

- Startwert = aktuelles Modul: Ein direkter Aufruf oder ein Neuladen zeigt kein Gerippe vorab
  (Spec, „Einsatz direkt öffnen“).
- Schlüssel ist `aktuellesModul.key`, nicht der Pfad. Detailseiten und Unterrouten desselben
  Moduls lösen nichts aus.
- Reihenfolge im Rahmen bleibt: erst Modulwächter, dann gesperrtes Modul, dann das Gerippe um
  das Outlet.

**Verworfen:**
- `useTransitions={false}` am Router: Dann zeichnet der Wechsel synchron. Der Hauptthread blockiert
  genauso lang, und der Browser zeigt bis dahin weiter das alte Bild. Gewonnen wäre nichts, und
  die Übergänge gingen für alle Routen verloren.
- `useDeferredValue` auf das Modul: Ein Wert, der in einem Übergang wechselt, kommt dort schon
  neu an. Die Verzögerung greift nur bei dringenden Updates und fiele hier aus.
- Jede Modulseite per `lazy` hinter `Suspense`: Das hilft nur beim ersten Laden des Codes, nicht
  bei den Kosten des Zeichnens. Außerdem hält React in einem Übergang ein schon gezeigtes
  Suspense-Bild fest.
- Nur Module mit einer Markierung `schwer` (am 18.11.2026 abgestimmt: rahmenweit). Die Liste
  müsste gepflegt werden, und neue schwere Seiten fielen durch.

### D2: Gerippe-Seite = Seitenkopf mit Modulnamen + verzögertes `SeitenSkeleton`

Die Gerippe-Seite rendert `EinsatzSeite` mit `titel={modulName(key)}` und als Inhalt
`SeitenSkeleton` mit `verzoegert`. Den Kopf zeichnet dieselbe Komponente wie bei der echten
Seite, also springt er nicht an eine andere Stelle. Meta und Aktionen kommen erst mit der Seite
(D4). `verzoegert` setzt die Klasse `lfh-skelett--verzoegert`: Die Balken stehen zuerst mit
`opacity: 0` da und werden nach 120 ms per CSS-Animation (`animation-delay`) sichtbar. Ihr Platz
ist von Anfang an reserviert, also springt nichts. Ein Modul, das schneller gezeichnet ist, zeigt
nie Balken. `aria-busy` steht sofort, damit ein Screenreader „Inhalt wird geladen“ hört.

**Verworfen:** Verzögerung per Timer in JS. Das wäre ein zusätzlicher Render und könnte Zustand
nach dem Aushängen setzen. CSS genügt.

### D3: Lagekarte und Kräfteübersicht: dieselbe Gerippe-Seite als Suspense-Fallback

`App.tsx` setzt bei beiden die Gerippe-Seite mit ihrem Modulschlüssel als Fallback, statt des
Ladetexts. Für die Lagekarte heißt das: Erst steht ein Kopf „Lagekarte“ da, dann kommt die Karte
ohne diesen Kopf. Das ist ein bewusster kurzer Wechsel, abgestimmt am 18.11.2026 als
„vereinheitlichen“. Lädt der Code beim Wechsel, folgen Rahmen-Gerippe (D1) und Suspense-Fallback
mit demselben Bild aufeinander, und man sieht keinen Unterschied.

### D4: Was bewusst nicht im Gerippe steht

Kein Ortspfad mit Daten, keine Meta, keine Aktionen. Diese hängen an den Daten der Seite, und ein
Platzhalter dafür hieße, die Seite doppelt zu bauen. `EinsatzSeite` hält den Datenstand schon
ohne Inhalt in seiner Breite (LLH-1463).

## Risks / Trade-offs

- [Ein zusätzlicher Render-Schritt bei jedem Modulwechsel] → Die Gerippe-Seite kostet nur einige
  Millisekunden. Der Effekt startet die echte Seite im selben Tick nach dem Commit.
- [Fokus oder Scroll einer Seite, die beim Einhängen greifen, laufen jetzt einen Schritt später]
  → Sie hängen an der echten Seite, die weiterhin einhängt. Der Rahmen setzt keinen Fokus beim
  Wechsel (geprüft: nur die Rückgabe aus der Palette, `EinsatzLayout.tsx`).
- [Tests, die nach einem Klick in der Modulleiste sofort Inhalte der Zielseite erwarten] →
  `findBy…`/Playwright-Erwartungen warten ohnehin. Synchrone `getBy…` direkt nach einem
  Wechsel scheitern und werden auf `findBy…` umgestellt, wenn die Suite sie zeigt.
- [Der Wechsel bleibt trotz Gerippe für 150–250 ms ohne Reaktion auf Eingaben] → LLH-1974.

## Migration Plan

Nur Frontend, kein Datenstand. Zurück geht es, indem das Outlet wieder direkt im Rahmen steht.
