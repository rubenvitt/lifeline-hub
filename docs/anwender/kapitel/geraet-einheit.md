---
titel: Einheit am Gerät
gruppen: [geraete]
reihenfolge: 755
quellen: [frontend/src/geraet/GeraetAuftraegePage.tsx, frontend/src/geraet/GeraetStatusPage.tsx, frontend/src/geraet/GeraetMeldenPage.tsx, frontend/src/geraet/GeraetMeldungen.tsx, frontend/src/geraet/StandortFeld.tsx, frontend/src/geraet/GeraetKontaktePage.tsx, frontend/src/personen/LeichterFallModal.tsx, frontend/src/geraet/auftragsVibration.ts, frontend/src/geraet/GeraeteLayout.tsx, frontend/src/pages/EinheitDetailPage.tsx, frontend/src/pages/einstellungen/EinsatzGeraete.tsx, frontend/src/auftraege/AuftragKarte.tsx, frontend/src/auftraege/VollzugMeldenModal.tsx, frontend/src/auftraege/EmpfaengerQuittung.tsx, src/geraet/mod.rs, src/geraet/abschnitt.rs, src/geraet/stelle.rs, src/routes/einsatz_person.rs]
---

## Überblick

Ein Handy der **Einheit** arbeitet für genau eine Einheit des Einsatzes, etwa einen Trupp oder
eine Gruppe ohne eigenes Konto: Es zeigt die Aufträge an diese Einheit, setzt ihren Status und
schickt Meldungen an die Einsatzleitung, auf Wunsch mit dem eigenen Standort. Unter „Kontakte“
hält es fest, wen die Einheit versorgt hat, und fordert bei Bedarf einen RTW an. Es ist an genau
eine Einheit gekoppelt (siehe [Geräte koppeln](geraete-koppeln.md)).

Die Navigation unten führt zu „Aufträge“, „Status“, „Melden“ und „Kontakte“. Die Bedienung des
Geräts selbst steht in [Gerät bedienen](geraet-bedienen.md).

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

### Kontakt erfassen

Für eine Person, die die Einheit vor Ort versorgt, etwa bei Hitze oder einer kleinen Verletzung:

1. Unten „Kontakte“ wählen und oben „Kontakt“ antippen. Das Handy ermittelt dabei einmal den
   eigenen Standort.
2. Den „Anlass“ wählen, bei Bedarf bis zu drei „Maßnahmen“ und den „Fundort“.
3. Den Ausgang wählen:
   - „Entlassen“: die Person ist versorgt und geht ihrer Wege.
   - „Zur UHS“: die Einheit bringt die Person in die Unfallhilfsstelle. Gibt es mehrere, vorher
     die UHS wählen; die Wahl bleibt für den nächsten Kontakt stehen. Die Person steht danach im
     Eingang dieser UHS.
   - „RTW nötig“: siehe unten.

Name, Alter und andere Personalien nimmt das Handy nicht auf. Die Liste unter „Kontakte“ zeigt
die Kontakte der eigenen Einheit mit Registriernummer, Uhrzeit, Anlass und Ausgang, neueste oben.

### RTW anfordern

1. Wie oben einen Kontakt beginnen und den Anlass wählen.
2. „RTW nötig“ wählen. Bei der Einsatzleitung geht sofort eine Sofortmeldung „RTW angefordert“
   mit Registriernummer und Ort ein, die sie bestätigen muss.
3. In der Liste steht am Kontakt „RTW offen bis …“, nach der Bestätigung „RTW bestätigt“. Ist die
   Frist abgelaufen, steht dort „RTW · Funk“: dann die Einsatzleitung über Funk ansprechen.

## Hintergrund

### Was das Handy sieht und darf

Das Handy sieht nur die eigene Einheit. Aufträge an ihren Abschnitt erscheinen nicht, nur
Aufträge, die die Einheit selbst als Empfänger nennen. Quittieren kann es nur die Zeile der
eigenen Einheit. Andere Einheiten, Abschnitte, Einsatzbefehle, Karte und Einsatztagebuch gehen
am Handy nicht, ebenso Aufträge erteilen oder abnehmen und Einheiten ändern. Den Status
entfernen kann nur die Führung.

Ein Ziel unten erscheint nur, wenn das Modul dahinter im Einsatz freigegeben ist; „Kontakte“
braucht das Modul Personen.

### Kontakte und Personalien

Das Handy sieht nur Kontakte mit der eigenen Einheit als versorgender Einheit, und auch diese
ohne Namen und Personalien. Ändern kann es einen Kontakt nach dem Erfassen
nicht; das übernimmt die UHS oder die Einsatzleitung (siehe [Betroffene](betroffene.md)). Jeder
Kontakt steht mit einem Eintrag im Einsatztagebuch, etwa „Person R-012 von Streife 2 versorgt und
entlassen“.

### Absender und Standort

Als Absender einer Meldung setzt der Server die gekoppelte Einheit; bei der Einsatzleitung steht
sie damit als Rückmeldung der Einheit. Einen anderen Absender nimmt der Server nicht an.
Der Standort wird nur auf Knopfdruck ermittelt, das Handy verfolgt die Einheit nicht laufend.
Bei der Einsatzleitung steht er an der Meldung und führt auf die Lagekarte.

### Ohne Verbindung

Ohne Verbindung zeigen „Aufträge“ und „Status“ den letzten Stand. Quittieren, Vollzug melden und
den Status setzen sind dann gesperrt, damit nichts Veraltetes nachträglich ankommt. Eine
Meldung und einen Kontakt mit „Entlassen“ oder „Zur UHS“ merkt das Handy vor und sendet sie,
sobald die Verbindung wieder steht. Ein RTW geht ohne Verbindung nicht: Der Knopf heißt dann
„RTW über Funk“ und ist gesperrt, denn eine RTW-Anforderung darf nicht unbemerkt warten.

### Kurze Vibration

Kommt ein neuer Auftrag an die eigene Einheit, vibriert das Handy einmal kurz, sofern es das
kann. Einen Ton spielt es nie, und beim Öffnen vibriert es nicht für schon bekannte Aufträge.

### Wenn die Einheit aufgelöst wird

Löst die Einsatzleitung die Einheit auf, endet die Kopplung des Handys; es zeigt dann „Kopplung
beendet“ (siehe [Gerät bedienen](geraet-bedienen.md)). Das Einsatztagebuch nennt das Gerät.
