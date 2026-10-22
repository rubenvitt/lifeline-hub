---
titel: Meldungen
gruppen: [alle, fuehrung]
reihenfolge: 110
quellen: [[frontend/src/etb/EtbBacklinkBadges.tsx, frontend/src/pages/MeldungenPage.tsx, frontend/src/meldungen/MeldungFormular.tsx, frontend/src/meldungen/MeldungKarte.tsx, frontend/src/meldungen/LagerelevantModal.tsx, frontend/src/pages/einheit/EinheitUebernahme.tsx, frontend/src/components/Erfassung.tsx, frontend/src/kommunikation/phase.ts, frontend/src/kommunikation/rueckgaengig.tsx, frontend/src/einsatz/AlarmZentrale.tsx, frontend/src/alarm/useBenachrichtigungen.ts, frontend/src/alarm/meldungInhalt.ts, frontend/src/alarm/useEingangshinweis.tsx, frontend/src/pages/einstellungen/EinsatzVerhalten.tsx, src/routes/meldung.rs, src/meldung/repo.rs, src/meldung/mod.rs, src/meldung/benachrichtigung.rs, src/benachrichtigung/text.rs, src/routes/auftrag.rs, src/erinnerung/benachrichtigung.rs, openspec/specs/meldungseingang/spec.md]
---

## Überblick

Das Modul „Meldungen (eingehend)“ sammelt, was von außen oder aus den eigenen Einheiten an die
Führung kommt: Funksprüche, Anrufe, persönliche Meldungen. Jede Meldung hat einen Wortlaut, einen
Absender, auf Wunsch einen Empfänger und eine Empfängerfunktion, eine Meldungsart und eine
Priorität. Sie durchläuft die
Stufen **Neu**, **Gesichtet**, **In Bearbeitung** und **Erledigt**.

Eine **Sofortmeldung** verlangt eine Bestätigung. Bleibt sie über die Frist hinaus unbestätigt,
schlägt die App Alarm.

Lesen dürfen alle mit Zugang zum Einsatz. Erfassen und Bearbeiten dürfen Einsatzleitung und
Führungspersonal, solange der Einsatz läuft (siehe [Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Meldungen sichten und abarbeiten

1. Im Einsatz das Modul „Meldungen (eingehend)“ öffnen. Oben stehen die Kennzahlen
   „Unbearbeitet“, „In Arbeit“, „Bestätigung überfällig“ und „Erledigt“.

   ![Meldungen mit Kennzahlen, den Ansichten „Offen“ und „Abgeschlossen“ und offenen Meldungskarten mit „Sichten“ und „Bearbeiter zuweisen“](../bilder/meldungen/meldungen-liste.png)

2. Mit „Offen“ und „Abgeschlossen“ die Ansicht wählen, mit „Alle Richtungen“, „Intern“ und
   „Extern“ die Richtung.
3. An einer Karte die nächste Stufe wählen: „Sichten“, dann „Bearbeitung beginnen“, dann „Als
   erledigt melden“. Die Rückfrage „Meldung auf „Erledigt“ setzen?“ schließt die Meldung ab.
4. Bei Bedarf unter „Bearbeiter zuweisen“ eine Person aus dem Einsatz eintragen.

Nach einem Stufenwechsel bietet ein Hinweis sechs Sekunden lang „Rückgängig“. Die Liste ordnet
nach Priorität, dann eskalierte Meldungen zuerst, dann die neueste Ereigniszeit oben.

### Eine Meldung erfassen

Für Einsatzleitung und Führungspersonal:

1. „Meldung erfassen“ wählen. Das Formular „Neue Meldung erfassen“ öffnet sich über der Liste.
2. Für eine eilige Meldung „Sofortmeldung“ wählen; das setzt Meldungsart und Priorität auf
   „Sofort“ und schaltet die Bestätigung ein. „Lagemeldung (extern)“ belegt die Meldungsart
   „Lagemeldung“ und die Richtung „Extern“ vor.

   ![Formular „Neue Meldung erfassen“ als Sofortmeldung mit Wortlaut, Absender, Empfängerfunktion, Empfänger und aufgeklappten weiteren Angaben samt Bestätigungsschalter](../bilder/meldungen/meldung-erfassen.png)

3. „Inhalt / Wortlaut“ und „Absender (Funkrufname/Stelle)“ ausfüllen. Ist die Meldung an eine
   Funktion im Stab gerichtet, unter „Empfängerfunktion“ die Einsatzleitung oder das Sachgebiet
   wählen; ein leeres „Empfänger / Adressat“ füllt sich dabei mit dem Kürzel, etwa „S2“. Bei
   Bedarf „Empfänger / Adressat“ frei eintragen oder ändern.
4. Unter „Weitere Angaben“ bei Bedarf „Von Einheit / Abschnitt“ (belegt den Absender vor),
   „Meldeweg“, „Meldungsart“, „Priorität“, „Richtung“, „Zeitpunkt des Ereignisses“ und die Frist
   der Bestätigung setzen.
5. „Meldung erfassen“ wählen.

Eine Meldung der Art „Lagemeldung“ steht ab dem Erfassen in den Lagemeldungen, ohne Übergabe; bei
dieser Art steht unter „Weitere Angaben“ zusätzlich „Verortung (optional)“ (Kapitel
[Lagemeldungen](lagemeldungen.md)).

Für mehrere Meldungen hintereinander speichert „Speichern und nächste“ (Strg+Enter, am Mac
⌘+Enter) und leert das Formular. Mit dem Häkchen „Werte behalten“ bleiben dabei „Von Einheit /
Abschnitt“, Absender, Meldeweg, Empfängerfunktion und Empfänger stehen.

### Eine Sofortmeldung bestätigen

Für Einsatzleitung und Führungspersonal:

1. Beim Eingang einer Sofortmeldung erscheint ein Alarm mit Absender und Anfang des Wortlauts,
   etwa „Sofortmeldung · Rettungsstaffel“ und darunter „Kellerabgang Mühlbachweg 34: eine schwer
   verletzte Person …“. Den ganzen Wortlaut zeigt der Zeiger über der Zeile. „Öffnen“ führt zur
   Meldung und hebt ihre Karte hervor, ebenso ein Klick auf die Meldung des Betriebssystems.
2. Die Karte der Sofortmeldung trägt „Bestätigung offen bis …“. An ihr „Bestätigen“ wählen und
   die Rückfrage „Sofortmeldung bestätigen?“ mit „Bestätigen“ beantworten.

Die Karte zeigt danach, wer wann quittiert hat. Wer bestätigt, hat die Meldung gesehen: eine
neue Meldung steht danach auf „Gesichtet“ und zählt nicht mehr unter „Unbearbeitet“. Eine
Meldung, die schon gesichtet, in Bearbeitung oder erledigt ist, behält ihre Stufe.

Kommt die Meldung nicht schnell genug vom Server, steht der Alarm ohne Inhalt da:
„Sofortmeldung eingegangen“ mit „Meldung #…“.

### Eine Meldung an die Lage übergeben

Für Einsatzleitung und Führungspersonal:

1. An der Karte „An Lage übergeben“ wählen. Hat die Karte viele Aktionen, steht der Punkt in
   ihrem Menü.
2. Im Dialog „An die Lage übergeben“ den „Lage-Text“ prüfen; leer bleibt der Wortlaut der
   Meldung.
3. Bei Bedarf unter „Verortung (optional)“ einen Ort setzen. Er ist später nicht änderbar.
4. „Übergeben“ wählen.

Die Meldung trägt danach „Lagerelevant ✓“ und erscheint in den Lagemeldungen (Kapitel
[Lagemeldungen](lagemeldungen.md)); verortet auch auf der Lagekarte. Eine Lagemeldung trägt
„Lagerelevant ✓“ von Anfang an und bietet „An Lage übergeben“ nicht an.

### Aus einer Meldung einen Auftrag erteilen

Für Einsatzleitung und Führungspersonal:

1. An der Karte „Auftrag erteilen“ wählen, bei vielen Aktionen im Menü der Karte.
2. Den Auftrag wie im Kapitel [Aufträge und Befehle](auftraege-befehle.md) beschrieben ausfüllen
   und erteilen.

Die Meldung geht dabei in Bearbeitung. Ist das Modul Aufträge im Einsatz nicht freigegeben, steht
der Punkt gesperrt als „Auftrag erteilen (keine Berechtigung)“ da.

Wird der Auftrag später aufgehoben, steht an der Karte „Auftrag aufgehoben“ statt des Verweises,
und „Auftrag erteilen“ ist wieder da. Ein neu erteilter Auftrag tritt an die Stelle des alten; der
aufgehobene bleibt in den Aufträgen unter „Abgeschlossen“ und im Einsatztagebuch nachlesbar.

### Eine unangemeldet eingetroffene Einheit übernehmen

Für Einsatzleitung und Führungspersonal. Bucht ein Bereitstellungsraum eine Kraft, die der Einsatz
noch nicht kannte, kommt die Meldung „… unangemeldet im BR … eingetroffen“.

1. An ihrer Karte „Übernehmen“ wählen und wie im Kapitel [Einheiten](einheiten.md) beschrieben
   bestätigen.
2. Gehört die Kraft nicht in den Einsatz, stattdessen das rote „Abweisen“ wählen und die Rückfrage
   „Einheit abweisen?“ mit „Abweisen“ bestätigen.

Nach Übernahme oder Abweisung verschwinden die Knöpfe. „Abweisen“ fehlt, wenn das Modul Fahrzeuge
im Einsatz nicht freigegeben ist. Ohne Schreibrecht steht an der Karte statt der Knöpfe der
Verweis „↗ …“ zur Einheit; ist das Modul Einheiten nicht freigegeben, fehlt auch er.

## Hintergrund

### Bestätigungspflicht und Frist

Eine Meldung mit Meldungsart „Sofortmeldung“ oder Priorität „Sofort“ verlangt eine Bestätigung;
der Schalter „Bestätigung erforderlich (Sofortmeldung)“ lässt sich auch von Hand setzen. Die
Frist steht im Feld daneben in Minuten. Ohne Angabe gilt die Vorgabe aus den Einstellungen des
Einsatzes unter „Verhalten & Automatik“, Feld „Bestätigungsfrist Meldungen (Minuten)“, sonst fünf
Minuten.

Mit der Sofortmeldung legt die App eine automatische Erinnerung „Sofortmeldung #… unbestätigt“
an. Läuft die Frist ab, ohne dass jemand bestätigt, wird die Meldung eskaliert: Sie rückt
innerhalb ihrer Priorität nach oben und zählt unter „Bestätigung überfällig“, und es erscheint der
Alarm „Bestätigung ausstehend“, wie beim Eingang mit Absender und Anfang des Wortlauts. Mit
der Bestätigung schließt die Erinnerung
(Kapitel [Erinnerungen](erinnerungen.md)).

### Wer den Alarm bekommt

Den Alarm einer neuen Sofortmeldung bekommen alle, die das Modul Meldungen sehen, außer der
Person, die die Sofortmeldung erfasst hat. „Bestätigung ausstehend“ bekommen alle mit dem Modul,
auch die erfassende Person. Beide kommen mit Ton und lassen sich unter „Benachrichtigungen“ nicht
abschalten (Kapitel [Einsatz auswählen und Oberfläche](einsatz-oberflaeche.md)). Eine gewöhnliche
Meldung löst keinen Alarm aus.

### Hinweise auf neue Meldungen

Eine neue Meldung meldet sich in drei Stufen:

| Meldung | Was geschieht |
|---|---|
| Sofortmeldung | Alarm mit Ton (siehe oben) |
| dringend, Lagemeldung oder von einem gekoppelten Gerät | Hinweis **„Neue Meldung“** mit dezentem Ton |
| normal, von Hand erfasst | kein Ton und kein Hinweis; die Zahl der unbearbeiteten Meldungen steht vorn im Tab-Titel, etwa „(3) Lagekarte · …“, und am Symbol der installierten App |

Den Hinweis bekommen alle, die im Einsatz Meldungen bearbeiten dürfen (Einsatzleitung und
Führungspersonal), nicht Beobachter, nicht gekoppelte Geräte und nicht die Person, die die
Meldung erfasst hat. Trägt die Meldung eine Empfängerfunktion, bekommen ihn nur die Personen
dieser Funktion und die Einsatzleitung. Eine normale Meldung mit Empfängerfunktion bekommen die
Personen der Funktion ebenfalls als Hinweis. Wählt man im Formular die Meldungsart
„Lagemeldung“, steht S2 als Empfängerfunktion schon da; sie lässt sich ändern oder leeren.

Wer eine Funktion besetzt, steht in der Stab-Besetzung; ist die Funktion dort nicht besetzt
oder ihr Personal mit keinem Konto verknüpft, gilt die Funktion in der Mitgliedschaft des
Einsatzes. Wer das Modul „Meldungen (eingehend)“ nicht sehen darf, bekommt keinen Hinweis.

Wird eine Meldung, die keine Lagemeldung ist, zum ersten Mal an die Lage übergeben, bekommen S2
und die Einsatzleitung den Hinweis **„In die Lage übernommen“** mit Sprung zu den Lagemeldungen.

Alle Hinweise auf Meldungen stehen gebündelt in **einem** Hinweis, etwa „3 neue Meldungen“, mit
Absender und Anfang des Wortlauts der jüngsten zwei. Er belegt keinen der Plätze der übrigen
Hinweise und Alarme, und sein Ton kommt höchstens alle zwei Minuten.

- **„Sichten“** an einer Meldung im Hinweis setzt sie auf „Gesichtet“. Sobald jemand eine
  Meldung sichtet, bestätigt oder weiter bearbeitet, verschwindet ihr Hinweis bei allen. Eine
  als gesehen gekennzeichnete Lagemeldung nimmt „In die Lage übernommen“ ebenso weg.
- **„Öffnen“** bzw. **„Zu Meldungen“** springt zur Meldung bzw. in die Liste; das Schließen
  nimmt den Hinweis nur für einen selbst weg.
- Wer gerade in ein Feld schreibt, sieht den Hinweis erst, wenn er das Feld verlässt.
- Auf der Seite „Meldungen (eingehend)“ selbst erscheint kein Hinweis; dort stehen die neuen
  Meldungen in der Liste.
- Ohne Empfängerfunktion entscheidet nie der freie Empfänger, auch wenn dort „S2“ steht.
- Eine Sofortmeldung löst nur ihren Alarm aus, keinen zweiten Hinweis.
- Jede Meldung meldet sich einmal; eine ohne Netz erfasste Meldung, die beim Wiederverbinden noch
  einmal gesendet wird, löst keinen zweiten Hinweis aus.
- Die Hinweise lassen sich unter „Benachrichtigungen“ als „Neue Meldung und Lagemeldung“
  abschalten; der Ton folgt der Glocke in der Kopfleiste.

Als Empfängerfunktion stehen die Einsatzleitung und die Sachgebiete zur Wahl, S7 nur, wenn die
Organisation sie eingeschaltet hat. Führungshilfspersonal und Fachberater sind keine
Empfängerfunktion einer Meldung; für sie bleibt der freie Empfänger.

### Meldungen im Einsatztagebuch

Jede erfasste Meldung schreibt einen ETB-Eintrag vom Typ „Meldung“ mit Absender und Empfänger,
solange „Automatische ETB-Einträge“ nicht ausgeschaltet ist (siehe
[Einsatztagebuch](einsatztagebuch.md)). Der Eintrag trägt den Verweis „Meldung #12 ↗“ zurück auf
die Meldung.

Umgekehrt legt ein im ETB erfasster Eintrag vom Typ „Meldung“ oder „Lage“ die Meldung selbst an,
als Art „Sonstige“ beziehungsweise „Lagemeldung“, mit „Von“ als Absender und „An“ als Empfänger.
Sie steht im Meldungseingang wie jede erfasste Meldung und bekommt keinen zweiten ETB-Eintrag. Mit
„Nur protokollieren“ entsteht keine Meldung.

Die erste Übergabe an die Lage schreibt immer den Systemeintrag „Meldung #12 an die Lage
übergeben“; eine erneute Übergabe und die Übergabe einer Lagemeldung schreiben keinen.

### Ohne Netz

Meldungen lassen sich auch ohne Verbindung erfassen; sie gehen raus, sobald das Netz zurück ist
(siehe [Arbeiten ohne Netz](ohne-netz.md)).
