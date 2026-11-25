---
titel: Anbindungen
gruppen: [administration]
reihenfolge: 795
quellen: [src/benachrichtigung/adapter.rs, frontend/src/pages/einstellungen/Anbindungen.tsx, frontend/src/pages/einstellungen/AnbindungAnsicht.tsx, frontend/src/api/anbindungen.ts, src/routes/anbindungen.rs, src/public_api/machine.rs, src/public_api/routen.rs, src/public_api/rechner.rs, src/public_api/zugang.rs, src/public_api/kommando.rs, src/public_api/freigabe.rs, frontend/src/pages/einstellungen/EinwurfZugaenge.tsx, frontend/src/api/einwurfZugaenge.ts, src/routes/einwurf_zugaenge.rs, src/public_api/einwurf/mod.rs, src/public_api/einwurf/routen.rs, src/public_api/einwurf/ablage.rs, src/public_api/drossel.rs, src/extract.rs, src/public_api/einsaetze.rs, src/public_api/events.rs, frontend/src/pages/einstellungen/AnbindungWebhook.tsx, src/routes/anbindungen_webhook.rs, src/public_api/webhook/mod.rs, src/public_api/webhook/lauf.rs, src/public_api/webhook/ziel.rs, src/public_api/webhook/zustand.rs, src/public_api/webhook/repo.rs, src/instanz/zertifikat.rs, frontend/src/pages/einstellungen/AdapterPaneel.tsx, frontend/src/pages/einstellungen/AdapterAnsicht.tsx, frontend/src/pages/einstellungen/adapterAnzeige.ts, frontend/src/components/Geheimfeld.tsx, frontend/src/api/adapter.ts, src/routes/adapter.rs, src/adapter/lauf.rs, src/adapter/zustand.rs, src/adapter/geheimnis.rs, src/adapter/repo.rs, src/adapter/art.rs, src/veranstaltung_extern/art.rs, src/veranstaltung_extern/vertrag.rs, src/veranstaltung_extern/repo.rs, src/adapter/arten/stammdaten_abruf.rs, src/drohne/hls.rs, src/stammdaten_eingang/schnappschuss.rs, src/routes/stammdaten_schnappschuss.rs, frontend/src/stammdaten/SchnappschussHinweis.tsx, frontend/src/stammdaten/StammdatenEinlesen.tsx, frontend/src/kraefte/OrtungKoppelnDialog.tsx, src/ortung/kopplung.rs, src/ortung/uebernahme.rs, src/routes/ortung.rs, src/adapter/smtp_art.rs, src/adapter/smtp.rs, src/drohne/art.rs]
---

## Überblick

Eine **Anbindung** ist der Zugang eines Fremdsystems zu Lifeline Hub: etwa ein Alarm-Adapter
der Leitstelle, ein Einsatzbuch oder eine Brücke für Positionen. Das Fremdsystem meldet sich mit
einem eigenen Schlüssel an und darf nur, was der Zugang an **Rechten** trägt.

Manche Absender können sich nicht mit einem eigenen Schlüssel anmelden, sondern nur eine Adresse
aufrufen: BOSWatch, FE2 mit „URL öffnen“, der Webhook von Divera oder OsmAnd. Für sie gibt es
den **Einwurf-Zugang**. Seine Adresse enthält einen geheimen Schlüssel. Über sie lässt sich nur
einliefern, nichts lesen.

Ein **Adapter** geht den umgekehrten Weg: Lifeline Hub ruft selbst bei einem Fremdsystem ab, im
Hintergrund und in einem festen Takt. Seine Zugangsdaten (Geheimnisse) liegen verschlüsselt auf
dem Server und lassen sich nur setzen, nie wieder lesen. Das Paneel „Adapter“ erscheint, sobald
der Server eine Adapterart kennt.

Anbindungen, Einwurf-Zugänge und Adapter legt der System-Admin in der Verwaltung unter
„Einstellungen“, „Anbindungen“ an. Wie ein Fremdsystem den Zugang technisch nutzt, steht in der Anleitung für
Entwickler (`docs/api/maschinenzugang.md`, für den Einwurf `docs/api/einwurf.md`). Wie ein
Lagemonitor angebunden wird und seinen Einsatz bekommt, steht unter
[Externe Lagemonitore](externe-lagemonitore.md).

## Abläufe

### Anbindung anlegen

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ wählen.
2. „Anbindung anlegen“ wählen, einen „Name“ eintragen, etwa „Alarm-Adapter Wache 1“, und unter
   „Rechte“ ankreuzen, was das Fremdsystem darf. Optional „Gültig bis“ setzen.
3. „Anlegen und Code zeigen“ wählen. Der Dialog zeigt einen Code wie `ABCD-EFGH-JKMN-PQRS`, wie
   lange er gilt (15 Minuten) und das Kommando zum Einlösen.
4. Den Code an den Betreiber des Fremdsystems geben und „Fertig“ wählen. Der Code ist danach
   nicht mehr abrufbar; der Dialog schließt nur über „Fertig“, damit er nicht versehentlich
   verschwindet. Danach steht die Ansicht der neuen Anbindung.

Der Kopf zeigt „wartet auf Schlüssel“, bis das Fremdsystem den Code eingelöst hat. Danach steht
dort „aktiv“ und im Paneel „Schlüssel“ der Fingerabdruck seines Schlüssels. Das Kommando zum Einlösen nennt denselben
Fingerabdruck; stimmen beide überein, hat das richtige Gerät eingelöst.

### Rechte oder Name ändern

1. In der Liste den Namen der Anbindung wählen. Die Ansicht der Anbindung öffnet sich.
2. Im Paneel „Zugang“ „Bearbeiten“ wählen.
3. Name, „Gültig bis“ oder Rechte ändern und „Speichern“ wählen. Ein leeres „Gültig bis“ heißt:
   gilt bis zum Widerruf.

Hat ein anderer Admin die Anbindung inzwischen geändert, fragt die Seite „Zwischenzeitlich
geändert“: „Verwerfen und neu laden“ zeigt seinen Stand, „Meine Änderung übernehmen“ speichert
den eigenen.

### Schlüssel wechseln

Wenn das Fremdsystem neu aufgesetzt wird oder sein Schlüssel verloren ist:

1. Im Menü der Zeile „Neuer Code (Schlüssel wechseln)“ wählen, oder in der Ansicht der
   Anbindung „Neuer Code“.
2. Den neuen Code wie beim Anlegen weitergeben.

Bis das Fremdsystem mit dem neuen Schlüssel zum ersten Mal anfragt, zeigt die Anbindung beide
Fingerabdrücke, und der alte Schlüssel gilt weiter. Danach gilt nur noch der neue.

### Anbindung widerrufen

1. Im Menü der Zeile oder im Kopf der Ansicht „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

Ab sofort kommt das Fremdsystem nicht mehr herein. Die Anbindung bleibt mit „widerrufen“ stehen,
samt Zeitpunkt und wer widerrufen hat.

### Webhook einrichten

Für den System-Admin:

