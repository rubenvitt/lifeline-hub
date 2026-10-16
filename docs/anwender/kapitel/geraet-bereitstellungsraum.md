---
titel: Bereitstellungsraum am Gerät
gruppen: [geraete]
reihenfolge: 740
quellen: [frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx, frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx, frontend/src/pages/bereitstellungsraum/BrVerlauf.tsx, frontend/src/bereitstellungsraum/brZahlen.ts, frontend/src/geraet/GeraeteLayout.tsx, frontend/src/geraet/GeraetMeldungenPage.tsx, frontend/src/geraet/GeraetMeldungen.tsx, frontend/src/geraet/geraetSicht.ts, src/geraet/mod.rs, frontend/src/pages/bereitstellungsraum/EintreffenDialog.tsx, frontend/src/kraefte/AdhocFahrzeugFelder.tsx, src/bereitstellungsraum/eintreffen.rs]
---

## Überblick

Ein Tablet am **Bereitstellungsraum** führt die Kräfte, die dort bereitstehen: Es bucht
eintreffende Einheiten und Fahrzeuge ein, auch solche, die im Einsatz noch niemand kennt, meldet
Kräfte ab, nimmt einen geplanten Raum in Betrieb und schickt Meldungen an die Einsatzleitung. Es ist an genau einen Bereitstellungsraum gekoppelt (siehe
[Geräte koppeln](geraete-koppeln.md)) und zeigt nur diesen.

Die Navigation unten führt zu „Raum“ und „Melden“. Die Bedienung des Geräts selbst steht in
[Gerät bedienen](geraet-bedienen.md).

## Abläufe

### Raum in Betrieb nehmen

1. „Raum“ öffnen. Ein Raum, den die Einsatzleitung erst geplant hat, trägt „geplant“.

   ![Geplanter Bereitstellungsraum „Sportplatz Süd“ mit Standort, leerer Belegung, dem Knopf „In Betrieb nehmen“ und daneben „Eintreffen buchen“ gesperrt mit „BR nicht in Betrieb“](../bilder/geraet-bereitstellungsraum/geplant.png)

2. Sobald der Raum besetzt ist, „In Betrieb nehmen“ wählen. Der Raum trägt danach „aktiv“.

Im Zustand „geplant“ nimmt der Raum noch keine Kräfte an: die Knöpfe zum Zuweisen fehlen,
„Eintreffen buchen“ steht gesperrt mit „BR nicht in Betrieb“.

### Eintreffen buchen

1. „Raum“ öffnen und oben „Eintreffen buchen“ wählen. Die Suche füllt den Bildschirm.
2. Den Namen oder einen Funkrufnamen der Kraft eingeben. Die Treffer stehen unter „Erwartet“ und
   „Im Einsatz“.
3. Beim Treffer „Eintreffen“ wählen. Die Bestätigung lautet „… gebucht“; die Kraft erscheint am
   Ende von „Bereitgestellte Einheiten“ oder „Bereitgestellte Fahrzeuge“ mit „seit“ und ihrer
   Wartezeit. Oben steht, wer am längsten wartet.

   ![Aktiver Bereitstellungsraum mit drei bereitgestellten Einheiten, je mit „seit … · 0 min“, die unangemeldete „Florian Nachbarort 1/46-1“ mit „nicht übernommen“, und „Kräfte ohne BR“ mit zugeklapptem „Im Einsatz“](../bilder/geraet-bereitstellungsraum/raum.png)

### Eine unangemeldete Kraft buchen

1. Wie oben „Eintreffen buchen“ wählen und den Funkrufnamen eingeben.
2. Findet die Suche die Kraft nicht, „Nicht in der Liste“ wählen. „Funkrufname“ ist mit der Suche
   vorbelegt.
3. Was die Kraft meldet eintragen: „Trägerorganisation“, „Fahrzeugtyp“ und „Stärke“, unter
   „Bemerkung“ einen freien Text, unter „Weiteres Fahrzeug“ die übrigen Fahrzeuge.

   ![Vollflächiger Dialog „Eintreffen buchen“ mit Funkrufname, Trägerorganisation „FF Nachbarort“, Fahrzeugtyp „HLF 20“, Stärke 0/1/8 und dem Knopf „Unangemeldet buchen“](../bilder/geraet-bereitstellungsraum/unangemeldet.png)

4. „Unangemeldet buchen“ wählen. Die Bestätigung lautet „… unangemeldet gebucht, Einsatzleitung
   informiert“. Die Kraft steht als neue Einheit im Raum und trägt „nicht übernommen“, bis die
   Einsatzleitung sie übernimmt oder abweist.
5. Steht „Schon im Einsatz: …“, kennt der Einsatz den Funkrufnamen schon. „Diese buchen“ bucht die
   vorhandene Kraft; „Trotzdem neu anlegen“ nur, wenn es wirklich eine andere Kraft ist.

### Kräfte aus der Liste zuweisen

1. „Raum“ öffnen. Rechts stehen unter „Kräfte ohne BR“ die Einheiten und die Fahrzeuge ohne
   Einheit, die keinem Bereitstellungsraum zugeordnet sind: oben „Erwartet“, darunter zugeklappt
   „Im Einsatz“ für Kräfte, die schon in einem Abschnitt stehen.
2. Bei Bedarf unter „Kräfte suchen“ den Namen eingeben.
3. Bei der Kraft „zuweisen“ wählen. Anders als „Eintreffen“ trägt das kein Eintreffen in die
   Zeitachse der Kraft ein.

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
storniert ihn nicht; das bleibt der Einsatzleitung. Auch an den Einheiten und Fahrzeugen selbst ändert es nichts,
mit einer Ausnahme: „Unangemeldet buchen“ legt eine neue Einheit mit ihren Fahrzeugen an. Ob sie
bleibt, entscheidet die Einsatzleitung; Übernehmen und Abweisen gibt es am Tablet nicht (Kapitel
[Einheiten](einheiten.md)). Die Suche findet nur Kräfte des Einsatzes, keine aus den Stammdaten.

### Was ein Eintreffen schreibt

„Eintreffen“ bucht den Eintritt in den Raum und bei einer Einheit das Eintreffen in ihrer
Zeitachse, mit genau einem Eintrag im Einsatztagebuch. Eine unangemeldete Kraft schickt dazu eine
Meldung an die Einsatzleitung; die Bemerkung steht nicht darin. Einzelheiten stehen im Kapitel
[Bereitstellungsräume](bereitstellungsraeume.md).

### Verlauf und Wartezeiten

Das Tablet liest den Verlauf seines eigenen Raums wie die Einsatzleitung; Wartezeit, Folge und
Verlauf beschreibt das Kapitel [Bereitstellungsräume](bereitstellungsraeume.md). Von einem anderen
Raum sieht es nur die Bezeichnung in einem Wechsel, nicht dessen Belegung oder Verlauf.

### Absender der Meldungen

Meldungen tragen den Raum und die Gerätebezeichnung als Absender, etwa „Sportplatz Süd · Tablet
Einweiser“.
