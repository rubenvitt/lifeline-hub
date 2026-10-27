# Taktische Zeichen (Einheit, Fahrzeug, Gefahr; Meldebildzeile)

Das taktische Zeichen eines Fachobjekts als Inline-SVG über @einsatzzeichen (LFH-835). Übersetzt
das Hub-Vokabular über `fachobjektZeichen` (mit Rückfall) und rendert nichts, wenn nicht einmal
der Körper darstellbar ist — ein gespeicherter Unsinnswert bringt keine Zeile zum Absturz.
Jede Instanz trägt einen eigenen `idPrefix`: der Vorgabepräfix der Bibliothek ergäbe in Listen
doppelte `id`s.

Aus `frontend/src/zeichen/zeichenTheme.ts`:

Render-Theme für Zeichen auf dunklem Grund (LLH-1141): das Theme `dark` der Bibliothek
(ESZ-119). Zeichen ohne Organisation zeichnet die Bibliothek mit schwarzem Umriss ohne Fläche,
auf dem Grund des Nachtbetriebs hielt er rund 1,1 : 1. Das Theme macht das Zeichen selbst hell,
ohne Fläche dahinter: eine weiße Hinterlegung folgt eng der Kontur jedes malenden Blatts,
Kopfmarken und Fahrwerk stehen weiß auf dem Grund, Körperfüllungen und ihre schwarze Schrift
bleiben wie am Tag. Keine Farbumkehr (die verwirft die Bibliothek bewusst), die Farben nach
DV 102 bleiben; Palette und Kontursignaturen sind die von `accessible-light`.
Kontur gegen Hinterlegung und Hinterlegung gegen dunklen Grund ≥ 3 : 1: `zeichenTheme.test.ts`,
im Browser `e2e/lagekarte-zeichen-kontrast.spec.ts` (Karte), `e2e/zeichen-kontrast.spec.ts`
(Meldebild, Organigramm) und „Zeichenkontrast“ in `e2e/fernmeldeskizze-ausstattung.spec.ts`.

Quelle: `frontend/src/zeichen/EinsatzZeichen.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
