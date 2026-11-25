# Helfer-App Stufe 2 (LLH-Pager): Aufträge zustellen und quittieren — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/c19brpvf22lzcfr0i43vcl4q (LLH-2111) · Stand 25.11.2026
Bezug: LLH-2092 (Stufe 1, Entwurf `2026-11-24-vakwvkpg-helfer-app-design.md`), LLH-1636
(Entscheidung Pager), LLH-1579 (Einheitenansicht), LLH-1223 (Web Push), ADR-0090 (iOS-Push),
ADR-0101 (Helfer-App), LLH-1197 (Vertrag „Ausgang“, nur Konzept).

## Warum

Im laufenden Einsatz, etwa beim Sanitätsdienst oder an einem Bereitstellungsraum, will die
Einsatzleitung einer Einheit oder einer einzelnen Kraft einen Auftrag geben: „verletzte Person im
Bereitstellungsraum, Zelt 3“. Die Kraft soll das auch merken, wenn das Handy in der Tasche steckt,
und mit „Übernommen“ antworten. Die Leitung sieht die Quittung am Auftrag. Heute geht das nur über
Funk oder über ein gekoppeltes Einheitengerät mit offener Seite.

Die Helfer-App aus Stufe 1 ist schon am Einsatz angemeldet und an eine Einheit oder ein Fahrzeug
gebunden, auf Wunsch auch an eine Person. Stufe 2 nutzt genau diese Anmeldung als Pager. Die
Alarmierung *in* den Einsatz bleibt bei Divera und aPager.

## Entscheidungen des Menschen

Am 25.11.2026 bestätigt (Phase-1-Abstimmung; ausdrücklich 1a, 2a, 4a, die übrigen Punkte ohne
Widerspruch):

1. **iOS:** Zustellung über APNs und das vorhandene Push-Relais. Das Relais bekommt ein
   zusätzliches Feld für die App und eine Liste erlaubter Bundle-IDs. Es sieht keinen Inhalt, die
   Nutzlast ist Ende-zu-Ende verschlüsselt wie bei der Lifeline-App (ADR-0090). Die Helfer-App
   bekommt einen Mitteilungsdienst (Notification Service Extension) zum Entschlüsseln.
2. **Android:** Die App hält über einen Vordergrund-Dienst eine eigene Verbindung zum Live-Kanal
   des Servers offen, solange die Kopplung bestätigt ist, auch wenn die Ortung pausiert oder
   ruht. Eine sichtbare Benachrichtigung zeigt das. Kein FCM (die App kommt ohne Play-Dienste),
   kein UnifiedPush.
3. **ADR:** Eine neue ADR ergänzt ADR-0101 um Empfang von Aufträgen.
4. **Empfänger:** Ein Auftrag an eine **Einheit** oder ein **Fahrzeug** geht an alle bestätigten
   Helfer mit diesem Ziel; ein Auftrag an eine **Person** an den Helfer, dem die Leitung diese
   Person zugeordnet hat. Die erste Quittung zählt für die Empfängerzeile, wie heute. Aufträge an
   einen Abschnitt gehen nicht an Helfer.
5. **Zustände:** Zugestellt wird nur bei bestätigter Kopplung, auch wenn die Ortung pausiert oder
   ruht; nicht im Zustand „wartet auf Bestätigung“. Nach Einsatzende, Widerruf oder Ablauf kommt
   nichts mehr. Ohne Netz gibt es keine Warteschlange; die fehlende Quittung sieht die Leitung,
   sie greift zum Funk.
6. **In der App:** Bereich „Aufträge“ mit Liste, Detail und Knopf „Übernommen“ (= Quittung).
   Ein neuer Auftrag klingelt und vibriert, unter iOS mit der Stufe „zeitkritisch“. Keine
   Critical Alerts, kein „Ausgeführt melden“, keine Rückmeldungen.
7. **Weg im Server:** Zustellung direkt beim Erteilen eines Auftrags, neben der vorhandenen
   Benachrichtigung. Nicht über den (noch nicht gebauten) Vertrag „Ausgang“; kommt der, wird der
   Pager dort ein Kanal.
8. **Leitung:** Die Empfängerzeile am Auftrag zeigt „an n Helfer-Apps gesendet“. Sonst keine
   Änderung im Frontend.
9. **Schnitt:** ein Branch, ein PR mit Entwurf, Plan und Umsetzung. Der Update-Kanal der
   Android-Helfer-App gehört nicht dazu.