1. In der Ansicht der Anbindung im Paneel „Webhook“ „Webhook einrichten“ wählen.
2. Unter „Ziel-URL“ die Adresse eintragen, die das Fremdsystem nennt; sie beginnt mit
   `https://`.
3. Unter „Ereignisarten“ ankreuzen, was zugestellt werden soll. Arten, die die Rechte der
   Anbindung nicht öffnen, stehen ausgegraut mit dem fehlenden Recht.
4. Nur für ein Fremdsystem im eigenen Netz, etwa im ELW: „Ziel im lokalen Netz erlauben“
   ankreuzen.
5. „Einrichten“ wählen.

Danach stehen die Paneele „Webhook“, „Zustellung“ und „Zustellungen“. Ohne Verbindung zum
Server sind die Aktionen gesperrt. Die „Webhook-Kennung (aud)“
braucht der Betreiber des Fremdsystems, um die Zustellungen zu prüfen. Ziel, Arten und die
Ausnahme ändert „Bearbeiten“ im Paneel „Webhook“.

### Fingerabdruck des Ziels hinterlegen

Für den System-Admin, wenn das Ziel ein selbst ausgestelltes Zertifikat zeigt, etwa im ELW:

1. Im Dialog „Webhook einrichten“ oder nach „Bearbeiten“ im Paneel „Webhook“ die Ziel-URL
   eintragen und, für ein Ziel im eigenen Netz, „Ziel im lokalen Netz erlauben“ ankreuzen.
2. Neben „Zertifikat“ „Vom Ziel holen“ wählen.
3. Den Fingerabdruck im Dialog „Zertifikat des Ziels“ mit dem am Zielgerät vergleichen und nur
   bei Gleichheit „Übernehmen“ wählen.
4. „Einrichten“ bzw. „Speichern“ wählen.

Statt Schritt 2 und 3 lässt sich der Fingerabdruck auch einfügen, mit oder ohne Doppelpunkte.
Ein leeres Feld entfernt ihn beim Speichern.

### Testereignis senden

1. Im Paneel „Zustellung“ „Testereignis senden“ wählen; bei einem angehaltenen Webhook steht es
   im Menü „Weitere Aktionen zum Webhook“ neben „Wieder aufnehmen“.
2. Das Ergebnis steht sofort darunter, etwa „Testereignis: zugestellt (204)“ oder der Grund des
   Fehlschlags, und als „Test“ unter „Zustellungen“.

Ein Testereignis ändert nichts an der Zustellung: Ein angehaltener Webhook bleibt angehalten.

### Webhook wieder aufnehmen

1. Bei einem angehaltenen Webhook im Paneel „Zustellung“ „Wieder aufnehmen“ wählen.

Die Zustellung beginnt beim nächsten Durchgang wieder, mit dem Ereignis, an dem sie stehen blieb.

### Webhook entfernen

1. Im Paneel „Zustellung“ das Menü „Weitere Aktionen zum Webhook“ öffnen und „Webhook
   entfernen …“ wählen.
2. Die Rückfrage mit „Entfernen“ bestätigen.

Webhook und Verlauf sind danach gelöscht. Ein neuer Webhook beginnt beim aktuellen Stand.

### Einwurf-Zugang anlegen

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ wählen. Unter den Anbindungen steht das
   Paneel „Einwurf-Zugänge“.
2. „Einwurf-Zugang anlegen“ wählen und einen „Name“ eintragen, etwa „BOSWatch Wache 1“.
3. Unter „Zweck“ wählen, was der Absender einliefert: „Alarmmeldungen einliefern“ oder
   „Positionen einliefern“. Optional „Gültig bis“ setzen.
4. „Anlegen und Adresse zeigen“ wählen. Der Dialog zeigt die Adresse, die der Absender aufruft,
   und darunter den Schlüssel allein.
5. Die Adresse beim Absender eintragen und „Fertig“ wählen. Adresse und Schlüssel sind danach
   nicht mehr abrufbar; der Dialog schließt nur über „Fertig“.

Die Zeile zeigt „aktiv“, den Zweck und „noch nie genutzt“. Nach dem ersten angenommenen Einwurf
steht dort „zuletzt genutzt“ mit der Uhrzeit.

### Schlüssel eines Einwurf-Zugangs wechseln

Wenn die Adresse in fremde Hände geraten sein kann:

1. Im Menü der Zeile „Schlüssel wechseln …“ wählen.
2. Die Rückfrage mit „Schlüssel wechseln“ bestätigen.
3. Die neue Adresse beim Absender eintragen und „Fertig“ wählen.

Der bisherige Schlüssel gilt ab der Bestätigung nicht mehr. Bis die neue Adresse beim Absender
eingetragen ist, werden seine Einwürfe abgelehnt; gesperrt wird dadurch niemand. Ein abgelaufener
Zugang bekommt keinen neuen Schlüssel: Sein Menü bietet nur „Widerrufen …“, danach wird er neu
angelegt.

### Ortung für ein Fahrzeug einrichten

Für den System-Admin; das Koppeln selbst übernehmen Einsatzleitung und Führungspersonal. Die Ortung zeigt die Position des Geräts in einem
Fahrzeug auf der Lagekarte (Hintergrund: „Ortung von Fahrzeugen“).

1. In der Verwaltung unter „Einstellungen“ „Einsatz-Vorgaben“ im Bereich „Ortung“ den Schalter
   „Ortung im Einsatz“ einschalten (Kapitel [Helfer anmelden](helfer-anmelden.md)). Beim
   Einschalten bestätigt der System-Admin, dass eine Einwilligung bzw. eine Betriebs- oder
   Dienstvereinbarung vorliegt; der Server hält fest, wer es wann bestätigt hat. Der Schalter gilt
   für die ganze Organisation, für die Helfer-App wie für die Ortung über den Einwurf.
2. Wie unter „Einwurf-Zugang anlegen“ einen Zugang mit dem Zweck „Positionen einliefern“
   anlegen und die Adresse im Gerät eintragen, etwa als Server-URL in OsmAnd oder im Traccar
   Client. Als Kennung („Device ID“) eine Bezeichnung wählen, die sich dem Fahrzeug zuordnen lässt.
3. Das Gerät sendet seine Position. Erst dann erscheint die Kennung in der Auswahl.
4. Im Einsatz bei „Fahrzeuge“ in der Zeile des Fahrzeugs „Weitere Aktionen“ und „Ortung koppeln …“
   wählen, die Kennung ankreuzen und „Koppeln“ wählen (Kapitel [Fahrzeuge und FMS](fahrzeuge.md)).

### Einwurf-Zugang widerrufen

1. Im Menü der Zeile „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

Ab sofort werden Einwürfe mit diesem Schlüssel abgelehnt. Der Zugang bleibt mit „widerrufen“
stehen, samt Zeitpunkt und wer widerrufen hat. Name, Zweck und „Gültig bis“ eines Einwurf-Zugangs
lassen sich nicht nachträglich ändern: Dafür wird der Zugang widerrufen und neu angelegt.

### Adapter anlegen

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ wählen. Unter den Einwurf-Zugängen steht
   das Paneel „Adapter“.

   ![Paneel „Adapter“ mit einem gestörten, einem angehaltenen und einem ausgeschalteten Adapter](../bilder/anbindungen/adapter-liste.png)

