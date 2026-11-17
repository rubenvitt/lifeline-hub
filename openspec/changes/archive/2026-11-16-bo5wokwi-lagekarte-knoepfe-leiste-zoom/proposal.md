# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/bo5wokwiedddozxqn5alq9sf (LLH-1751, Thema 3 der UI/UX-Analyse
vom 12.11.2026, Epic LLH-1717)

## Why

Auf der Lagekarte sagen die Knöpfe oben rechts nur mit einem Symbol, was sie tun. Ihr Name erscheint
nur beim Überfahren mit der Maus, auf Touch also nie. Am Touch-Gerät nimmt die offene Leiste ab
`lg` 300 px neben der Karte ein. Im Handschuh-Betrieb bleibt so etwa die halbe Breite für die
Karte. Dazu zoomt ein Tipp auf ein Objekt ungefragt auf einen festen Maßstab, auch heraus, wenn man
näher war. Wer gerade einen Ausschnitt eingestellt hat, verliert ihn mit einem Tipp.

## What Changes

- Die Kartenknöpfe „Nach Norden ausrichten“, „Eigenposition“, „Messen“, „Zeichenwerkzeuge“ und
  „Leiste ein-/ausblenden“ tragen in jeder Dichte ein kurzes Wort unter dem Symbol: „Norden“,
  „Position“, „Messen“, „Zeichnen“, „Leiste“. Hinein- und Herauszoomen bleiben reine Symbole (+/−).
  Das gilt für jede Karte mit diesem Knopfblock: Lagekarte, Betroffenenkarte, Abschnittskarte des
  Geräts.
- Bei grobem Zeiger (Touch) startet die Kartenleiste auf jeder Breite geschlossen. Eine selbst
  gemerkte Wahl gewinnt weiterhin. Eine Auswahl auf der Karte öffnet die Leiste wie bisher.
- Ein Tipp auf einen Marker wählt nur aus. Die Karte bleibt stehen, weder Verschieben noch Zoom.
- Ein Anflug, etwa aus einem Treffer der Objektliste, einer Ortssuche oder einem Deeplink, zoomt
  nur heran, nie heraus. Steht die Karte schon näher als der Anflugmaßstab, behält sie ihren Zoom.
- Der Tipp in ein Bündel zoomt weiterhin gewollt hinein (unverändert).

Nicht im Umfang: die leere Zeitachse (Streifen nur mit Ausblenden und Kamera-Symbol). Sie wird
Folgeaufgabe.

## Capabilities

### New Capabilities

- `lagekarte-kartenknoepfe`: Der Knopfblock der Kartensteuerung oben rechts: welche Knöpfe ein Wort
  tragen und dass der Name ohne Überfahren lesbar ist.

### Modified Capabilities

- `lagekarte-kartenleiste`: neue Anforderung, dass die Leiste bei grobem Zeiger per Vorgabe
  geschlossen startet.
- `lagekarte-klickziele`: neue Anforderung, dass ein Tipp auf einen Marker die Kamera nicht bewegt.
- `lagekarte-objektsuche`: Die Anforderung „Treffer springt an und wählt aus“ koppelt den Treffer
  nicht mehr an den Marker-Tipp. Der Anflug zoomt nur heran.

## Impact

- Frontend: `pages/lagekarte/KartenUeberlagerung.tsx` (Kartenknopf mit Wort, Blockbreite),
  `pages/lagekarte/KartenFuss.tsx` (`fussStil` mit Blockbreite), `pages/lagekarte/leistenWahl.ts`
  (`leisteSichtbar` mit Zeigerart), `pages/LagekartePage.tsx` (Marker-Tipp ohne Anflug),
  `pages/lagekarte/useKartenInteraktion.ts` (`onMarkerWaehlen` mit oder ohne Anflug),
  `pages/lagekarte/Kartenflaeche.tsx` (Anflug nur heran), `personen/BetroffeneKarte.tsx` und
  `geraet/GeraetAbschnittKarte.tsx` als Mitnutzer des Knopfblocks.
- Regeln: `frontend/src/pages/lagekarte/AGENTS.md` (Einleitung zur Leiste, Kamera-Regel, Knopfspalte).
- Anwenderdoku: Kapitel Lagekarte samt Bildern.
- Kein Backend, keine Migration, keine API.