Push am Bundle `dev.rubeen.lifeline.helfer` ist nach Rubens Angabe schon eingeschaltet. Die
Kennung des Mitteilungsdienstes legt der Bauende im Apple-Portal per Browser an (Ruben,
25.11.2026).

## Ziele

- Ein Auftrag an eine Einheit, ein Fahrzeug oder eine zugeordnete Person erreicht jede passende,
  bestätigte Helfer-App **innerhalb weniger Sekunden**, auch bei gesperrtem Handy und
  geschlossener App (iOS) bzw. geschlossener Oberfläche (Android, Dienst läuft).
- „Übernommen“ in der App schreibt die Quittung an die Empfängerzeile, über denselben Weg wie die
  Einheitenansicht. Die Leitung sieht sie sofort (Live-Ereignis `auftrag`) samt Absender.
- Ohne bestätigte Kopplung wird nichts zugestellt; nach dem Ende der Kopplung oder des Einsatzes
  kommt nichts mehr an, auch kein verspäteter Push.
- Die Leitung sieht am Auftrag, an wie viele Helfer-Apps er gegangen ist.

## Nicht-Ziele

- Alarmierung in den Einsatz (Divera, aPager), Aufträge außerhalb eines laufenden Einsatzes.
- „Ausgeführt melden“, Rückmeldungen, Status (FMS) aus der Helfer-App, Meldungen an die Leitung.
- Critical Alerts unter iOS (bräuchte eine Genehmigung von Apple).
- FCM, UnifiedPush oder ein anderer Pushdienst unter Android.
- Warteschlange für Aufträge ohne Netz; Zustellbestätigung je Gerät.
- Update-Kanal der Android-Helfer-App.
- Aufträge an Abschnitte, Funktionen oder externe Empfänger an Helfer.
- Änderungen an der Einheitenansicht oder an der Benachrichtigung der Leitung.

## Anti-Ziele (daran wäre es gescheitert, auch wenn es läuft)

- Ein Helfer bekommt nach dem Einsatzende oder nach seinem Widerruf noch einen Auftrag.
- Ein Helfer sieht Aufträge, die nicht an seine Einheit, sein Fahrzeug oder seine Person gehen.
- Das Relais oder Apple sieht den Inhalt eines Auftrags.
- Unter Android hört die App unbemerkt auf zu empfangen: Wer keine Benachrichtigung „empfängt
  Aufträge“ sieht, darf sich nicht für erreichbar halten.
- Die Quittung entsteht auf einem eigenen Weg neben dem vorhandenen und weicht von ihm ab.
- Logik in der App-Schicht statt im getesteten Kern.

## Wie es heute ist

- **Aufträge** (`src/auftrag/`, Migration 0048): Empfänger je Zeile in `auftrag_empfaenger`
  (`einheit`, `fahrzeug`, `person` → `einsatz_personal`, `abschnitt`, `funktion`, `extern`). Die
  Quittung liegt an der Zeile (`quittiert_at`, `quittiert_von_id`), geschrieben von
  `repo::quittiere_empfaenger` (idempotent, 422 bei aufgehobenem Auftrag). Der Handler
  `routes::auftrag::quittieren` benachrichtigt danach den Ersteller, schließt die
  Fristerinnerung, wenn alle quittiert haben, und sendet `LiveEvent::Auftrag`.
  `auftrag::nach_erteilung` ist die eine Stelle nach dem Erteilen.
- **Einheitenansicht** (LLH-1579): vier Auftragsrouten in `EINHEIT` (`src/geraet/mod.rs`),
  zugeschnitten über `abschnitt::bereich`; Personenempfänger zählen dort nie als „eigen“.
- **Helfer-Kopplung** (LLH-2092, Migration 0377): `geraet_kopplung` mit `ansicht='helfer'`,
  `helfer_zustand` (`unbestaetigt`/`aktiv`/`abgelehnt`), Ziel `einheit_id` XOR `fahrzeug_id`,
  `person_id` (von der Leitung zugeordnet), `pausiert_at`. Routenliste `HELFER` erbt nichts,
  `lese_module(Helfer)` ist leer; der Live-Kanal trägt nur Lebenszeichen und das Kopplungsende.
- **Push:** Gerätekonten sind in der Empfängerauflösung (`benachrichtigung/aufloesung.rs`) und in
  `ios_push` ausgeschlossen. `ios_push_anmeldung` hängt am Benutzer. Das Relais
  (`push-relais/`) sendet mit genau einer Bundle-ID (`PUSH_RELAIS_BUNDLE_ID`) als `apns-topic`;
  `Nachricht` = {token, umgebung, stufe, kollaps, nutzlast}.