2. „Adapter anlegen“ wählen, unter „Art“ die Art des Fremdsystems wählen und einen „Name“
   eintragen, etwa „Alarmquelle Leitstelle“.
3. Die Felder der Art ausfüllen, etwa die Adresse, und das „Intervall“ in Sekunden prüfen. Die Art
   schlägt ein Intervall vor und nennt das kleinste erlaubte.
4. Nur für einen Server im lokalen Netz: „Ziel im eigenen Netz erlauben“ ankreuzen.
5. „Anlegen“ wählen. Danach steht die Ansicht des neuen Adapters.

Ein neuer Adapter ruft sofort ab. Fehlt ihm ein Geheimnis, das seine Art verlangt, hält er mit
„Geheimnis fehlt“ an, bis es gesetzt ist.

### Drohnenbild aus dem eigenen Medienserver

Sendet die Drohnen-App in einen eigenen Medienserver (etwa MediaMTX), zeigt die Lagekarte dessen
Livebild ohne Suchlage:

1. Einen Adapter der Art „Drohnenbild (HLS-Adresse)“ anlegen.
2. Unter „Adresse der Playlist“ die HLS-Adresse eintragen, etwa
   `http://10.0.0.5:8888/drohne/index.m3u8`. `http://` geht nur zu einer privaten IP-Adresse und
   nur mit „Ziel im eigenen Netz erlauben“; sonst `https://`.
3. Verlangt der Medienserver eine Anmeldung, „Benutzer“ eintragen und danach das Geheimnis
   „Passwort“ setzen.
4. Im Einsatz die Quelle zuschalten wie eine aus Suchlage.

Der Adapter zeigt nur das Bild, keine Position der Drohne. Sendet gerade niemand, bleibt er „ok“
und das Videofenster zeigt „Kein Livebild“.

### Mailserver für den Versand einrichten

Für den System-Admin; jede Organisation hat höchstens eine E-Mail-Anbindung:

1. Unter „Einstellungen“ „Anbindungen“ im Paneel „Adapter“ „Adapter anlegen“ wählen und die Art
   „E-Mail (SMTP)“ wählen.
2. „Server“ (Name oder Adresse des Mailservers), „Port“, „Verschlüsselung“ („starttls“ oder
   „tls“), „Benutzer“, „Absenderadresse“ und optional „Absendername“ ausfüllen.
3. „Anlegen“ wählen und in der Ansicht des Adapters das „Passwort“ als Geheimnis setzen.
4. „Verbindung prüfen“ wählen. Das Ergebnis steht im Verlauf; es wird keine Mail gesendet.

Ohne diese Anbindung meldet der Senden-Dialog „Kein Mailserver eingerichtet“; ist sie angehalten,
„Mailanbindung angehalten“.

### Geheimnis setzen oder ersetzen

1. In der Ansicht des Adapters im Paneel „Geheimnisse“ an der Zeile „Setzen“ wählen, bei einem
   schon gesetzten Geheimnis „Ersetzen“.
2. Den Wert in das Feld eintragen oder einfügen und „Speichern“ wählen; Escape oder „Abbrechen“
   verwirft ihn.

   ![Geheimnis „API-Schlüssel“ beim Ersetzen, darunter ein noch nicht gesetztes](../bilder/anbindungen/geheimnis-ersetzen.png)

Die Zeile zeigt danach nur „gesetzt“ mit Zeit und Person. Den Wert zeigt die Seite nie wieder,
auch nicht verdeckt. Ein Adapter, der wegen eines Fehlers angehalten war, ruft danach sofort neu
ab. „Entfernen …“ neben „Ersetzen“ löscht ein Geheimnis nach einer Rückfrage.

### Verbindung prüfen

1. In der Ansicht des Adapters „Verbindung prüfen“ wählen.
2. Das Ergebnis steht im Paneel „Zustand“, etwa „Verbindung prüfen: erreichbar · 4 Einträge“
   oder der Grund des Fehlschlags, und als „Prüfung“ unter „Letzte Versuche“.

   ![Paneel „Zustand“ eines gestörten Adapters mit dem Ergebnis der Prüfung](../bilder/anbindungen/adapter-pruefung.png)

Die Prüfung ruft einmal ab und übernimmt nichts. Sie ändert weder den Zustand noch den nächsten
Abruf.

### Adapter bearbeiten

1. In der Ansicht des Adapters im Paneel „Einstellungen“ „Bearbeiten“ wählen.
2. Name, Intervall oder die Felder der Art ändern und „Speichern“ wählen.

Ändert sich dabei der Server einer Adresse, fragt die Seite „Neues Ziel: Geheimnisse werden
entfernt“ und nennt den bisherigen und den neuen Server. „Speichern und entfernen“ speichert;
danach sind alle Geheimnisse des Adapters entfernt und werden neu gesetzt. So geht ein Geheimnis
nie an einen anderen Server als den, für den es gesetzt wurde.

### Adapter anhalten und fortsetzen

1. In der Ansicht des Adapters „Anhalten“ wählen. Der Adapter ruft nichts mehr ab und steht auf
   „aus“.
2. „Fortsetzen“ wählen. Der Adapter ruft sofort wieder ab.

„Fortsetzen“ steht auch bei einem Adapter, der mit „braucht Eingriff“ angehalten ist, etwa nach
einer Korrektur am Fremdsystem.

### Ziel im eigenen Netz erlauben

1. In der Ansicht des Adapters im Paneel „Netz“ den Schalter „Ziel im eigenen Netz erlauben“
   einschalten.
2. Die Rückfrage mit „Erlauben“ bestätigen.

Ausschalten geht ohne Rückfrage. Steht dann noch eine Adresse mit einer IP-Adresse im eigenen Netz
in den Einstellungen, lehnt der Server das ab. Zeigt nur ein Name ins eigene Netz, scheitert der
nächste Abruf mit „Ziel liegt in einem gesperrten Netz“, und der Adapter steht auf „braucht
Eingriff“.

### Adapter löschen

1. In der Ansicht des Adapters „Löschen …“ wählen.
2. Die Rückfrage mit „Löschen“ bestätigen.

Der Adapter ist danach samt Geheimnissen und Verlauf gelöscht.

### Veranstaltungen abrufen

Geplante Sanitätsdienste, Betreuungen und Übungen kann Lifeline Hub aus einer anderen Anwendung
abrufen, die den Vertrag „Veranstaltungen-Abruf v1“ anbietet (`docs/schnittstellen/veranstaltungen-abruf.md`).
Für den System-Admin:

1. In der liefernden Anwendung einen Zugang für den Abruf anlegen und den Schlüssel kopieren.
2. Hier „Adapter anlegen“ wählen, unter „Art“ „Veranstaltungen (Schnittstelle v1)“ wählen und einen
   „Name“ eintragen.
3. Unter „Adresse der Schnittstelle“ die Adresse der liefernden Anwendung eintragen, unter der
   sie den Abruf anbietet, und „Anlegen“ wählen. Das „Intervall“ schlägt 300 Sekunden vor, kürzer
   als 60 geht nicht.
