---
titel: Bereitstellungsräume
gruppen: [fuehrung]
reihenfolge: 350
quellen: [frontend/src/pages/bereitstellungsraum/BereitstellungsraeumeDefault.tsx, frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx, frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx, frontend/src/pages/bereitstellungsraum/BrAnlegenDrawer.tsx, frontend/src/pages/bereitstellungsraum/BrBearbeitenModal.tsx, frontend/src/pages/bereitstellungsraum/BrSwitcher.tsx, frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx, frontend/src/pages/bereitstellungsraum/brAuswahl.ts, frontend/src/pages/bereitstellungsraum/brBelegungKern.ts, frontend/src/pages/bereitstellungsraum/BrVerlauf.tsx, frontend/src/pages/bereitstellungsraum/belegungZufluss.ts, frontend/src/bereitstellungsraum/brZahlen.ts, frontend/src/kraefte/MaterialAmOrt.tsx, frontend/src/einsatz/schreibrecht.ts, frontend/src/api/queryKeys.ts, src/routes/einsatz_bereitstellungsraum.rs, src/bereitstellungsraum/mod.rs, src/bereitstellungsraum/belegung_repo.rs]
---

## Überblick

Ein **Bereitstellungsraum** (BR) ist der Ort, an dem Einheiten und Fahrzeuge auf ihren Einsatz
warten. Das Modul zeigt je Raum, wer dort bereitsteht, mit welcher Stärke und seit wann, wer am
längsten wartet, wer wann kam und ging, welche Kräfte noch keinem Raum zugewiesen sind und welches
Material dort liegt.

Dieses Kapitel beschreibt die Sicht der Einsatzleitung. Einsatzleitung und Führungspersonal legen
Räume an, ändern ihre Raumdaten, nehmen sie in Betrieb, weisen Kräfte zu und lösen Räume wieder
auf. Die Bedienung am gekoppelten Tablet eines Bereitstellungsraums beschreibt
[Bereitstellungsraum am Gerät](geraet-bereitstellungsraum.md).

## Abläufe

### Einen Bereitstellungsraum öffnen

1. Unter „Kräfte & Mittel“ „Bereitstellungsräume“ wählen. Die App öffnet den zuletzt gewählten Raum,
   sonst einen aktiven. Gibt es noch keinen, bietet sie „Ersten BR anlegen“ an.