- **Einsatzende:** `einsatz::repo::abschliessen` setzt kein `widerrufen_at`; jede Geräteanfrage
  scheitert danach an `kontext_wenn_gueltig` (Einsatz aktiv). Live-Ströme enden über
  `melde_kopplung_ende`.
- **Apps:** Die Helfer-Apps (`ios/Helfer`, `android/helfer`, Kerne `HelferKern`/`helferkern`)
  kennen weder Push noch SSE. Android hat einen Vordergrund-Dienst vom Typ `location`
  (`OrtungsDienst`, `START_NOT_STICKY`), der in „Ruhe“ und bei „Pausiert“ stoppt. iOS hat kein
  `aps-environment` und keinen Mitteilungsdienst.

## Ansätze

| Ansatz | Was er bedeutet | Abwägung |
| --- | --- | --- |
| **iOS: APNs über das vorhandene Relais mit App-Feld (gewählt)** | `thema` in der Relais-Nachricht, Allowlist der Bundle-IDs im Relais | Ein Relais, ein `.p8`-Schlüssel, additiv; das Relais bleibt blind. |
| iOS: zweite Relais-Instanz | eigene Instanz mit Helfer-Bundle | Doppelter Betrieb ohne Gewinn. Verworfen. |
| **Android: Live-Verbindung im Vordergrund-Dienst (gewählt)** | SSE-Verbindung zum Server der Kopplung, solange sie bestätigt ist | Kein Dritter, passt zu ADR-0101. Grenze: Beendet Android den Prozess, kommt nichts an; die fehlende Benachrichtigung zeigt das. |
| Android: UnifiedPush/ntfy | Verteiler-App auf dem Gerät | Zusätzliche App, zusätzlicher Dienst. Verworfen. |
| Android: FCM | Google-Push | Braucht Play-Dienste, die App kommt ohne. Verworfen. |
| **Server: Zustellung aus `nach_erteilung` (gewählt)** | eigener Baustein `helfer::pager` | Klein, nutzt den Quittungsweg. |
| Server: als Kanal im Vertrag „Ausgang“ | erst Ausgang bauen | Ausgang existiert nicht; vertagt. |
| **Empfänger: alle bestätigten Helfer des Ziels (gewählt)** | Einheit/Fahrzeug an alle, Person an den Zugeordneten | Jeder Trupp-Angehörige merkt es; die erste Quittung zählt. |
| Empfänger: nur das Ortungsgerät | ein Gerät je Ziel | Fällt das Gerät aus, merkt es niemand. Verworfen. |

## Entwurf

### Begriffe

- **Pager-Empfänger:** eine Helfer-Kopplung mit `helfer_zustand='aktiv'`, `widerrufen_at IS NULL`,
  nicht abgelaufen, am aktiven, nicht gelöschten Einsatz. Pausiert oder ruhend zählt mit.
- **Eigene Empfängerzeile** einer Helfer-Kopplung: eine Zeile in `auftrag_empfaenger` desselben
  Einsatzes mit `empfaenger_typ='einheit' AND einheit_id = kopplung.einheit_id`, oder
  `'fahrzeug' AND fahrzeug_id = kopplung.fahrzeug_id`, oder `'person' AND person_id =
  kopplung.person_id` (nur wenn die Leitung eine Person zugeordnet hat).
- **Pager-Anmeldung:** die Push-Anmeldung einer Helfer-App unter iOS, je Kopplung höchstens eine.

### Ablauf

```
Leitung                       Server                                  Helfer-App
───────                       ──────                                  ──────────
Auftrag an „San-Trupp 2“ ──► nach_erteilung
                              └ helfer::pager::zustellen
                                 Pager-Empfänger je eigener Zeile
                                 zählen → helfer_gesendet
                                 ├ Live (nur an diese Kopplungen) ──► Android: Dienst-SSE → Mitteilung
                                 └ iOS: Relais (thema=helfer) ──────► APNs → Mitteilungsdienst
                                                                          entschlüsselt → Mitteilung
                                                                     Tippen → App → Detail
                                                                     „Übernommen“
                              ◄── POST /api/devices/me/tasks/{aid}/recipients/{empf}/acknowledge
                              quittiere_empfaenger (wie Einheitenansicht),
                              Ersteller benachrichtigt, LiveEvent::Auftrag
Auftrag zeigt „quittiert von ◄─
Max M. (Helfer-App)“
```