4. Im Paneel „Geheimnisse“ an der Zeile „Abruf-Schlüssel“ „Setzen“ wählen, den Schlüssel einfügen
   und „Speichern“ wählen.
5. „Verbindung prüfen“ wählen. Das Ergebnis nennt die Zahl der Veranstaltungen als Einträge.

### Stammdaten abrufen

Der Adapter der Art „Stammdaten-Abruf“ holt Personal mit Qualifikationen aus einer
Helferverwaltung, die ihre Helfer für Lifeline Hub bereitstellt. Adresse und Zugangsschlüssel
stellt die Helferverwaltung aus, dort unter ihrem Zugang für Lifeline Hub. Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ im Paneel „Adapter“ „Adapter anlegen“
   wählen und unter „Art“ „Stammdaten-Abruf“ wählen.
2. Einen „Name“ eintragen, unter „Adresse“ die Adresse aus der Helferverwaltung und unter
   „Herkunft“ den Namen der Quelle, etwa „Helferverwaltung“. Die Kennungen der Personen gelten
   nur für diese Herkunft.
3. Das „Intervall“ prüfen (Vorschlag sechs Stunden, frühestens stündlich) und „Anlegen“ wählen.
4. In der Ansicht des Adapters im Paneel „Geheimnisse“ an „Zugangsschlüssel“ „Setzen“ wählen,
   den Schlüssel aus der Helferverwaltung einfügen und „Speichern“ wählen.
5. Hat ein Abruf etwas Neues gebracht, steht in der Verwaltung über „Personal“ und in der Ansicht
   des Adapters der Hinweis „Neue Personaldaten aus ‹Herkunft› vom ‹Zeit› zum Prüfen“. „Prüfen“
   wählen.
6. Im Dialog „Abgerufene Stammdaten prüfen“ steht gleich die Vorschau, wie beim Einlesen einer
   Datei: was neu ist, was sich ändert und wo eine Entscheidung fehlt. Die Entscheidungen treffen
   und „Übernehmen“ wählen.
7. Das Ergebnis lesen und „Schließen“ wählen. Der Hinweis ist danach weg.

Steht nach „Übernehmen“ „Inzwischen gibt es einen neueren Stand“, hat ein späterer Abruf den
Stand ersetzt, und übernommen ist nichts. Nach „Schließen“ steht der Hinweis auf den neueren Stand
da.

### Suchlage anbinden

Suchlage führt die Drohnengruppe; angebunden zeigt Lifeline Hub deren Lage, Livebild und Fotos auf
der Lagekarte eines Einsatzes (Kapitel [Lagekarte, Zeichnen und Messen](lagekarte.md)). Für den
System-Admin, zusammen mit einer Person, die Suchlage verwaltet:

1. In Suchlage unter „Einstellungen“ „Großbild“ wählen, eine „Bezeichnung“ eintragen, etwa
   „Lifeline Hub“, „Fotos für Lifeline Hub“ ankreuzen und „Großbild-Zugang erzeugen“ wählen.
   Suchlage zeigt die Adresse des Zugangs nur dieses eine Mal. Der Teil nach „#“ ist der Zugang.
2. Hier „Adapter anlegen“ wählen, unter „Art“ „Suchlage (Drohne)“ wählen und einen „Name“
   eintragen, etwa „Drohnengruppe Suchlage“.
3. Unter „Adresse von Suchlage“ die Adresse ohne „/kiosk#…“ eintragen, etwa
   `https://suchlage.example`, und „Anlegen“ wählen. Das „Intervall“ steht auf 5 Sekunden.
4. In der Ansicht des Adapters im Paneel „Geheimnisse“ an „Großbild-Zugang“ „Setzen“ wählen, den
   Teil nach „#“ einfügen und „Speichern“ wählen.
5. „Verbindung prüfen“ wählen. „erreichbar“ zeigt, dass Adresse und Zugang stimmen.

Abgerufen wird erst, wenn die Einsatzleitung das Drohnenbild an einem laufenden Einsatz
zuschaltet. Ohne „Fotos für Lifeline Hub“ kommen Lage und Livebild, aber keine Fotos.

### Erneut vorlegen

1. In der Ansicht eines Adapters der Art „Stammdaten-Abruf“ „Erneut vorlegen“ wählen.
2. Beim nächsten Abruf steht der Hinweis „zum Prüfen“ wieder da, auch wenn sich an der Quelle
   nichts geändert hat.

So kommen Personen zurück, die beim Prüfen ausgelassen oder in Lifeline Hub gelöscht wurden.

## Hintergrund

### Abgerufene Stammdaten

Ein Abruf übernimmt nie selbst. Er legt den abgeholten Stand nur zum Prüfen ab; erst „Übernehmen“
schreibt Personen und Qualifikationen in die Stammdaten. Je Adapter wartet höchstens ein Stand,
ein neuerer ersetzt ihn. Bringt ein Abruf denselben Stand wie der wartende oder der zuletzt
übernommene, entsteht nichts Neues und kein Hinweis; die Reihenfolge der Personen spielt dabei
keine Rolle. Einen neuen Stand zeigt der Hinweis beim nächsten Laden der Seite.

Den Hinweis sieht und bedient nur der System-Admin. Eine Person, die Lifeline Hub unter derselben
Herkunft und Kennung schon kennt, wird ergänzt oder geändert, nicht doppelt angelegt. Vergibt die
Helferverwaltung einer Person eine neue Kennung, etwa nach einem Wechsel ihrer eigenen Quelle,
fragt die Vorschau einmal nach, zu wem sie gehört.

### Wer was darf

Anlegen, ändern, neuen Code ausstellen und widerrufen darf nur der System-Admin, und nur für die
eigene Organisation; ebenso einen Webhook einrichten, ändern, entfernen, wieder aufnehmen und
ein Testereignis senden. Eine Führungskraft sieht Liste und Ansicht samt Zustellungen ohne
Aktionen; vom Ziel eines Webhooks sieht sie nur den Server, nicht die ganze Adresse, weil diese
einen Schlüssel des Fremdsystems tragen kann. Dasselbe gilt für
Einwurf-Zugänge.

Bei Adaptern darf nur der System-Admin anlegen, ändern, Geheimnisse setzen und entfernen, prüfen,
anhalten, fortsetzen und löschen. Eine Führungskraft sieht Liste, Zustand, Geheimnisse (nur ob und
wann gesetzt) und Verlauf, aber keine Einstellungen: eine Adresse kann einen Hinweis auf den Zugang
tragen.

### Rechte

| Recht                     | Das Fremdsystem soll                               |
| ------------------------- | -------------------------------------------------- |
| Lage lesen                | die Lage eines freigegebenen Einsatzes lesen       |
| Einsätze lesen            | die Köpfe freigegebener Einsätze lesen             |
| Ereignisse abrufen        | erfahren, dass sich etwas geändert hat             |
| Alarmmeldungen einliefern | Alarme als Vorschlag einliefern, nie einen Einsatz |
| Positionen einliefern     | Positionen melden                                  |
| Rechner nutzen            | die Rechner verwenden                              |