2. Über den Namen des Raums im Seitenkopf in einen anderen Raum wechseln.
3. Für die Übersicht aller Räume in der Brotkrumenleiste „Bereitstellungsräume“ wählen. Die Liste
   zeigt je Raum Bezeichnung, Status, Abschnitt und Standort, dazu die Belegung: „Stärke“,
   „Fahrzeuge“, „Einheiten“ und „Längste Wartezeit“, mit denselben Werten wie der Raum selbst.

   ![Liste mit „BR Ost“ im Status „geplant“ ohne Belegung und „Parkplatz Stadion Nord“ im Status „aktiv“ mit Stärke 0/1/5//6, 3 Fahrzeugen, 2 Einheiten und einer längsten Wartezeit von 48 min](../bilder/bereitstellungsraeume/liste.png)

4. Über „Spalten“ lassen sich „Abschnitt“ und „Standort“ aus- und wieder einblenden; auf dem
   Handy fehlen sie zunächst, der Knopf nennt dann die Zahl der ausgeblendeten Spalten.

### Einen Bereitstellungsraum anlegen und in Betrieb nehmen

Für Einsatzleitung und Führungspersonal:

1. In der Übersicht „Neu“ wählen, oder im Seitenkopf eines Raums den Namen öffnen und „+ Neuer BR“
   wählen.
2. „Bezeichnung“ eingeben, bei Bedarf „Standort (optional)“ und „Notiz (optional)“.

   ![Seitenleiste „Bereitstellungsraum anlegen“ mit Bezeichnung „BR Süd“, Standort und Notiz](../bilder/bereitstellungsraeume/anlegen.png)

3. „Anlegen“ wählen. Die App öffnet den neuen Raum; er steht auf „geplant“.
4. Ist der Raum eingerichtet, „In Betrieb nehmen“ wählen. Er steht dann auf „aktiv“.

### Bezeichnung, Standort und Notiz ändern

Für Einsatzleitung und Führungspersonal, solange der Raum geplant oder aktiv ist:

1. Den Raum öffnen und bei „Raumdaten“ „Bearbeiten“ wählen.
2. Im Dialog „Bereitstellungsraum bearbeiten“ „Bezeichnung“, „Standort (optional)“ oder
   „Notiz (optional)“ ändern. Ein geleertes Feld löscht die Angabe; die Bezeichnung bleibt Pflicht.

   ![Dialog „Bereitstellungsraum bearbeiten“ mit Bezeichnung „Parkplatz Stadion Nord“, Standort und Notiz](../bilder/bereitstellungsraeume/bearbeiten.png)

3. „Speichern“ wählen. Die neue Bezeichnung steht im Seitenkopf, im Umschalter und in der
   Übersicht, Standort und Notiz stehen unter „Raumdaten“; die Übersicht zeigt auch den Standort.

### Kräfte zuweisen und entfernen

Für Einsatzleitung und Führungspersonal, solange der Raum aktiv ist:

1. Den Raum öffnen. Rechts steht „Kräfte ohne BR“, nach Typ gruppiert.
2. Bei Bedarf in „Kräfte suchen“ einen Namen eingeben.
3. Bei einer Einheit oder einem Fahrzeug „zuweisen“ wählen. Sie erscheint unter „Bereitgestellte
   Einheiten“ oder „Bereitgestellte Fahrzeuge“; „Bereitgestellt“ zählt die Stärke, „Fahrzeuge“ die
   Fahrzeuge im Raum, auch die der bereitgestellten Einheiten.

   ![Bereitstellungsraum „Parkplatz Stadion Nord“ mit zwei bereitgestellten Einheiten, je mit ihren Fahrzeugen und „seit … · 48 min“, Stärke 0/1/5//6, „Fahrzeuge“ 3, „Einheiten“ 2, „Längste Wartezeit“ 48 min und der Seitenleiste „Kräfte ohne BR“](../bilder/bereitstellungsraeume/raum.png)

4. Rückt eine Kraft aus, bei ihr „entfernen“ wählen. Sie steht wieder unter „Kräfte ohne BR“.

### Sehen, wer am längsten wartet

1. Den Raum öffnen. Oben stehen „Bereitgestellt“ (Stärke), „Fahrzeuge“, „Einheiten“ und
   „Längste Wartezeit“; darunter steht, seit wann die am längsten wartende Kraft im Raum ist.
2. Unter „Bereitgestellte Einheiten“ steht die Einheit, die am längsten wartet, oben. Jede Zeile
   nennt Typ, Stärke, die Funkrufnamen ihrer Fahrzeuge und „seit“ mit Uhrzeit und Wartezeit, etwa
   „seit 1342 · 48 min“. Unter „Bereitgestellte Fahrzeuge“ stehen die Fahrzeuge ohne Einheit in
   derselben Folge.
3. Eine neu zugewiesene Kraft kommt ans Ende. Die Wartezeit zählt ohne Neuladen weiter.

### Den Verlauf eines Raums lesen

1. Den Raum öffnen und ganz unten „Verlauf“ aufklappen.
2. Die Liste nennt, neueste zuerst, je Ereignis die Uhrzeit, was geschah („Eintritt“, „Austritt“,
   „Wechsel von …“, „Wechsel nach …“), die Einheit oder das Fahrzeug und, falls erfasst, eine Notiz
   wie „Einheit aufgelöst“ oder „Fahrzeug entlassen“.

   ![Aufgeklappter Verlauf des Raums „Parkplatz Stadion Nord“ mit dem Austritt des Sanitätszugs und drei Eintritten](../bilder/bereitstellungsraeume/verlauf.png)

3. Bei offenem Verlauf erscheinen neue Ereignisse ohne Neuladen.

### Material im Raum führen

Für Einsatzleitung und Führungspersonal, wenn das Modul Material freigegeben ist, auch in einem
geplanten Raum:

1. Den Raum öffnen. Unter den bereitgestellten Fahrzeugen steht „Material“ mit der Zahl der Posten
   und, falls vorhanden, dem Ausfall, je Posten Menge und Status.
2. Unter „Material zuordnen …“ einen Posten wählen: unter „Ohne Ort“ die freien Posten, unter „An
   anderem Ort“ Posten, die schon an einem anderen Ort liegen, mit diesem Ort im Eintrag. Der
   Posten liegt danach im Raum.
3. Bei einem Verbrauchsgut mit Rest „Ausgeben“ wählen, die „Menge ausgeben“ eingeben und mit
   „Ausgeben“ bestätigen; die Zeile nennt danach den Rest.
4. Mit „Lösen“ einen Posten aus dem Raum lösen. Er bleibt ohne Ort im Einsatz.

### Einen Bereitstellungsraum auflösen oder stornieren

Für Einsatzleitung und Führungspersonal:

1. Einen aktiven Raum erst leeren: alle Kräfte „entfernen“. Solange noch Kräfte dort stehen, ist
   „Auflösen“ gesperrt, daneben steht „noch … belegt“.
2. „Auflösen“ wählen und die Rückfrage „BR auflösen?“ mit „BR auflösen“ bestätigen. Der Raum steht
   dann auf „aufgelöst“.
3. Ein Raum, der nie in Betrieb war, wird stattdessen mit „Stornieren“ verworfen; die Rückfrage „BR
   stornieren?“ mit „BR stornieren“ bestätigen. Er verschwindet aus Übersicht und Umschalter.

## Hintergrund

### Status eines Raums

Ein Raum durchläuft „geplant“, „aktiv“ und „aufgelöst“. Kräfte lassen sich nur einem aktiven Raum
zuweisen, Material schon einem geplanten: so lässt sich ein Raum vorbereiten. Ein aufgelöster Raum
nimmt kein Material mehr an; „Material zuordnen …“ steht dort gesperrt mit „BR aufgelöst“, und
Material, das noch dort liegt, lässt sich lösen. Bezeichnung, Standort und Notiz lassen sich ändern, solange der Raum geplant oder aktiv
ist; ein aufgelöster Raum ist nur zu lesen.

### Wer zugewiesen werden kann

„Kräfte ohne BR“ bietet Einheiten an und Fahrzeuge ohne Einheit, sofern sie in keinem Raum stehen.
Fahrzeuge einer Einheit werden nicht einzeln zugewiesen, sondern über ihre Einheit. Eine Kraft steht
höchstens in einem Raum; soll sie in einen anderen, wird sie zuerst im alten entfernt. Die Stärke
rechnet unterstellte Einheiten mit ein und zählt keine doppelt.

### Was die Zahlen zählen

„Fahrzeuge“ zählt jedes aktive Fahrzeug im Raum genau einmal: die einzeln bereitgestellten und
die Fahrzeuge der bereitgestellten Einheiten. Die Fahrzeuge einer unterstellten Einheit zählen
nur, wenn diese Einheit selbst im Raum steht. Entlassene oder stornierte Fahrzeuge zählen nicht.
Am gekoppelten Tablet des Raums steht dieselbe Zahl.
„noch … belegt“ vor dem Auflösen zählt dagegen nur, was einzeln im Raum steht: die Einheiten und
die Fahrzeuge ohne Einheit. Die Fahrzeuge einer Einheit gehen mit ihrer Einheit und halten das
Auflösen nicht auf.

### Wartezeit und Folge

„Seit“ ist der Zeitpunkt, an dem eine Kraft zuletzt in diesen Raum kam: ihr Eintritt oder ihr
Wechsel aus einem anderen Raum. Ein früherer Aufenthalt in einem anderen Raum zählt nicht. Fehlt
ein solcher Zeitpunkt, etwa bei älteren Daten, steht die Kraft ohne Zeitangabe am Ende der Liste;
die App schätzt nichts. Die Wartezeit rechnet in ganzen Minuten gegen die Uhr des Geräts; geht
diese nach, erscheint die Wartezeit kürzer, nie negativ. Die Fahrzeuge einer Einheit tragen kein
eigenes „seit“, sie stehen mit ihrer Einheit. „Längste Wartezeit“ ist die Wartezeit der Kraft, die
am längsten im Raum steht. Eine Farbe oder Warnung für lange Wartezeiten gibt es nicht.

Die Listen ordnen fest nach Wartezeit, bei gleicher Zeit nach Namen. Steht der Mauszeiger über
der Belegung oder liegt der Fokus dort, warten Zugänge anderer Arbeitsplätze hinter dem Hinweis
„… neu“, damit keine Zeile unter dem Zeiger springt; eigene Zuweisungen erscheinen sofort.

### Verlauf

Der Verlauf führt jedes Ereignis des Raums vollständig und ungeblättert, auch Austritte durch
Auflösen einer Einheit oder Entlassen eines Fahrzeugs. Ein Wechsel steht in beiden Räumen: im
verlassenen als „Wechsel nach …“, im neuen als „Wechsel von …“. Aufgelöste Einheiten und
entlassene Fahrzeuge stehen mit ihrem Namen. Auch ein aufgelöster Raum zeigt seinen Verlauf. Der
Verlauf lädt erst beim Aufklappen; beim Wechsel in einen anderen Raum klappt er zu. Wer den Raum
lesen darf, darf auch den Verlauf lesen.

### Druck

Der Druck des Raums zeigt alle Kräfte, auch solche, die gerade hinter dem Hinweis „… neu“ warten,
jeweils mit „seit“ und der Wartezeit zum Zeitpunkt des Drucks, dazu „Längste Wartezeit“. Der
Verlauf wird nicht gedruckt, solange er zugeklappt ist; ein aufgeklappter Verlauf druckt mit.

### Material im Raum

Material liegt an genau einem Ort (Kapitel [Material](material.md)); ein Posten von einem anderen
Ort wird ohne Rückfrage umgehängt, und das Einsatztagebuch nennt den alten und den neuen Ort.
Material in einem Bereitstellungsraum steht nicht im [Meldebild](meldebild.md). Zuordnen, Lösen
und Ausgeben verlangen Schreibrecht im Einsatz und die Freigabe des Moduls Material; ohne die
Freigabe fehlt die Sektion „Material“. Am gekoppelten Tablet eines Raums fehlt sie ebenso.

### Einsatztagebuch

Das Einsatztagebuch hält fest, wenn ein Raum in Betrieb genommen oder aufgelöst wird und wenn eine
Kraft in einen Raum eintritt oder ihn verlässt, jeweils mit Namen. Das Anlegen, das Ändern der
Raumdaten und das Stornieren eines Raums stehen nicht darin. Wird ein Raum umbenannt, behalten
frühere Einträge den alten Namen.

### Rechte und ohne Netz

Lesen darf, wer das Modul Bereitstellungsräume sieht. Anlegen, ändern, in Betrieb nehmen,
zuweisen, entfernen, auflösen und stornieren dürfen Einsatzleitung und Führungspersonal, solange
der Einsatz läuft (Kapitel [Rechte im Einsatz](rechte-im-einsatz.md)). Die Bereitstellungsräume
gehören nicht zu dem, was die App für die Arbeit ohne Netz vorhält (Kapitel
[Ohne Netz](ohne-netz.md)).