### Server

**Routen** (Routenliste `HELFER`, Glossar: `devices`, `tasks`, `recipients`, `acknowledge`,
`push`):

- `GET /api/devices/me/tasks` — die nicht aufgehobenen Aufträge mit mindestens einer eigenen
  Empfängerzeile, neueste zuerst, je Auftrag die Felder des Befehlsschemas, die die
  Einheitenansicht zeigt (Auftragstext, Ort/Ziel samt `ziel_koordinate`, Priorität, Frist,
  erteilt um), dazu die eigenen Empfängerzeilen mit Quittungsstand (`quittiert_at` und der
  Anzeigename des Quittierenden). Nur im Zustand `aktiv`, sonst 403 (`not_confirmed`).
  Aufgehobene Aufträge der letzten 30 Minuten kommen als `aufgehoben` mit, damit die App sie als
  aufgehoben zeigen kann (Wert dem Bauenden überlassen).
- `POST /api/devices/me/tasks/{aid}/recipients/{empf}/acknowledge` — Quittung. Prüft: Kopplung
  `aktiv`, `{empf}` ist eine eigene Empfängerzeile von `{aid}`, sonst 404. Ruft denselben Ablauf
  wie `routes::auftrag::quittieren` (Quittung, Benachrichtigung des Erstellers, Fristerinnerung,
  Live). Dieser Ablauf wird dafür in eine gemeinsame Funktion im Modul `auftrag` gezogen, die beide
  Handler aufrufen; die Prüfung „gehört mir“ bleibt je Handler. Schreiber ist das Gerätekonto.
- `PUT /api/devices/me/push` — Pager-Anmeldung (nur iOS): `{token, environment, key_id, key}`
  wie die Brückenantwort der Lifeline-App (`push_register`: Kennung, Token, Umgebung, Schlüssel).
  Ersetzt eine vorhandene Anmeldung der Kopplung. `DELETE /api/devices/me/push` meldet ab.
  Erlaubt in `unbestaetigt` und `aktiv`, damit die App sich gleich nach dem Einlösen anmelden kann;
  zugestellt wird trotzdem nur an `aktiv`.

Warum eigene Routen unter `/api/devices/me/…` statt die vier Routen der Einheitenansicht: Der
Helfer schreibt laut ADR-0101 und Stufe 1 nur über seine eigenen Routen, `abschnitt::bereich`
kennt keine Fahrzeug- und Personenziele, und der Helfer soll keinen Einsatzkopf und keine
Auftragsliste des Einsatzes sehen. (Festlegung des Entwurfs.)

**Daten** (eine Migration; Nummer nach `migrations/AGENTS.md`):

- Neue Tabelle `helfer_push_anmeldung`: `kopplung_id` (PK, FK `geraet_kopplung` ON DELETE
  CASCADE), `kennung`, `token`, `umgebung`, `schluessel`, `angelegt_at`. Kein Verweis auf Benutzer
  oder Sitzung: die Anmeldung gehört der Kopplung.
- `auftrag_empfaenger.helfer_gesendet INTEGER NOT NULL DEFAULT 0`: an wie viele Pager-Empfänger
  die Zeile beim Erteilen ging. Bestand 0.

**Zustellung** (`src/helfer/pager.rs`, aufgerufen aus `auftrag::nach_erteilung`, nach dem Commit):

1. Für jede Empfängerzeile vom Typ `einheit`, `fahrzeug`, `person` die Pager-Empfänger bestimmen
   (eine Abfrage). Eine Kopplung, die für mehrere Zeilen desselben Auftrags passt (Einheit und
   Person), bekommt **eine** Zustellung mit allen eigenen Zeilen.
2. `helfer_gesendet` je Zeile schreiben.
3. Live: ein neues, kopplungsgenaues Ereignis über einen eigenen Broadcast des `LiveHub` nach dem
   Muster `kopplung_ende` (`melde_helfer_auftrag(kopplung_ids, auftrag_id)`). Der Live-Strom einer
   Helfer-Kopplung reicht es als SSE-Ereignis `helfer_auftrag` mit `{task_id}` durch; andere
   Ströme sehen es nie. `lese_module(Helfer)` bleibt leer. Dasselbe Ereignis geht nach einer
   Quittung (auch durch einen anderen Helfer) und nach einer Aufhebung an die betroffenen
   Kopplungen, damit offene Apps ihre Liste neu laden.
