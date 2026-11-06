---
titel: Einheit am Gerät
gruppen: [geraete]
reihenfolge: 755
quellen: [frontend/src/geraet/GeraetAuftraegePage.tsx, frontend/src/geraet/GeraetStatusPage.tsx, frontend/src/geraet/GeraetMeldenPage.tsx, frontend/src/geraet/GeraetMeldungen.tsx, frontend/src/geraet/StandortFeld.tsx, frontend/src/geraet/auftragsVibration.ts, frontend/src/geraet/GeraeteLayout.tsx, frontend/src/pages/EinheitDetailPage.tsx, frontend/src/pages/einstellungen/EinsatzGeraete.tsx, frontend/src/auftraege/AuftragKarte.tsx, frontend/src/auftraege/VollzugMeldenModal.tsx, frontend/src/auftraege/EmpfaengerQuittung.tsx, src/geraet/mod.rs, src/geraet/abschnitt.rs]
---

## Überblick

Ein Handy der **Einheit** arbeitet für genau eine Einheit des Einsatzes, etwa einen Trupp oder
eine Gruppe ohne eigenes Konto: Es zeigt die Aufträge an diese Einheit, setzt ihren Status und
schickt Meldungen an die Einsatzleitung, auf Wunsch mit dem eigenen Standort. Es ist an genau
eine Einheit gekoppelt (siehe [Geräte koppeln](geraete-koppeln.md)).

Die Navigation unten führt zu „Aufträge“, „Status“ und „Melden“. Die Bedienung des Geräts selbst
steht in [Gerät bedienen](geraet-bedienen.md).

## Abläufe

### Handy an eine Einheit koppeln

Für die Einsatzleitung:

1. Die Einheit öffnen (siehe [Einheiten](einheiten.md)) und unter „Gerät“ „Gerät koppeln“ wählen.
   Die Kopplung öffnet sich mit der Ansicht „Einheit“ und dieser Einheit.
2. Die „Gerätebezeichnung“ eintragen, „Koppeln“ wählen und den Code mit dem Handy einlesen.

Dasselbe geht in den Einstellungen des Einsatzes unter „Geräte“ mit der Ansicht „Einheit“.
Gekoppelt wird nur an eine Einheit, die noch nicht aufgelöst ist.

### Auftrag quittieren und Vollzug melden

1. „Aufträge“ öffnen. Die Liste zeigt die offenen Aufträge an die eigene Einheit, dringende
   zuerst.
2. Bei „Quittung offen:“ neben der eigenen Einheit „Quittieren“ wählen und mit „Empfang
   quittieren“ bestätigen.
3. „Bearbeitung beginnen“ wählen, sobald der Auftrag in Arbeit ist.
4. Ist er erledigt, „Vollzug melden“ wählen, die Rückmeldung eintragen und „Vollzug melden“
   bestätigen. Die Abnahme liegt bei der Einsatzleitung.

### Status setzen

1. Unten „Status“ wählen. Oben steht der aktuelle Status der Einheit mit „seit“.
2. Darunter steht je Status des Statuskatalogs eine Fläche. Die passende antippen. Die
   Einsatzleitung sieht den neuen Status sofort, das Einsatztagebuch hält den Wechsel fest.

Führt die Einheit ein Fahrzeug, ergibt sich ihr Status aus dem Fahrzeug: Das Handy zeigt ihn
dann nur an.

### Meldung mit Standort

1. Unten „Melden“ wählen.
2. Den „Inhalt“ eingeben, „Art“ und „Priorität“ wählen.
3. Bei Bedarf „Mein Standort“ wählen. Das Handy ermittelt den Standort einmal und zeigt ihn mit
   seiner Genauigkeit an; das Kreuz daneben nimmt ihn wieder heraus.
4. „Meldung senden“ wählen. Die Meldung steht danach unter „Eigene Meldungen“.

## Hintergrund

### Was das Handy sieht und darf

Das Handy sieht nur die eigene Einheit. Aufträge an ihren Abschnitt erscheinen nicht, nur
Aufträge, die die Einheit selbst als Empfänger nennen. Quittieren kann es nur die Zeile der
eigenen Einheit. Andere Einheiten, Abschnitte, Einsatzbefehle, Karte und Einsatztagebuch gehen
am Handy nicht, ebenso Aufträge erteilen oder abnehmen und Einheiten ändern. Den Status
entfernen kann nur die Führung.

Ein Ziel unten erscheint nur, wenn das Modul dahinter im Einsatz freigegeben ist.

### Absender und Standort

Als Absender einer Meldung setzt der Server die gekoppelte Einheit; bei der Einsatzleitung steht
sie damit als Rückmeldung der Einheit. Einen anderen Absender nimmt der Server nicht an.
Der Standort wird nur auf Knopfdruck ermittelt, das Handy verfolgt die Einheit nicht laufend.
Bei der Einsatzleitung steht er an der Meldung und führt auf die Lagekarte.

### Ohne Verbindung

Ohne Verbindung zeigen „Aufträge“ und „Status“ den letzten Stand. Quittieren, Vollzug melden und
den Status setzen sind dann gesperrt, damit nichts Veraltetes nachträglich ankommt. Eine
Meldung merkt das Handy vor und sendet sie, sobald die Verbindung wieder steht.

### Kurze Vibration

Kommt ein neuer Auftrag an die eigene Einheit, vibriert das Handy einmal kurz, sofern es das
kann. Einen Ton spielt es nie, und beim Öffnen vibriert es nicht für schon bekannte Aufträge.

### Wenn die Einheit aufgelöst wird

Löst die Einsatzleitung die Einheit auf, endet die Kopplung des Handys; es zeigt dann „Kopplung
beendet“ (siehe [Gerät bedienen](geraet-bedienen.md)). Das Einsatztagebuch nennt das Gerät.
