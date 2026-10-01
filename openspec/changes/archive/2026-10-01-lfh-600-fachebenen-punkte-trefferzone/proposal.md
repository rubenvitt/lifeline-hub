# Proposal

## Why

Die Punkte der Fachebenen auf der Lagekarte (Pegel, Hochwasser, Luftqualität, ODL, Autobahn,
KRITIS, Energie) sind nur so groß, wie sie gezeichnet werden: Radius 3–9 px, also eine
Trefffläche von 6–18 px. Das liegt unter dem Boden von 24 px (Prüfliste Einsatztauglichkeit,
Kriterium 1) und weit unter 72 px im Handschuh-Modus (Kriterium 2). Mit Handschuh trifft man im
Fahrzeug keinen Pegel. Der Kontrast der Kreise gegen die Basemap (Kriterium 5, ≥ 3 : 1) ist nirgends
gemessen. Ein weißer Rand von 1,5 px trägt auf heller Karte nichts. LFH-79 hat die drei Zeilen
deshalb offen an LFH-600 übergeben.

Den Radius einfach zu vergrößern geht nicht, denn bei Hochwasser, Luftqualität und ODL trägt er
die Stufe als zweiten Kanal neben der Farbe.

## What Changes

- Jeder Fachebenen-Punkt und jedes Fachebenen-Bündel bekommt eine **unsichtbare Trefferzone**,
  deren Durchmesser der Dichte-Staffel folgt (30 / 48 / 72 px wie die Trefferzone der Marker,
  LFH-711). Der gezeichnete Radius bleibt, wie er ist, und trägt weiter die Stufe.
- Die Klickrangfolge nimmt Fachebenen-Trefferzonen auf: Sie stehen jedem gezeichneten Punktziel
  nach und schlagen jede Fläche, genau wie Marker-Trefferzonen. Überlappen sich Trefferzonen von
  Markern und Fachebenen-Punkten, gewinnt das Ziel, dessen Punkt dem Tipp am nächsten liegt.
- Fachebenen-Punkte und -Bündel bekommen die **Doppelkante** der Personen-Marker: weiß innen,
  schwarz außen, je 2 px. Damit steht die Kontur gegen jeden Kartengrund bei mindestens 3 : 1.
- Browser-Nachweise: Trefffläche je Punkt-Fachebene über die Staffel in
  `e2e/gate3-trefflaeche.spec.ts`, Unterscheidbarkeit der Radius-Stufen, Kantenkontrast per
  Pixelmessung gegen helle und dunkle Grundlagen (blind, offline, online).
- Prüfliste Einsatztauglichkeit für die Punkt-Fachebenen mit den Messwerten. Die offenen Zeilen
  1, 2 und 5 der LFH-79-Prüfliste verweisen danach auf sie.
- Die Zeichenreihenfolge „schlechtere Stufe oben“ (`circle-sort-key`, Kommentar aus dem
  LFH-79-Review) ist bereits umgesetzt. Diese Change ändert sie nicht, sie gilt auch für die neue
  Kante.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lagekarte-klickziele`: Die Rangfolge kennt Trefferzonen von Fachebenen-Punkten neben denen der
  Marker. Bei mehreren Trefferzonen gewinnt das nächste Ziel, gleich welcher Art.
- `lagekarte-fachebenen`: neue Anforderungen an Fachebenen-Punkte. Die Trefffläche folgt der
  Dichte-Staffel und ist vom gezeichneten Radius getrennt, die Kontur hält ≥ 3 : 1 gegen jeden
  Kartengrund, und die Stufe im Radius bleibt unterscheidbar.

## Impact

- Frontend: `pages/lagekarte/fachebenenLayer.ts` (Treffer- und Kantenlayer, Staffelwert),
  `pages/lagekarte/klickziel.ts` (neue Rolle), `pages/lagekarte/Kartenflaeche.tsx` (Staffelwert
  durchreichen, Klick- und Cursorbindung an die Trefferzone), Unit-Tests daneben.
- e2e: `e2e/gate3-trefflaeche.spec.ts` (neuer Block), neue Spec für den Kantenkontrast der
  Fachebenen-Punkte, gemeinsamer Pixel-Messkern statt einer Kopie aus
  `e2e/betroffene-kontrast.spec.ts`.
- Regeln: `frontend/src/pages/lagekarte/AGENTS.md` (Trefferzone-Regel gilt auch für Fachebenen).
- Kein Backend, keine API, keine Migration.