4. iOS: für jede Kopplung mit Pager-Anmeldung eine verschlüsselte Nutzlast wie in ADR-0090 (AES-GCM,
   AAD = Kennung) mit `{art:"auftrag", einsatz_id, task_id, titel, text}`; `titel` = Kurztext
   (Rufname des Ziels oder „Auftrag“), `text` = Auftragstext gekürzt wie `inhalt::kuerzen`. Stufe
   `alarm` (zeitkritisch), `kollaps` je Auftrag. An das Relais mit `thema =
   "dev.rubeen.lifeline.helfer"`. Antwortet das Relais „Token ungültig“, wird die Anmeldung
   gelöscht. Ohne eingerichteten iOS-Push (`--ios-push` aus) entfällt dieser Schritt.
5. Zustellung bei Quittung oder Aufhebung: nur Live (Schritt 3), kein Push.
6. **Berichtigung** (`routes::auftrag::berichtigen`, `PATCH …/tasks/{aid}`): Kommen dabei
   Empfängerzeilen hinzu, gehen die Schritte 1–4 für **die neuen Zeilen** (Push nur an Kopplungen,
   die vorher keine eigene Zeile des Auftrags hatten; `helfer_gesendet` an den neuen Zeilen).
   Alle Kopplungen mit einer eigenen Zeile bekommen das Live-Ereignis, damit offene Apps den
   geänderten Text laden. `helfer::pager` hat dafür einen zweiten Einstieg neben
   `nach_erteilung`. (Festlegung des Entwurfs.)

Der Versand läuft wie bei `ios_push::versenden` im Hintergrund und darf das Erteilen nicht
aufhalten oder scheitern lassen; Fehler werden ohne Token und Nutzlast geloggt.

**Ende:** Jeder Weg, der eine Helfer-Kopplung beendet (Widerruf, Ablehnung, Abmelden, Ablauf,
Einsatzende, Leitungswechsel `beende_alle_im_einsatz`), löscht ihre `helfer_push_anmeldung`.
Unabhängig davon prüft die Zustellung in Schritt 1 den Zustand frisch, sodass auch ein vergessener
Weg nichts zustellt. Ein Test je Endweg hält fest, dass danach weder Live noch Push rausgeht.
Hinweise: Ein Ablauf schreibt heute nichts (`src/helfer/ende.rs`); das Löschen hängt dort an der
Aufräumung des Ablauf-Takts (`raeume_abgelaufene`). Die übrigen Endwege laufen meist über
`geraet::repo::beenden`. `auftrag_empfaenger` wird an Spiegelinstanzen kopiert und hat
Änderungs-Trigger (Migration 0314); die neue Spalte muss dazu passen.

**Leitung:** `GET` eines Auftrags liefert je Empfängerzeile `helfer_gesendet` und, wenn das
Gerätekonto einer Helfer-Kopplung quittiert hat, als Namen den Anzeigenamen der Kopplung mit dem
Zusatz „(Helfer-App)“. Typ-Codegen nach `src/AGENTS.md`.

### Push-Relais

- `Nachricht` bekommt `thema: Option<String>` (additiv, `push-relais/AGENTS.md`: Wire deutsch und
  additiv). Fehlt es, gilt `PUSH_RELAIS_BUNDLE_ID` wie heute.
- Neue Einstellung `PUSH_RELAIS_WEITERE_BUNDLE_IDS` (Liste, Vorgabe leer) in `src/config.rs`. Ein
  `thema` außerhalb von Hauptbundle und Liste lehnt das Relais mit 422 ab, ohne an Apple zu
  senden. Gesendet wird mit `apns-topic = thema`; derselbe `.p8`-Schlüssel gilt für alle Apps des
  Teams.
- Betriebsdoku im selben Commit; Tests mit dem APNs-Doppel (Thema durchgereicht, fremdes Thema
  abgelehnt, ohne Thema unverändert).
- Der Server sendet `thema` nur bei Pager-Sendungen. Ein altes Relais ohne das Feld würde es
  ignorieren und mit falschem Topic senden; Apple lehnt das ab (`DeviceTokenNotForTopic`), das
  Ergebnis ist „Fehler“, kein Schaden. Reihenfolge im Betrieb: Relais zuerst ausrollen.

### iOS-Helfer-App

- **Fähigkeiten:** `aps-environment` in `LifelineHelfer.entitlements` (wie die Hülle: development,
  production beim Export). Kein `remote-notification` in `UIBackgroundModes` (Alert-Push).