Die Rechte stehen fest, die Wege dahinter kommen nach und nach. Heute öffnen vier Rechte etwas:

- „Rechner nutzen“: Damit rechnet ein Fremdsystem Unterkunft und Zelte durch, mit denselben
  Regeln wie der [Unterkunftsrechner](betreuung.md) und mit den Richtwerten der Organisation aus
  den [Stammdaten](stammdaten.md). Eigene Werte darf es je Rechnung mitschicken; gespeichert wird
  davon nichts. Die Werte eines Einsatzes nimmt es nur für den Einsatz, den die Einsatzleitung für
  die Anbindung freigegeben hat (unten).
- „Lage lesen“: das Lagebild eines Einsatzes, siehe unten.
- „Einsätze lesen“: der Kopf des freigegebenen Einsatzes, also Einsatznummer, Bezeichnung,
  Stichwort, Einsatzart, Nummer der Leitstelle, Einsatzort mit Koordinate und Beginn.
  Sachverhalt, meldende Stelle, Zahl der Betroffenen und Personen gehen nicht hinaus.
- „Ereignisse abrufen“: Das Fremdsystem erfährt, dass sich an seinem freigegebenen Einsatz etwas
  geändert hat, mit Zeitpunkt und Kennung des Einsatzes, ohne Inhalt. Allein öffnet dieses Recht
  nichts: Über den Einsatz erfährt nur etwas, wer auch „Einsätze lesen“ hat, über die Lage nur,
  wer auch „Lage lesen“ hat. Die Ereignisse bleiben sieben Tage abrufbar.

Mit den übrigen Rechten prüft ein Fremdsystem bisher nur seine Anmeldung. Einliefern lässt sich
heute über einen Einwurf-Zugang (siehe unten). Welche Daten die übrigen Rechte später öffnen,
nennt dieses Kapitel, sobald es sie gibt. Neben jedem Recht steht der technische Name, etwa
`alarmmeldungen:write`; so lässt es sich mit der Doku des Fremdsystems vergleichen. Ein
Fremdsystem legt nie selbst einen Einsatz an.

### Webhooks

Ein Webhook stellt die Ereignisse einer Anbindung zu, statt dass das Fremdsystem sie abruft: je
Ereignis eine Anfrage an die Ziel-URL, der Reihe nach, signiert mit dem Schlüssel dieser Instanz.
Zugestellt wird nur, was die Anbindung auch abrufen dürfte, also mit „Ereignisse abrufen“ und
dem passenden Leserecht, und nur für den freigegebenen Einsatz. Je Anbindung gibt es höchstens
einen Webhook.

Der Zustand im Kopf des Paneels „Webhook“:

- **„Webhook stellt zu“**: Alles ist zugestellt oder wird gerade zugestellt.
- **„Webhook gestört“**: Der letzte Versuch scheiterte. Dasselbe Ereignis kommt erneut, zuerst
  nach einer Minute, dann nach jeweils doppelt so langer Pause, höchstens alle sechs Stunden. Die
  späteren Ereignisse warten, damit die Reihenfolge stimmt. „Letzter Fehler“ und „Nächster
  Versuch“ stehen unter „Zustellung“. Die Liste der Anbindungen zeigt die Störung an der Zeile.
- **„Webhook angehalten“**: 24 Stunden lang ging nichts durch. Es gibt keinen Versuch mehr, bis
  der Admin „Wieder aufnehmen“ wählt. Lag das wartende Ereignis dann schon länger als sieben Tage,
  ist es gelöscht: Die Zustellung beginnt beim aktuellen Stand, und „Ereignisse verloren“ sagt,
  dass das Fremdsystem den Stand neu lesen muss.
- **„Webhook ruht“**: Die Anbindung darf gerade nichts bekommen, mit Grund: „Code noch nicht
  eingelöst“, „Anbindung widerrufen“, „Anbindung abgelaufen“ oder das fehlende Recht. Ereignisse
  gehen dabei nicht verloren, solange sie nicht älter als sieben Tage werden.

Als zugestellt gilt ein Ereignis, wenn das Fremdsystem es bestätigt. Antwortet es zu spät, kommt
dasselbe Ereignis noch einmal; das Fremdsystem erkennt das an der Nummer.

Die Ziel-URL muss mit `https://` beginnen und darf keinen Benutzernamen und kein Passwort
enthalten. Ein Ziel in einem internen Netz lehnt der Server ab, auch wenn ein Name dorthin zeigt.
„Ziel im lokalen Netz erlauben“ öffnet private Netze, etwa das Netz eines ELW; der Rechner selbst
und Adressen wie `169.254.169.254` bleiben gesperrt. Das Ziel braucht ein Zertifikat, dem der
Server vertraut, oder einen hinterlegten Fingerabdruck; sonst scheitert ein selbst ausgestelltes
mit „Zertifikat des Ziels nicht anerkannt“.

Mit Fingerabdruck zählt nur dieses eine Zertifikat, auch wenn eine vertraute Stelle ein anderes
ausgestellt hat. Wechselt das Ziel sein Zertifikat, scheitert die Zustellung mit „Zertifikat des
Ziels nicht anerkannt“, und unter „Letzter Fehler“ steht „Hat das Ziel sein Zertifikat
gewechselt? Fingerabdruck neu holen.“ Zeigt die Ziel-URL auf einen anderen Server, gilt der
alte Fingerabdruck nicht mehr: Das Feld sagt das, und beim Speichern fällt er weg, wenn kein
neuer eingetragen ist. Ändert sich nur der Pfad, bleibt er. „Vom Ziel holen“ baut nur die
verschlüsselte Verbindung auf und bricht sie ab, sobald das Zertifikat gelesen ist; das Ziel
bekommt keine Anfrage.

Unter „Zustellungen“ stehen die letzten 50 Versuche mit Zeit, Nummer des Ereignisses oder
„Test“, Ergebnis und Dauer. Was das Fremdsystem geantwortet hat, speichert der Server nicht.

### Lage und Einsätze lesen braucht die Freigabe der Einsatzleitung

Eine Anbindung mit „Lage lesen“ oder „Einsätze lesen“ sieht nur den Einsatz, den die
Einsatzleitung auf der Seite „Geräte“ ihres Einsatzes im Paneel „Anbindungen“ für sie freigegeben
hat, und höchstens einen. Ohne Freigabe geht nichts hinaus, auch kein Ereignis.
Ihre Zeile nennt „liest“ mit der Bezeichnung des Einsatzes oder „kein Einsatz freigegeben“,
solange die Anbindung weder widerrufen noch abgelaufen ist. Die
Freigabe endet mit dem Abschluss des Einsatzes (auch wenn er danach wieder geöffnet wird), mit dem
Widerruf oder Ablauf der Anbindung und mit jeder Änderung an diesen beiden Rechten, wenn eines
dazukommt wie wenn eines wegfällt. Die
Einsatzleitung hat Lage oder Einsatzkopf in einem bestimmten Umfang freigegeben und entscheidet
über einen anderen neu.
Auch ein verlängertes „Gültig bis“ braucht eine neue Freigabe.
Abläufe und Inhalt des Lagebilds: [Externe Lagemonitore](externe-lagemonitore.md).

