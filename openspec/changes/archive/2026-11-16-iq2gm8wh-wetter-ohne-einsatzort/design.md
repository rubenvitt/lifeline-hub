# Design

## Context

Motivation: siehe proposal.md. Der Weg ist am Phase-1-Checkpoint am 16.11.2026 mit Ruben
abgestimmt („ein Seitenhinweis“). Heute zeigt `StandHinweis` (`wetter/WetterPaneele.tsx`) für den
Teilzustand `kein_ort` in jedem der drei Wetterpaneele „Einsatzort nicht verortet“; nur das
Warnpaneel bekommt `onEinsatzdaten` und damit den Knopf. Die Seite `pages/WetterPegelPage.tsx` legt
die Paneele in ein Raster (`wetter-pegel-raster`), die Warnungen in voller Breite vorn. Alle drei
Teile kommen aus derselben Abfrage (`wetterQuery`) und hängen an derselben Koordinate, sie sind also
immer gemeinsam `kein_ort`.

## Goals / Non-Goals

**Goals:** Der Grund steht genau einmal auf der Seite, der Weg zur Behebung (Knopf) ebenso.

**Non-Goals:** Den Demo-Einsatz verorten (verworfene Variante), am Endpunkt etwas ändern, das Pegel-Paneel anfassen.

## Decisions

**D1 – Hinweis als erstes Element des Rasters, volle Breite.** Er entsteht aus dem Teilzustand der
Warnungen (`wetter.warnungen.stand.art === 'kein_ort'`). Die Warnungen dienen als Stellvertreter,
weil alle Teile an derselben Koordinate hängen. Er steht in voller Breite vor dem Warnpaneel, in
derselben Form wie der bisherige Paneel-Hinweis: gedämpfter Text, darunter der Knopf.
`data-lfh="wetter-kein-ort"` wandert mit, sodass Tests und Bildlauf eine Stelle finden. Solange die
Abfrage lädt oder fehlschlägt, entsteht kein Hinweis: der Zustand ist dann unbekannt, und die
Paneele zeigen ihren eigenen Lade- oder Fehlerzustand.
Verworfen: Hinweis im Seitenkopf (`EinsatzSeite`-Meta). Der Kopf hält seine Breite (LLH-1463) und
trägt keinen Knopf. Ebenfalls verworfen: `SeitenHinweis`, weil er für Speicherfehler da ist
(`frontend/AGENTS.md`, „Speicherfehler an die Seite“), nicht für einen Datenzustand.

**D2 – Paneele knapp.** `StandHinweis` zeigt für `kein_ort` nur „ohne Einsatzort“ (gedämpft, eine
Zeile). Die Prop `onEinsatzdaten` entfällt an `WarnungenPaneel`. Das Paneel bleibt stehen und springt
nicht; seine Höhe sinkt um die Knopfzeile.

## Risks / Trade-offs

- [Ein künftiger Teil hinge an einer anderen Koordinate.] → Dann wäre D1 neu zu entscheiden; heute
  liefert ein Endpunkt alle drei Teile zur Einsatzort-Koordinate.