- **Mitteilungsdienst:** neues Ziel `HelferDienst` (Notification Service Extension), Bundle
  `dev.rubeen.lifeline.helfer.dienst`, App Group `group.dev.rubeen.lifeline.helfer`. Er
  entschlüsselt mit dem Schlüssel aus der gemeinsamen Ablage (Keychain-Zugriffsgruppe oder App
  Group, wie die Hülle es mit `ios/Benachrichtigungsdienst` macht) und setzt Titel, Text,
  `interruptionLevel = .timeSensitive`, Ton. Kann er nicht entschlüsseln, bleibt der Rückfalltitel
  des Relais. Die Prüfung in `ios-helfer.yml` kennt die neue Kennung.
- **Anmeldung:** Nach dem Einlösen fragt die App das Mitteilungsrecht an (Alert, Ton, Badge,
  Time Sensitive) und meldet Token und Schlüssel mit `PUT /api/devices/me/push` an. Abgelehnt →
  Hinweis im Bildschirm „Angemeldet“: „Mitteilungen aus — du bekommst Aufträge nur bei offener
  App“. Beim Abmelden `DELETE`, beim Ende der Kopplung nichts (der Server löscht).
- **Ohne SSE:** Solange die App offen ist, kommen Pushes per `willPresent` an und lösen ein
  Neuladen der Liste aus; beim Öffnen und bei Rückkehr in den Vordergrund lädt die App die Liste.
  Eine eigene Live-Verbindung bekommt die iOS-App nicht. (Festlegung des Entwurfs.)
- **Kern (`HelferKern`):** Nutzlast entschlüsseln und deuten (gemeinsame Fälle), Auftragsliste
  ordnen (offen vor quittiert vor aufgehoben, dann neueste), Quittungszustand je Auftrag
  (offen → sendet → quittiert; Fehler → offen mit Grund), Texte.

### Android-Helfer-App

- **Ein Dienst, eine Benachrichtigung:** Der vorhandene Vordergrund-Dienst wird zum Helfer-Dienst
  mit zwei Aufgaben: orten (wie bisher) und empfangen. Typen `location|remoteMessaging`, Recht
  `FOREGROUND_SERVICE_REMOTE_MESSAGING`. Er startet wie bisher nur aus dem Vordergrund (beim
  Einlösen) und läuft, solange die Kopplung besteht. Pausiert oder ruht die Ortung, ortet er
  nicht, empfängt aber weiter; er läuft dann nur mit dem Typ `remoteMessaging`. Den Typ `location`
  nimmt er erst wieder auf, wenn die Ortung aus einem erlaubten Zustand weitergeht (ADR-0101:
  Ortung startet nur aus dem Vordergrund; wie „Ruhe“ heute fortsetzt, bleibt). Ohne
  `ACCESS_BACKGROUND_LOCATION`, weiter `START_NOT_STICKY`, kein Selbstneustart.
- **Empfang ohne Ortung:** Stufe 1 kennt Helfer, die nie orten (ohne Ortungsrolle und ohne
  Person, Org-Schalter aus, Standortrecht abgelehnt); es gibt sie gerade, damit Stufe 2 ihnen
  Aufträge zustellt (Entwurf Stufe 1, „Ein Ortungsgerät je Ziel“). Deshalb startet der Dienst beim
  Einlösen **immer**, aus dem Vordergrund: mit `location|remoteMessaging`, wenn geortet werden
  darf und das Recht da ist, sonst nur mit `remoteMessaging`. Empfangen hängt damit nicht am
  Orten. Endet eine Ruhe im Hintergrund und darf der Dienst den Typ `location` dort nicht wieder
  aufnehmen, empfängt er weiter und ortet erst, wenn die App wieder vorn ist; die Benachrichtigung
  sagt „Ortung wartet — App öffnen“.
- **Mitteilungsrecht** (Android 13+): Wird `POST_NOTIFICATIONS` abgelehnt, zeigt „Angemeldet“
  denselben Hinweis wie unter iOS („Mitteilungen aus — du bekommst Aufträge nur bei offener
  App“). (Festlegung des Entwurfs.)
- **Benachrichtigung des Dienstes:** zeigt beide Zustände, etwa „Ortung an · empfängt Aufträge“
  bzw. „Ortung pausiert · empfängt Aufträge“, und „getrennt — verbinde neu“, wenn die
  Live-Verbindung gerade fehlt.