Trägt die Anbindung zusätzlich „Rechner nutzen“, rechnet sie mit derselben Freigabe auch mit den
Richtwerten, die der freigegebene Einsatz in seinen
[Einstellungen](einsatz-einstellungen.md) unter „Unterkunft“ gesetzt hat. Einen eigenen Schalter
dafür gibt es nicht: wer einer solchen Anbindung den Einsatz freigibt, gibt ihr auch diese Werte.
Bekommt eine Anbindung, die einen Einsatz liest, „Rechner nutzen“ erst später dazu, bleibt die
Freigabe bestehen, und die Anbindung rechnet ab da mit den Werten des Einsatzes; das
Einsatztagebuch nennt das nicht.
Eine Anbindung nur mit „Rechner nutzen“ steht nicht im Paneel und rechnet immer mit den Werten der
Organisation. Ein Rechner-Fremdsystem, das die Werte des Einsatzes braucht, bekommt deshalb
„Einsätze lesen“ dazu.

### Warum ein Fremdsystem nicht hereinkommt

Die Zeile nennt unter „Letzte Ablehnung“, warum die letzte Anfrage scheiterte, mit Uhrzeit. Das
Fremdsystem selbst erfährt nur „Anmeldung fehlgeschlagen“. Die häufigsten Gründe:

- **„Uhr geht 7 min nach“** (oder „vor“): Die Uhr des Fremdsystems weicht um mehr als 5 Minuten
  ab. Zeitabgleich (NTP) am Fremdsystem einschalten.
- **„Code noch nicht eingelöst“**: Der Code wurde nie oder zu spät eingelöst. „Neuer Code“
  wählen.
- **„Body passt nicht zur Signatur“, „Pfad passt nicht …“, „Anfrage für eine andere Instanz“**:
  Das Fremdsystem signiert falsch oder spricht die falsche Instanz an. Das ist eine Frage an den
  Betreiber des Fremdsystems.
- **„Zugang abgelaufen“**: „Gültig bis“ ist verstrichen. In der Ansicht „Bearbeiten“ wählen und
  verlängern.

### Was ein Einwurf kann

Ein Einwurf-Zugang hat genau einen Zweck. Wer seine Adresse kennt, kann einliefern, aber nichts
lesen, keinen Einsatz anlegen und keinen ändern. Die Antwort an den Absender ist leer.

- **Alarmmeldungen** legt der Server so ab, wie sie ankommen, ohne sie zu deuten. Die Oberfläche
  zeigt sie noch nicht; sichtbar ist nur „zuletzt genutzt“ am Zugang. Sie werden sieben Tage nach
  dem Empfang gelöscht.
- **Positionen** hängen an der Kennung, die der Absender mitschickt (bei OsmAnd die „Device ID“).
  Je Zugang und Kennung hält der Server genau eine Position, ohne Verlauf. Eine Position mit
  älterer Uhrzeit als die gespeicherte wird nicht übernommen. Kommt 24 Stunden lang keine neue,
  wird sie gelöscht. Die Lagekarte zeigt eine Position nur, wenn ihre Kennung im laufenden
  Einsatz an ein Fahrzeug gekoppelt ist (Abschnitt „Ortung von Fahrzeugen“); sonst bleibt sie
  in der Ablage und ändert nichts.

Ruft ein Absender dieselbe Adresse mit demselben Inhalt mehrmals auf, entsteht kein zweiter
Eintrag: Der Server vermerkt am ersten, wie oft und wann er erneut kam. Ohne eigene Kennung des
Absenders gilt das zwei Minuten lang nach dem letzten Empfang; danach entsteht ein neuer Eintrag.

Je Zugang nimmt der Server höchstens 30 Einwürfe am Stück an, danach einen alle zwei Sekunden,
dazu höchstens 5 000 neue Alarmmeldungen am Tag und Positionen für 200 Kennungen. Ist die
Tagesgrenze erreicht, lehnt er jeden weiteren Einwurf des Zugangs ab, bis wieder Platz ist.

### Ortung von Fahrzeugen

Ein Einwurf bewegt nur dann ein Fahrzeug, wenn dessen Kennung im Einsatz gekoppelt wurde. Zur
Auswahl stehen die Kennungen, von denen in den letzten 24 Stunden eine Position kam und deren
Zugang nicht widerrufen und nicht abgelaufen ist, den Zweck „Positionen einliefern“ trägt und zur
eigenen Organisation gehört. Die Liste zeigt keine Koordinaten.

- **Freigabe der Organisation:** Ohne den Schalter „Ortung im Einsatz“ lässt sich nicht koppeln;
  der Dialog „Ortung koppeln“ nennt den Grund. Wird der Schalter ausgeschaltet, bleiben bestehende
  Kopplungen stehen, es kommt aber keine Position mehr am Fahrzeug an. Die App prüft die
  Einwilligung oder Vereinbarung nicht; sie verantwortet die Organisation.
- **Einsatzbezug:** Gekoppelt wird nur in einem laufenden, nicht gespiegelten Einsatz. Die Kopplung
  endet mit „Ortung trennen“, dem Entlassen, dem Stornieren, dem Ablehnen der Einheit und dem
  Abschluss; jedes Ende und das
  Koppeln stehen im Einsatztagebuch. Wird der Zugang widerrufen, bleibt die Kopplung stehen, es
  kommt aber keine Position mehr an.
- **Marker:** Unter dem Namen steht „Ortung · vor 3 min“; liegt die Messung fünf Minuten oder
  länger zurück, wird der Marker blass und die Liste „Geortet“ nennt „veraltet“ (Kapitel
  [Lagekarte](lagekarte.md)). Eine von Hand gesetzte Position bleibt stehen, bis eine später
  gemessene Position kommt. Je Fahrzeug schreibt die Ortung höchstens alle 15 Sekunden.
- **Kein Verlauf:** Es gibt keine Spur und keine Liste früherer Orte. Je Kennung hält die Ablage
  die letzte Position 24 Stunden, am Fahrzeug steht die letzte Position bis zum Abschluss; der
  Abschluss löscht die Positionen aus der Ortung.
- **Spiegel-Instanzen:** Die Position am Fahrzeug geht wie jede Änderung an Spiegel-Instanzen des
  Einsatzes. Die Kopplung bleibt auf der Instanz.

#### Vorlage für die Datenschutz-Folgenabschätzung

Diese Vorlage ordnet, was die App bei der Ortung über den Einwurf tut; sie ersetzt keine rechtliche
Prüfung. Sie ergänzt die gemeinsame Vorlage für die Ortung im Einsatz (Helfer-App und Einwurf),
die im Repository unter `docs/datenschutz/dsfa-vorlage-ortung.md` liegt. Zu ergänzen ist, was nur
die Organisation weiß. Die Stellen in eckigen Klammern sind auszufüllen.

