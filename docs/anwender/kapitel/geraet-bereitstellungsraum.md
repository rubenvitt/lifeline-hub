---
titel: Bereitstellungsraum am Gerät
gruppen: [geraete]
reihenfolge: 740
quellen: [frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx, frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx, frontend/src/pages/bereitstellungsraum/BrVerlauf.tsx, frontend/src/bereitstellungsraum/brZahlen.ts, frontend/src/geraet/GeraeteLayout.tsx, frontend/src/geraet/GeraetMeldungenPage.tsx, frontend/src/geraet/GeraetMeldungen.tsx, frontend/src/geraet/geraetSicht.ts, src/geraet/mod.rs]
---

## Überblick

Ein Tablet am **Bereitstellungsraum** führt die Kräfte, die dort bereitstehen: Es meldet
Einheiten und Fahrzeuge an und ab, nimmt einen geplanten Raum in Betrieb und schickt Meldungen an
die Einsatzleitung. Es ist an genau einen Bereitstellungsraum gekoppelt (siehe
[Geräte koppeln](geraete-koppeln.md)) und zeigt nur diesen.

Die Navigation unten führt zu „Raum“ und „Melden“. Die Bedienung des Geräts selbst steht in
[Gerät bedienen](geraet-bedienen.md).

## Abläufe

### Raum in Betrieb nehmen

1. „Raum“ öffnen. Ein Raum, den die Einsatzleitung erst geplant hat, trägt „geplant“.

   ![Geplanter Bereitstellungsraum „Sportplatz Süd“ mit Standort, leerer Belegung und dem Knopf „In Betrieb nehmen“](../bilder/geraet-bereitstellungsraum/geplant.png)

2. Sobald der Raum besetzt ist, „In Betrieb nehmen“ wählen. Der Raum trägt danach „aktiv“.

Im Zustand „geplant“ nimmt der Raum noch keine Kräfte an; die Knöpfe zum Zuweisen fehlen.

### Kräfte anmelden

1. „Raum“ öffnen. Rechts stehen unter „Kräfte ohne BR“ die Einheiten und die Fahrzeuge ohne
   Einheit, die keinem Bereitstellungsraum zugeordnet sind.
2. Bei Bedarf unter „Kräfte suchen“ den Namen eingeben.
3. Bei der eintreffenden Kraft „zuweisen“ wählen. Sie erscheint am Ende von „Bereitgestellte
   Einheiten“ oder „Bereitgestellte Fahrzeuge“ mit „seit“ und ihrer Wartezeit; die Kennzahl
   „Bereitgestellt“ zählt die Stärke mit. Oben steht, wer am längsten wartet.

   ![Aktiver Bereitstellungsraum mit zwei bereitgestellten Einheiten, je mit ihren Fahrzeugen und „seit … · 0 min“, Stärke 0/2/2//4, „Fahrzeuge“ 4, „Einheiten“ 2, „Längste Wartezeit“ 0 min und dem Sanitätszug unter „Kräfte ohne BR“](../bilder/geraet-bereitstellungsraum/raum.png)

### Kräfte abmelden

1. „Raum“ öffnen.
2. Bei der Kraft, die den Raum verlässt, „entfernen“ wählen. Sie steht danach wieder unter „Kräfte
   ohne BR“.

### Verlauf lesen

1. „Raum“ öffnen und ganz unten „Verlauf“ aufklappen.
2. Die Liste nennt, neueste zuerst, wann welche Kraft eingetreten, ausgetreten oder aus einem
   anderen Raum gewechselt ist. Ein Wechsel nennt den anderen Raum mit seiner Bezeichnung.

### Meldung an die Einsatzleitung

1. Unten „Melden“ wählen.
2. Den „Inhalt“ eingeben und die „Priorität“ (normal, dringend, sofort) wählen.

   ![Seite „Melden“ mit einer dringenden Meldung zur Zufahrt und der leeren Liste „Eigene Meldungen“](../bilder/geraet-bereitstellungsraum/melden.png)

3. „Meldung senden“ wählen. Die Bestätigung lautet „Meldung #… gesendet“; die Meldung steht danach
   unter „Eigene Meldungen“.

## Hintergrund

### Was das Tablet nicht tut

Das Tablet führt nur seinen eigenen Raum. Es legt keinen Raum an, wechselt nicht in einen anderen,
ändert weder Stammdaten noch Bezeichnung, Standort und Notiz des Raums, löst den Raum nicht auf und
storniert ihn nicht; das bleibt der Einsatzleitung. Auch an den Einheiten und Fahrzeugen selbst ändert es nichts.

### Verlauf und Wartezeiten

Das Tablet liest den Verlauf seines eigenen Raums wie die Einsatzleitung; Wartezeit, Folge und
Verlauf beschreibt das Kapitel [Bereitstellungsräume](bereitstellungsraeume.md). Von einem anderen
Raum sieht es nur die Bezeichnung in einem Wechsel, nicht dessen Belegung oder Verlauf.

### Absender der Meldungen

Meldungen tragen den Raum und die Gerätebezeichnung als Absender, etwa „Sportplatz Süd · Tablet
Einweiser“.