- **Empfang:** Ab `aktiv` hält der Dienst `GET /api/incidents/{id}/live` offen (auf IO, nicht
  Main). Auf `helfer_auftrag` lädt er `GET /api/devices/me/tasks` und zeigt für jeden neuen,
  offenen Auftrag eine Mitteilung im Kanal „Aufträge“ (hohe Wichtigkeit, Ton, Vibration, auch auf
  dem Sperrbildschirm). Tippen öffnet das Detail. Neu verbinden mit wachsendem Abstand (wie die
  Sendung: höchstens jede Minute); bei 401/403/404 endet die Kopplung wie heute. Nach jedem
  Neuverbinden lädt er die Liste einmal, damit ein verpasster Auftrag ohne Mitteilung, aber in der
  Liste erscheint — Mitteilung nur für Aufträge, die jünger als 10 Minuten sind (Wert dem
  Bauenden überlassen).
- **Kern (`helferkern`):** SSE-Leser (Zeilen zu Ereignissen, Lebenszeichen, Abbruch), Entscheidung
  „neu verbinden, warten oder enden“, welche Aufträge eine Mitteilung bekommen (neu, offen, jung,
  noch nicht gemeldet), Liste ordnen, Quittungszustand, Texte. Gemeinsame Fälle mit iOS.

### Oberfläche der App (beide Plattformen)

- **Angemeldet:** neuer Bereich „Aufträge“ unter der Ortungsanzeige, mit Zahl der offenen.
  Leer: „Keine Aufträge. Neue Aufträge kommen als Mitteilung.“ Darunter unter Android der
  Empfangszustand, unter iOS der Hinweis bei abgelehnten Mitteilungen.
- **Auftrag (Detail):** Auftragstext groß, Ort/Ziel, Priorität, Frist, erteilt um, an wen (Einheit,
  Fahrzeug oder „an dich“). Großer Knopf **„Übernommen“**; danach „Übernommen um 14:32“ bzw.
  „Übernommen von <Name> um …“, wenn ein anderer Helfer derselben Einheit schneller war.
  Aufgehoben: durchgestrichen mit „aufgehoben“, kein Knopf. Ohne Netz: Fehler am Knopf, „Bitte
  über Funk bestätigen“.
- Wie in Stufe 1: Lifeline Design System über die erzeugten Tokens, hell und dunkel, große Schrift,
  VoiceOver/TalkBack; jeder neue Bildschirm bekommt einen Testzustand und ein Bild
  (`ios/Helfer/AGENTS.md`, `android/helfer/AGENTS.md`).
- „Pausiert“ und „Ruht“ zeigen den Bereich „Aufträge“ ebenfalls.

### Oberfläche der Leitung (Web)

- In Auftragsdetail und -liste an der Empfängerzeile: „an n Helfer-Apps gesendet“, wenn
  `helfer_gesendet > 0`; Quittung „quittiert von Max M. (Helfer-App) um 14:32“. Sonst nichts.

### Gemeinsame Fälle

`src-tauri/faelle/helfer-auftrag.json`: SSE-Rahmen und ihre Deutung, Nutzlast-Klartext und
Chiffrat (Testvektor wie `push-nutzlast.json`), Ordnung der Liste, Entscheidung „Mitteilung ja/
nein“. Server (Rust, Verschlüsselung und Nutzlast), `HelferKern` und `helferkern` lesen sie.

### ADR (neu, ergänzt ADR-0101)

Titel-Vorschlag: „Die Helfer-App empfängt Aufträge nur für eine bestätigte Kopplung: iOS über das
Relais ohne Inhalt, Android über die eigene Verbindung zum Server“.

- MUST: Zugestellt wird nur an Pager-Empfänger (bestätigt, nicht beendet, Einsatz aktiv); der
  Server prüft das bei jeder Zustellung frisch.
- MUST: iOS-Push nur über das Relais, Nutzlast Ende-zu-Ende verschlüsselt (ADR-0090), Anmeldung
  an die Kopplung gebunden und mit ihr gelöscht.
- MUST: Android empfängt nur über eine Verbindung zum Server der Kopplung im sichtbaren
  Vordergrund-Dienst; kein FCM, kein Dritter. Der Dienst startet nur aus dem Vordergrund.
- MUST: Die Quittung läuft über die Quittung der Empfängerzeile, keinen eigenen Speicher.
- MUST NOT: Aufträge auf dem Gerät auf die Platte schreiben; mehr als die Liste im Speicher halten.
- Ergänzt die ADR-0101-Regel „sendet nur an den Server ihrer Kopplung“ um die Ausnahme APNs/Relais
  für iOS; die Prüfungen aus ADR-0101 (`verbiete`/`verlange`) bekommen `aps-environment` für
  `LifelineHelfer` und `FOREGROUND_SERVICE_REMOTE_MESSAGING` für das Android-Manifest als erlaubt.
