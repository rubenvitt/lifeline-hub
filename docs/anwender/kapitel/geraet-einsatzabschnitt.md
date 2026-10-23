---
titel: Einsatzabschnitt am Gerät
gruppen: [geraete]
reihenfolge: 750
quellen: [frontend/src/geraet/GeraetAbschnittPage.tsx, frontend/src/geraet/GeraetAuftraegePage.tsx, frontend/src/geraet/GeraetMeldenPage.tsx, frontend/src/geraet/GeraetMeldungen.tsx, frontend/src/geraet/GeraetAbschnittKarte.tsx, frontend/src/geraet/GeraeteLayout.tsx, frontend/src/auftraege/AuftragKarte.tsx, frontend/src/auftraege/VollzugMeldenModal.tsx, frontend/src/geraet/GeraetBefehle.tsx, frontend/src/auftraege/EmpfaengerQuittung.tsx, src/geraet/mod.rs, src/routes/befehl.rs]
---

## Überblick

Ein Tablet im **Einsatzabschnitt** begleitet die Abschnittsleitung: Es zeigt den eigenen
Abschnitt mit seinen Unterabschnitten und Einheiten, nimmt Aufträge und Einsatzbefehle an den
Abschnitt entgegen, meldet den Vollzug der Aufträge und schickt Meldungen an die
Einsatzleitung. Es ist an genau einen Abschnitt gekoppelt (siehe
[Geräte koppeln](geraete-koppeln.md)) und sieht dessen **Teilbaum**: den Abschnitt selbst und alle
Abschnitte darunter.

Die Navigation unten führt zu „Abschnitt“, „Aufträge“, „Melden“ und „Karte“. Die Bedienung des
Geräts selbst steht in [Gerät bedienen](geraet-bedienen.md).

## Abläufe

### Abschnitt und Einheiten im Blick behalten

1. „Abschnitt“ öffnen. Oben stehen „Kurzbezeichnung“, „Abschnittsleiter“, „Lagezustand“,
   „Abschnittsauftrag“, „Funk“ (Rufname und Sprechgruppen), „Telefon“ und die Stärke, einmal für den Abschnitt und
   einmal einschließlich der Unterabschnitte.
2. Darunter listet „Einheiten“ alle Einheiten des Teilbaums mit Abschnitt, Stärke und Status.

   ![Seite „Sanitätsdienst“ eines Abschnittstablets mit den Daten des Abschnitts EA 1 und dem Beginn der Einheitenliste](../bilder/geraet-einsatzabschnitt/abschnitt.png)

### Auftrag quittieren und bearbeiten

1. „Aufträge“ öffnen. Die Liste zeigt die offenen Aufträge an den Teilbaum und seine Einheiten,
   dringende zuerst.

   ![Liste „Aufträge“ mit drei offenen Aufträgen an Abschnitte und eine Einheit, je mit „Quittieren“, „Bearbeitung beginnen“ und „Vollzug melden“](../bilder/geraet-einsatzabschnitt/auftraege.png)

2. Bei „Quittung offen:“ neben dem eigenen Empfänger „Quittieren“ wählen und die Rückfrage mit
   „Empfang quittieren“ bestätigen.
3. „Bearbeitung beginnen“ wählen, sobald der Auftrag in Arbeit ist.

### Vollzug melden

1. Beim Auftrag „Vollzug melden“ wählen.
2. Im Dialog „Vollzug melden“ die Rückmeldung zur Erledigung eintragen.

   ![Dialog „Vollzug melden“ mit der Rückmeldung „Gemeindehaus eingerichtet, vier Behandlungsplätze bereit“](../bilder/geraet-einsatzabschnitt/vollzug.png)

3. „Vollzug melden“ wählen. Der Auftrag verlässt die Liste; die Abnahme liegt bei der
   Einsatzleitung.

### Einsatzbefehl quittieren

1. „Aufträge“ öffnen. Unter den Aufträgen stehen bei „Einsatzbefehle“ die Befehle, in deren
   Verteiler der Teilbaum oder eine seiner Einheiten steht.

   ![Block „Einsatzbefehle“ mit einem Befehl an den eigenen Abschnitt „Sanitätsdienst“ und den Abschnitt „Betreuung“, „Quittieren“ nur beim eigenen, darunter „Befehlstext“](../bilder/geraet-einsatzabschnitt/befehl.png)

2. „Befehlstext“ wählen, um den Befehl zu lesen.
3. Bei „Quittung offen:“ neben dem eigenen Empfänger „Quittieren“ wählen. Eine Rückfrage gibt es
   nicht.
4. Der Hinweis „Empfang quittiert“ bietet sechs Sekunden lang „Rückgängig“: Er nimmt die Quittung
   zurück, der Empfänger steht wieder unter „Quittung offen:“.

### Meldung an die Einsatzleitung

1. Unten „Melden“ wählen.
2. Den „Inhalt“ eingeben, unter „Art“ „Meldung“ oder „Lagemeldung“ und die „Priorität“ (normal,
   dringend, sofort) wählen. Eine Lagemeldung steht bei der Führung gleich in den Lagemeldungen.
3. „Meldung senden“ wählen. Die Bestätigung lautet „Meldung #… gesendet“; die Meldung steht
   danach unter „Eigene Meldungen“.

### Karte ansehen

1. Unten „Karte“ wählen. Sie zeigt die Flächen des Teilbaums, die eigenen Einheiten, den
   Einsatzort und die Gefahrenzonen des Einsatzes.

Die Karte ist nur zum Lesen: Zeichnen und Messen gibt es am Gerät nicht.

## Hintergrund

### Was das Tablet sieht und darf

Das Tablet sieht nur seinen Teilbaum: die Einheiten und Aufträge benachbarter Abschnitte
erscheinen nicht. Quittieren kann es nur Empfängerzeilen aus dem eigenen Teilbaum. Aufträge
erteilen oder abnehmen, Abschnitte oder Einheiten ändern, das Einsatztagebuch lesen und Personen
erfassen gehen am Gerät nicht.

Von den Einsatzbefehlen sieht das Tablet nur die geltende Fassung, also die zuletzt freigegebene,
und nur, wenn der Teilbaum oder eine seiner Einheiten im Verteiler steht. Entwürfe und überholte
Fassungen erscheinen nicht. Die Quittung trägt das Einsatztagebuch wie jede andere ein, mit dem
Empfänger als Absender; an der Einsatzleitung steht sie im Verteiler des Befehls (siehe
[Aufträge und Befehle](auftraege-befehle.md)). Befehle entwerfen, freigeben, fortschreiben und
ihre Anlagen öffnen gehen am Gerät nicht.

Ein Ziel unten erscheint nur, wenn das Modul dahinter im Einsatz freigegeben ist: Ohne Aufträge,
Meldungen oder Lagekarte fehlen „Aufträge“, „Melden“ oder „Karte“.

### Absender der Meldungen

Als Absender einer Meldung setzt der Server den gekoppelten Abschnitt; der Text nennt Abschnitt
und Gerät. Einen anderen Abschnitt als Absender nimmt der Server nicht an.

### Wenn der Abschnitt aufgelöst wird

Löst die Einsatzleitung den Abschnitt auf, endet die Kopplung des Tablets; es zeigt dann
„Kopplung beendet“ (siehe [Gerät bedienen](geraet-bedienen.md)).