| Punkt | Inhalt |
| --- | --- |
| Zweck | Anzeige der Position von Einsatzfahrzeugen auf der Lagekarte während eines laufenden Einsatzes, zur Koordination der Kräfte. [Weitere Zwecke der Organisation oder „keine“] |
| Rechtsgrundlage | [Vom Verantwortlichen einzutragen: Einwilligung der Besatzung oder Betriebs- bzw. Dienstvereinbarung nach § 87 Abs. 1 Nr. 6 BetrVG bzw. dem Personalvertretungsrecht; daneben kommt Art. 6 DSGVO in Betracht, etwa Absatz 1 Buchstabe f. Das Vorliegen bestätigt der System-Admin beim Einschalten von „Ortung im Einsatz“. Einschätzung der Organisation oder ihrer Datenschutzbeauftragten.] |
| Betroffene | Besatzung des gekoppelten Fahrzeugs [ehrenamtlich / hauptamtlich] |
| Daten | Kennung des Geräts, Koordinaten, Zeitpunkt der Messung. Es gibt keine Zuordnung zu Personen außer über die Besatzung, die am Fahrzeug eingetragen ist. |
| Speicherdauer | Letzte Position je Kennung 24 Stunden nach dem Empfang in der Ablage. Am Fahrzeug bis zum Abschluss des Einsatzes; dann werden die Positionen aus der Ortung gelöscht. Eingefrorene Lagestände behalten die Position bis zur Löschung des Einsatzes. |
| Verlauf | Kein Positionsverlauf, keine Spur, kein Geofencing. |
| Empfänger | Personen mit Zugriff auf den Einsatz in der Organisation und, bei gespiegelten Einsätzen, die Spiegel-Instanzen. [Weitere Empfänger der Organisation] |
| Technische und organisatorische Maßnahmen | Absender nur schreibend, Schlüssel im Pfad nur verschlüsselt angenommen und in keinem Protokoll; Kopplung nur durch Schreibberechtigte im Einsatz und mit Eintrag im Einsatztagebuch; Freigabe durch die Organisation über den Schalter „Ortung im Einsatz“ (vorgabemäßig aus; wer ihn wann eingeschaltet hat, hält der Server fest); Kandidatenliste ohne Koordinaten; Löschung beim Abschluss. [Ergänzungen der Organisation: Zugriffsrechte, Schulung, Prüfintervall] |
| Risiken | Ortung von Kräften ohne Einwilligung oder Vereinbarung, wenn der Schalter ohne Grundlage eingeschaltet wird; Weitergabe der Adresse eines Zugangs. [Bewertung der Organisation] |

### Einwurf nur verschlüsselt

Der Schlüssel steht in der Adresse. Der Server nimmt einen Einwurf deshalb nur über eine
verschlüsselte Verbindung (https) an. Das Paneel „Einwurf-Zugänge“ warnt in zwei Fällen:

- **„Einwürfe ohne TLS erlaubt“**: Der Betreiber hat Einwürfe auch unverschlüsselt zugelassen.
  Schlüssel und Inhalt sind dann im Netz mitlesbar.
- **„Einwürfe werden abgelehnt“**: Der Server ist weder selbst über https erreichbar noch kennt
  er einen vertrauten Reverse-Proxy. Jeder Einwurf scheitert, bis der Betreiber das einrichtet
  (`docs/betrieb-tls.md`).

Die Adresse im Dialog beginnt mit dem Namen, unter dem die Seite gerade geöffnet ist. Erreicht
der Absender den Server unter einem anderen Namen, wird dieser Teil beim Eintragen ersetzt. Wo
der Absender es kann, sendet er per POST: Bei einem Aufruf per GET stehen auch die Alarmdaten in
der Adresse.

### Zustand eines Adapters

- **„ok“**: Der letzte Abruf war erfolgreich. Die Liste zeigt dann keinen Status, nur „zuletzt
  erfolgreich“.
- **„noch nie abgerufen“**: Der Adapter ist neu und hat noch nicht abgerufen.
- **„gestört“**: Der letzte Abruf scheiterte an etwas Vorübergehendem (keine Verbindung, keine
  Antwort in 20 s, Fehler des Servers). Der Adapter versucht es von selbst wieder, zuerst nach
  einer Minute, dann nach jeweils doppelt so langer Pause, bis die Pause 15 Minuten erreicht. Kürzer
  als sein Intervall wird die Pause nie. Eine Alarmquelle kommt so nach einer Störung von selbst wieder.
- **„braucht Eingriff“**: Der Abruf scheiterte an etwas, das nur ein Mensch beheben kann: Zugang
  abgelehnt, Geheimnis fehlt oder ist unlesbar, Einstellung ungültig, Ziel in einem gesperrten Netz
  oder Weiterleitung. Der Adapter hält an, statt es endlos zu wiederholen. Er läuft wieder, sobald
  ein Geheimnis oder eine Einstellung geändert ist oder der Admin „Fortsetzen“ wählt.
- **„aus“**: Der Admin hat den Adapter angehalten.
- **„Art unbekannt“**: Der Server kennt die Art dieses Adapters nicht mehr. Der Adapter ruft nicht
  ab; Einstellungen und „Verbindung prüfen“ sind gesperrt, löschen geht.

Unter „Letzte Versuche“ stehen die letzten 50 Abrufe und Prüfungen mit Zeit, Ergebnis und Dauer.
Was das Fremdsystem geantwortet hat, speichert der Server nicht.

### Benachrichtigung bei einer Störung

Damit eine ausgefallene Quelle nicht erst im Einsatz auffällt, benachrichtigt der Server die
Admins der Organisation, auch wenn niemand diese Seite offen hat:

- **„Anbindung braucht Eingriff“**: sobald ein Adapter wegen eines Fehlers anhält, den nur ein
  Mensch beheben kann.
- **„Anbindung gestört“**: wenn ein Adapter 30 Minuten am Stück gestört ist. Kürzere Aussetzer
  melden sich nicht.
- **„Anbindung läuft wieder“**: wenn ein gemeldeter Adapter von selbst wieder abruft. Die offene
  Störungsmeldung ist dann für alle erledigt.

Jede Störung meldet sich einmal, nicht bei jedem Fehlversuch. Wird sie schlimmer (aus „gestört“
wird „braucht Eingriff“), kommt die zweite Meldung und ersetzt die erste. Greift ein Admin ein, ist
die Meldung erledigt, ohne Entwarnung: beim Fortsetzen, Anhalten und Löschen und bei einem
angehaltenen Adapter auch dann, wenn ein neues Geheimnis oder eine geänderte Einstellung ihn
wieder laufen lässt. Ein Adapter, der nur gestört ist, behält seine Meldung, bis er wieder abruft.

Die Meldung nennt den Namen des Adapters und den Fehler, nie ein Geheimnis oder eine Adresse.
Sie kommt als Eingang mit dezentem Ton, auf Wunsch auch bei geschlossener App. Ein Klick führt
zum Adapter. Jede Admin-Person kann die drei Meldungen unter „Benachrichtigungen“ einzeln
abschalten. Führungskräfte bekommen sie nicht, Admins anderer Organisationen auch nicht.