- Nummer nach `docs/architektur/AGENTS.md` (derzeit wäre es ADR-0105).

### Datenschutz

- Ein Auftrag kann Personendaten tragen (etwa „Patientin, 70 J., Sturz“). Er erreicht das Gerät
  nur verschlüsselt (iOS) bzw. über die eigene Verbindung (Android); das Relais sieht nichts.
- Auf dem Sperrbildschirm zeigt die Mitteilung Titel und Text, gesteuert über die
  Systemeinstellung „Vorschauen“ (iOS) bzw. Sperrbildschirm-Sichtbarkeit (Android). Die App setzt
  unter Android `VISIBILITY_PRIVATE` mit öffentlicher Fassung „Neuer Auftrag“. (Festlegung des
  Entwurfs, siehe „Zur Prüfung“.)
- Die DSFA-Vorlage aus Stufe 1 bekommt einen Absatz zu Aufträgen auf Privatgeräten.
- Anwenderdoku: das Kapitel „Helfer anmelden“ bekommt „Aufträge empfangen“, die Leitungsseite
  „Aufträge an Helfer“ (`docs/anwender/AGENTS.md`). Betriebsdoku: Relais-Einstellung.
  arc42-Mitänderung nach `docs/architektur/AGENTS.md`.

## Umsetzungsaufgaben (Reihenfolge für den Plan)

1. ADR und Prüfungen; `AGENTS.md` der Helfer-Ordner und `push-relais/AGENTS.md` ergänzen.
2. Relais: `thema`, Allowlist, Tests, Betriebsdoku.
3. Server: Migration, Quittungsablauf als gemeinsame Funktion, Routen `/api/devices/me/tasks…`
   und `/api/devices/me/push`, `helfer::pager` (Empfänger, Live-Broadcast, iOS-Versand),
   Löschen an allen Endwegen, Tests (`tests/geraet_kopplung.rs` für die Routenliste, Zustellung,
   Endwege), Typ-Codegen.
4. Frontend Leitung: „an n Helfer-Apps gesendet“, Quittiert-von-Helfer.
5. Gemeinsame Fälle `helfer-auftrag.json`.
6. iOS: Kern, Entitlement, Mitteilungsdienst, Anmeldung, Bereich und Detail, Testzustände;
   Apple-Portal: Kennung `…helfer.dienst` mit App Group (per Browser).
7. Android: Kern (SSE, Mitteilungsentscheidung), Dienst mit `remoteMessaging`, Mitteilungskanal,
   Bereich und Detail, Testzustände.
8. Doku: Anwender, Betrieb, DSFA, arc42.

## Dem Bauenden überlassen

- Namen von Spalten, Typen und Funktionen nach „Bezeichner-Sprache“; Routen nach dem Glossar.
- Wie lange aufgehobene Aufträge in der Liste bleiben (Vorschlag 30 min) und das Alter für
  Mitteilungen nach Neuverbinden (Vorschlag 10 min).
- Genaue Ablage des Schlüssels für den iOS-Mitteilungsdienst (Muster der Hülle übernehmen).
- Wie der Android-Dienst zwischen den Typen wechselt, solange ADR-0101 eingehalten bleibt.
- Kürzung des Auftragstexts in der Nutzlast (Grenze wie bei `ios_push::inhalt`).

## Zur Prüfung durch den Menschen (Festlegungen des Entwurfs)

- Eigene Routen `/api/devices/me/tasks…` statt der Routen der Einheitenansicht.
- iOS ohne eigene Live-Verbindung; Neuladen über Push im Vordergrund und beim Öffnen.
- Ein Android-Dienst mit einer Benachrichtigung für Ortung und Empfang.
- Push-Anmeldung in einer eigenen Tabelle an der Kopplung, nicht in `ios_push_anmeldung`.
- Sperrbildschirm unter Android: nur „Neuer Auftrag“, bis entsperrt.
- `helfer_gesendet` als gespeicherte Zahl beim Erteilen, keine Zustellbestätigung je Gerät.
- Berichtigung mit neuen Empfängern stellt an die neu Betroffenen zu; die übrigen laden still neu.
- Android: der Dienst startet beim Einlösen immer, auch ohne Ortung (nur Empfang).