Läuft der Server ohne Schlüssel für Geheimnisse, halten alle Adapter mit Geheimnis an. Das meldet
der Server nicht: Beheben kann es nur, wer den Server betreibt.

### Mailversand

Die Art „E-Mail (SMTP)“ ruft nichts ab, sondern stellt Nachrichten zu, die Personen aus dem
Einsatz senden (Kapitel [Lageberichte](lageberichte.md), „Versand per E-Mail“). Der Server prüft
das Ziel wie bei Webhooks (keine Weiterleitung, kein Ziel im internen Netz ohne „Ziel im eigenen
Netz erlauben“) und prüft das Zertifikat des Mailservers gegen die Vertrauensanker des Systems.
Das Passwort bleibt wie jedes Geheimnis verschlüsselt und wird nur beim Zustellen entschlüsselt;
Antworttexte des Mailservers werden nie gespeichert, die Versandliste nennt nur einen festen
Grund („Vom Mailserver abgelehnt“, „Mailanbindung fehlerhaft eingerichtet“). Eine Organisation, die
sich bei einem Hub meldet, hat keine eigene Mailanbindung.

### Geheimnisse eines Adapters

Ein Geheimnis liegt verschlüsselt in der Datenbank, mit einem Schlüssel, den der Betrieb dem
Server beim Start mitgibt (`LIFELINE_GEHEIMNIS_SCHLUESSEL`). Entschlüsselt wird es nur im Abruf,
direkt vor der Anfrage. In keiner Antwort, keinem Protokoll und keiner Sicherung steht es im
Klartext. Der Hinweis „Geheimnisspeicher“ über den Adaptern nennt zwei Störungen:

- **„Schlüssel fehlt“**: Der Server hat keinen Schlüssel. Geheimnisse lassen sich nicht setzen,
  Adapter mit Geheimnis halten mit „Geheimnisspeicher ohne Schlüssel“ an.
- **„Schlüssel passt nicht“**: Mindestens ein Geheimnis wurde mit einem anderen Schlüssel gesetzt,
  etwa nach dem Einspielen einer Sicherung auf einem anderen Rechner. Seine Zeile nennt es
  „unlesbar“; „Neu setzen“ behebt es.

Tauscht der Betrieb den Schlüssel, etwa nach einem Leck, gibt er dem Server für einen Neustart
den alten zusätzlich mit (`LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT`). Der Server schlüsselt dabei alle
Geheimnisse auf den neuen um; die Adapter laufen weiter, und niemand muss etwas neu setzen.

Die Ziele eines Adapters prüft der Server wie die Ziele eines Webhooks: nur über https, keine
Weiterleitung, kein Ziel in einem internen Netz. „Ziel im eigenen Netz erlauben“ öffnet private
Netze; der Rechner selbst und Adressen wie `169.254.169.254` bleiben gesperrt.

### Abgerufene Veranstaltungen

Ein Adapter der Art „Veranstaltungen (Schnittstelle v1)“ legt jede Veranstaltung einmal ab, mit
Name, Art, Status, Ort, Veranstalter, Bemerkung, Beginn und Ende in ihrem letzten Stand. Ein Abruf
ohne Änderung schreibt nichts; eine Änderung oder Absage überschreibt den alten Stand. Fehlt eine
Veranstaltung, die noch nicht länger als 7 Tage vorbei ist, in der Lieferung, gilt sie als
entfernt. Die liefernde Anwendung gibt keine Personendaten heraus: „Veranstalter“ ist eine Stelle,
kein Mensch.

Enthält die Antwort auch nur eine ungültige Veranstaltung, verwirft der Adapter den ganzen Abruf
mit „Antwort nicht lesbar“, behält den letzten Stand und steht auf „gestört“. Spricht die
liefernde Anwendung eine neuere Fassung des Vertrags („Unbekannte Schnittstellenversion“) oder
lehnt sie den Schlüssel ab („Zugang abgelehnt“), steht der Adapter auf „braucht Eingriff“.

Eine Veranstaltung wird 14 Tage nach ihrem Ende gelöscht, und mit ihrem Adapter. Eine Ansicht
der abgerufenen Veranstaltungen gibt es in der App nicht.

### Am ELW

Meldet sich die Instanz für die Organisation bei einem Hub, nimmt sie keine Fremdsysteme an. Die
Seite nennt dann den Hub; Anbindungen und Einwurf-Zugänge werden dort angelegt. Bestehende
Anbindungen bleiben stehen und gelten wieder, sobald die Kopplung mit dem Hub endet; solange nennt
ihre Zeile keinen Einsatz. Eine Freigabe aus der Zeit davor ruht (siehe
[Externe Lagemonitore](externe-lagemonitore.md)). Bestehende Einwurf-Zugänge lassen sich weiter
widerrufen, ihre Einwürfe werden abgelehnt. Adapter ruft eine solche Instanz nicht ab; die Seite
zeigt sie mit „Am Hub anbinden“, und alle Aktionen sind gesperrt. Ihre Geheimnisse gehen nicht an
den Hub: ein Adapter wird am Hub neu angelegt.

Eine Direktkopplung vor Ort mit einem zweiten ELW sperrt nichts davon: Ohne Hub nimmt jeder der
beiden ELW seine Fremdsysteme selbst an.

### Schlüssel und Code

Der Code gilt 15 Minuten und einmal. Gespeichert wird er nicht, nur abgeleitete Werte; der Code
selbst geht beim Einlösen nie über die Leitung. Den privaten Schlüssel kennt nur das Fremdsystem.

### Was protokolliert wird

Anlegen, neuer Code, Einlösen, Ändern und Widerruf stehen im
[Zugangsprotokoll](zugangsprotokoll.md), mit Rechten und Fingerabdruck. Ebenso Einrichten,
Ändern, Entfernen und Wiederaufnehmen eines Webhooks und, als eigener Eintrag, das Erlauben und
Zurücknehmen eines Ziels im lokalen Netz; genannt wird der Server des Ziels, nie die ganze
Adresse. Hinterlegen, Wechseln und Entfernen des Fingerabdrucks und jedes „Vom Ziel holen“
stehen ebenfalls darin, mit dem Fingerabdruck. Ein Testereignis steht nicht darin. Jede angenommene Anfrage
zählt je Anbindung, Route und Tag; „zuletzt genutzt“ nennt die letzte, auf die Minute genau. Die
Zählung wird nach 365 Tagen gelöscht.

Bei einem Einwurf-Zugang stehen Anlegen, Schlüsselwechsel und Widerruf im Zugangsprotokoll, mit
dem Zweck und nie mit dem Schlüssel. „Zuletzt genutzt“ nennt den letzten angenommenen Einwurf.
Der Server schreibt den Schlüssel in kein Protokoll.

Bei einem Adapter stehen Anlegen, Ändern, Löschen, Setzen und Entfernen eines Geheimnisses,
Anhalten, Fortsetzen und das Erlauben und Zurücknehmen eines Ziels im eigenen Netz im
Zugangsprotokoll, mit Art, Platz und Server des Ziels, nie mit einem Wert. „Verbindung prüfen“
steht nicht darin.
