# Helfer-App: am Einsatz anmelden per QR-Code, Position senden — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/vakwvkpgn0ivb1wpq8mlqwhx (LLH-2092) · Stand 24.11.2026
Bezug: LLH-1199 (Gate Ortung), LLH-2091 (Positionen auf die Lagekarte), LLH-1636 (Entscheidung
Pager), LLH-2111 (Stufe 2: Aufträge), LLH-1654 (Einwurf), ADR-0093 (Standort in den Hüllen).

## Warum

Die Einsatzleitung will auf der Lagekarte sehen, wo ihre Kräfte und Fahrzeuge gerade sind, ohne
dass jemand die Position von Hand nachzieht. Das gilt vor allem beim Sanitätsdienst und an
Bereitstellungsräumen. Ruben hat das Gate in LLH-1199 am 24.11.2026 entschieden: Ortung ist
für das Ehrenamt erlaubt. Für Ehrenamtliche gilt das BetrVG nicht (§ 5 Abs. 2 Nr. 3), die DSGVO
aber immer. Für Hauptamtliche gibt es einen Schalter je Organisation, der ohne
Betriebsvereinbarung aus bleibt (LLH-2091).

Als Übergang senden Traccar Client und OsmAnd über den Einwurf (LLH-1654, LLH-2091). Das reicht
für ein festes Fahrzeug, aber nicht für eine Kraft, die sich am Einsatz kurz anmeldet. Ihr
muss jemand einen Zugang einrichten, und eine Zuordnung zum Einsatz gibt es nicht. Die
Helfer-App schließt diese Lücke: **scannen, bestätigt werden, die App sendet, mit dem
Einsatzende ist Schluss.**

Dieselbe App bekommt in Stufe 2 Aufträge mit Quittung (LLH-2111, Entscheidung LLH-1636). Der
Entwurf legt deshalb die Anmeldung so an, dass Stufe 2 darauf aufsetzt. Gebaut wird hier nur
Stufe 1.

## Entscheidungen des Menschen (24.11.2026)

1. **Grundlage:** Die vorhandene iOS- und Android-App bekommt einen **Helfer-Modus**, eine dritte
   App gibt es nicht. Eine neue ADR löst ADR-0093 eng ab: Ortung im Hintergrund nur, solange eine
   Helfer-Kopplung aktiv ist.
2. **Anmeldung:** Ein **Einsatz-QR für viele Kräfte**, befristet und widerrufbar. Jeder Scan legt
   eine eigene Kopplung an, und die gilt erst, wenn die **Einsatzleitung sie bestätigt**.
3. **Ziel der Position:** Die Kraft wählt nach dem Scan **Einheit oder Fahrzeug** und **optional
   sich selbst als Person**. Dort landet die Position.
4. Aus LLH-1636: Empfänger in Stufe 2 sind eine Einheit oder ein Trupp, auf Wunsch eine
   Einzelperson. Der Pager arbeitet nur im laufenden Einsatz. Die Alarmierung in den Einsatz
   bleibt bei Divera und aPager.

## Ziele

- Eine Kraft mit der Lifeline-App auf iOS oder Android ist **in unter einer Minute** angemeldet:
  QR scannen, Namen eingeben, Ziel wählen, auf die Bestätigung warten.
- Nach der Bestätigung erscheint die Position am gewählten Ziel auf der Lagekarte, auch bei
  **gesperrtem Handy**. Sie ist mit „vor x min“ und der Quelle „Helfer-App“ gekennzeichnet.
- **Mit dem Einsatzende**, einem Widerruf durch die Leitung, dem Abmelden in der App oder dem
  Ablauf der Kopplung endet die Ortung auf dem Gerät. Danach wird nichts mehr gesendet.
- Die Kraft **sieht jederzeit**, ob geortet wird: in der App und an der Anzeige des
  Betriebssystems (iOS-Standortanzeige, Android-Benachrichtigung des Vordergrund-Dienstes).
- Es gibt **keinen Verlauf**. Server und Gerät halten nur die letzte Position.

## Nicht-Ziele

- Aufträge, Quittung, Push und Status (FMS) an die Helfer-App. Das ist Stufe 2 (LLH-2111). Hier
  wird nur dafür gesorgt, dass Stufe 2 auf derselben Kopplung aufsetzen kann.
- Alarmierung in den Einsatz (Divera, aPager).
- Browser oder PWA als Helfer. Im Browser zeigt die Helfer-Seite den Weg zur App (siehe
  „Ablauf“), sie ortet dort aber nicht im Hintergrund.
- Desktop-App (`src-tauri/`).
- Verlauf, Wegspur und Auswertung nach dem Einsatz.
- Eine eigene Zuordnung von Gerät zu Fahrzeug für Traccar und OsmAnd. Die liegt in LLH-2091.

## Anti-Ziele (daran wäre es gescheitert, auch wenn es läuft)

- Eine Kraft wird geortet, ohne es zu merken, oder nach dem Einsatzende weiter geortet.
- Ein fotografierter oder weitergeleiteter QR-Code bringt Fremde unbemerkt in den Einsatz.
- Die Leitung muss bei 30 Kräften 30 Codes erzeugen.
- Die Apps bekommen Anwendungslogik, die nicht im getesteten Kern steht.
- Der Akku eines Helferhandys ist nach vier Stunden Sanitätsdienst leer.

## Wie es heute ist

- **Gerätekopplung** (`src/geraet/`, `frontend/src/geraet/`, `frontend/src/geraet/AGENTS.md`):
  - Die Leitung legt je Gerät eine Kopplung an (`POST /api/einsaetze/{id}/devices`, Recht
    `EinsatzLeitungszugriff`, nur am aktiven Einsatz).
  - Der Code hat 8 Zeichen, ist 10 Minuten gültig, einmalig und nur als Hash gespeichert
    (`src/geraet/code.rs`). Der QR trägt `/koppeln#CODE`, Einlösen über `POST /api/devices/pair`.
  - Das Gerät hält danach ein Sitzungs-Cookie und ein Gerätekonto. Die Sitzung endet mit der
    Kopplung (24 h, höchstens 72 h).
  - Jede Anfrage prüft, dass der Einsatz aktiv ist. Ein Widerruf löscht die Sitzungen und
    schreibt ins ETB.
  - Je Ansicht gibt es eine Routenliste. Bindungsarten sind UHS, Betreuungsstelle,
    Bereitstellungsraum, Abschnitt, Verpflegungsstelle und Einheit, eine Person gibt es nicht.
- **Positionen:** `lat`/`lon` stehen an `einsatz_einheit`, `einsatz_fahrzeug` und
  `einsatz_personal` (Migration 0035). Gepflegt werden sie nur von Hand über
  `PATCH …/position`.
- **Einwurf** (LLH-1654): `position_letzte` je Zugang und Kennung, ohne Einsatzbezug und ohne
  Leseweg. Die Zuordnung zu Fahrzeugen ist LLH-2091.
- **Apps:**
  - Beide Apps sind dünne WebView-Hüllen mit getestetem Kern (`ios/LifelineKern`,
    `android/kern`).
  - ADR-0093 erlaubt den Standort nur im Vordergrund. Die Hülle darf ihn weder speichern noch
    selbst senden.
  - iOS liefert den Standort über die Brücke (`location_*`), Android über `navigator.geolocation`
    im WebView.
  - Beide scannen QR-Codes im Onboarding, aber nur für die Serveradresse.
  - Deeplinks laufen nur über `lifeline://`, Universal Links und App Links gibt es nicht.
  - iOS hat nur drei native Anfragen an den Server; eine vierte braucht eine neue Entscheidung
    (`ios/AGENTS.md`).
  - Verteilt werden die Apps über TestFlight und als APK über GitHub-Releases.

## Ansätze

| Ansatz | Was er bedeutet | Abwägung |
| --- | --- | --- |
| **A. Helfer-Modus in den vorhandenen Apps (gewählt)** | Die Hüllen bekommen einen Ortungsdienst, der nur bei aktiver Helfer-Kopplung läuft. Eine neue ADR löst ADR-0093 für genau diesen Fall ab. | Eine App, die es schon gibt, mit Verteilung, Mehrserverbetrieb und iOS-Push. Kosten: native Logik in beiden Hüllen (im Kern, mit Test) und eine neue Ausnahme von „die Hülle sendet nicht selbst“. |
| B. Eigene schlanke Helfer-App | Eine dritte App je Plattform nur für Helfer, ADR-0093 bleibt. | Sauber getrennt, aber doppelte Verteilung, Pflege und Signierung, und Stufe 2 müsste Push dort noch einmal bauen. |
| C. Nur Vordergrund | Die Position kommt, solange die App offen ist. Keine neue ADR. | Am billigsten, verfehlt aber den Kern: Bei gesperrtem Handy bleibt die Karte stehen. |

Bei der Anmeldung stand auch zur Wahl, einen Einwurf-Zugang je Helfer zu erzeugen. Das ist
verworfen, weil der Zugang an der Organisation hängt, keinen Einsatzbezug hat und mit dem
Einsatzende nicht von selbst endet. Ebenso verworfen ist ein signierter Maschinenzugang
(ADR-0014/ADR-0034). Er ist für Fremdsysteme mit Admin-Einrichtung gedacht, nicht für eine Kraft,
die sich für vier Stunden anmeldet. Die Gerätekopplung bringt Einsatzbezug, Ablauf, Widerruf
und ETB schon mit.

## Entwurf

### Begriffe

- **Helfer-Einladung:** der Einsatz-QR. Sie gehört zu einem Einsatz, läuft ab, lässt sich
  widerrufen und ist mehrfach einlösbar.
- **Helfer-Kopplung:** eine Gerätekopplung mit der neuen Ansicht `helfer`, je Gerät eine. Sie
  entsteht beim Einlösen einer Einladung und hat einen Zustand: `wartet` → `aktiv` → beendet
  (widerrufen, abgemeldet, abgelaufen, Einsatz beendet) oder `abgelehnt`.
- **Ziel:** Einheit oder Fahrzeug des Einsatzes, optional zusätzlich die Person (Kraft in
  `einsatz_personal`).
- **Helfer-Ortung:** der Ortungsdienst der App. Er läuft genau dann, wenn eine Helfer-Kopplung
  `aktiv` ist und die Kraft die Ortung nicht selbst pausiert hat.

### Ablauf

```
Leitung                          Server                         Helfer-App (iOS/Android)
───────                          ──────                         ────────────────────────
„Helfer einladen“ am Einsatz ──► Einladung (Code, gültig bis)
QR zeigen / ausdrucken                                          QR scannen (App-Scanner
                                                                oder Systemkamera → Link)
                                 ◄── Einladung einlösen ──────── Server als Profil aktiv
                                 Helfer-Kopplung „wartet“,       Seite „Anmelden“: Name,
                                 Sitzung mit enger Routenliste   Ziel wählen, optional
                                                                 „mich als Person orten“
„Wartende Helfer“ (Zähler) ◄──── live
Bestätigen (Person zuordnen) ──► Kopplung „aktiv“, ETB-Eintrag ─► Seite „Du bist angemeldet“
                                                                 Brücke: helfer_ortung_start
                                 ◄── Position (alle 30 s/25 m) ── Ortungsdienst im Hintergrund
Lagekarte: Ziel bewegt sich ◄─── Position am Ziel, live
Einsatz beenden / Widerruf ────► Sitzung ungültig ─────────────► nächste Sendung 401/403 →
                                                                 Dienst stoppt, Anzeige aus
```

1. **Einladen.** Am Einsatz unter „Geräte“ legt die Leitung eine Helfer-Einladung an. Das Recht
   ist `EinsatzLeitungszugriff`, wie beim Koppeln. Die Gültigkeit ist wählbar, Vorgabe 4 h,
   höchstens bis zum Ende des Einsatzes, technisch höchstens 72 h. Der Server erzeugt einen Code
   wie heute (Crockford-Base32, nur als Hash gespeichert), aber mehrfach einlösbar. Gezeigt
   werden QR-Code und Link, auch zum Ausdrucken. Eine Einladung lässt sich jederzeit widerrufen.
   Bereits angemeldete Kräfte betrifft der Widerruf nicht; sie entfernt die Leitung einzeln oder
   alle zusammen. Es gibt höchstens eine gültige Einladung je Einsatz, eine neue ersetzt die alte.
2. **Scannen.**
   - Der QR trägt `https://<server>/helfer#CODE`. Wie bei `/koppeln` steht der Code im Fragment
     und erreicht keine Serverlogs.
   - Der Scanner in der App erkennt die Form, legt den Server als Profil an oder wählt ihn
     aus und öffnet die Seite.
   - Scannt die Kraft mit der Systemkamera, öffnet sich der Browser. Die Seite `/helfer` erkennt,
     dass sie nicht in der App läuft, und bietet „In der App öffnen“ als
     `lifeline://helfer?server=…#CODE` an, dazu die Download-Wege.
   - Universal Links und App Links bleiben außen vor; sie wären eigene Arbeit für die Hüllen.
3. **Anmelden.**
   - Die Seite löst den Code ein (`POST /api/devices/helpers/redeem`, Wort `helpers` aus dem
     Glossar). Gefragt werden ein Anzeigename als Freitext (etwa „Max M., San-Trupp 2“) und das
     Ziel.
   - Das Ziel wählt die Kraft aus der Liste der Einheiten und Fahrzeuge des Einsatzes, Name und
     Rufname. Dazu kommt ein Häkchen „Mich als Person orten“, Vorgabe aus.
   - Der Server legt eine Helfer-Kopplung im Zustand `wartet` an, dazu ein Gerätekonto und eine
     Sitzung. Deren Routenliste erlaubt nur den eigenen Zustand, die Zielliste, Ändern des
     Ziels und Abmelden.
   - Fremde sehen in diesem Zustand nur Namen und Rufnamen von Einheiten und Fahrzeugen, keine
     Personen und keine Lage.
4. **Bestätigen.**
   - Unter „Geräte“ zeigt die Leitung „Wartende Helfer“ mit Anzeigename, gewähltem Ziel und
     Zeitpunkt. Ein Zähler ist live und kommt über das bestehende Ereignis der Geräteliste.
   - Wer die Leitung hat, bestätigt oder lehnt ab und kann das Ziel dabei korrigieren.
   - Hat die Kraft „als Person orten“ gewählt, ordnet die Leitung beim Bestätigen die Kraft aus
     `einsatz_personal` zu, mit Vorschlag nach Namensgleichheit in der gewählten Einheit, oder
     legt sie ad hoc an. Ohne Zuordnung bleibt es bei Einheit oder Fahrzeug. **Die Person ordnet
     also die Leitung zu, nicht das Gerät.** Ein frisch angemeldetes Gerät bekommt so nie
     Personennamen zu sehen.
   - Bestätigen, Ablehnen, Widerruf und Ende schreiben ins ETB wie heute der Widerruf einer
     Kopplung. Die Positionen selbst schreiben nicht ins ETB.
5. **Orten.**
   - Nach der Bestätigung ruft die Seite über die Brücke `helfer_ortung_start` auf.
   - Die Hülle fragt den Standort an, falls noch nicht geschehen: iOS „When in Use“, Android fein.
   - Dann startet der Ortungsdienst (siehe „Apps“). Er sendet mit dem Sitzungs-Cookie der
     Kopplung an `PUT /api/devices/me/position`.
   - Der Server schreibt die Position an das Ziel, also Einheit oder Fahrzeug und bei Zuordnung
     zusätzlich die Person. Dazu kommen Zeitpunkt und Quelle, und das bestehende Live-Ereignis
     der Lagekarte geht raus.
   - Ältere Zeitstempel als der gespeicherte werden ignoriert, wie beim Einwurf.
6. **Enden.**
   - Wege zum Ende: Einsatz beendet, Widerruf durch die Leitung, Ablauf der Kopplung, „Abmelden“
     in der App (`POST /api/auth/logout` wie heute) oder die Kraft entfernt den Server.
   - In jedem Fall ist die Sitzung ungültig. Die nächste Sendung bekommt 401 oder 403, und der
     Dienst stoppt sofort.
   - Läuft die Seite, beendet sie den Dienst schon beim Live-Ereignis über
     `helfer_ortung_stop`.
   - Eine Antwort, die nicht 2xx ist, nimmt der Kern nie als Grund zum Weitersenden.

### Server

- **Einladung:** neue Tabelle für die Helfer-Einladung mit Einsatz, Code-Hash, `gueltig_bis`,
  `widerrufen_at`, Ersteller und Zähler der Einlösungen. Mehrfach einlösbar, kein bedingtes
  `eingeloest_at`. Gedrosselt wie `/api/devices/pair` (`AUTH_CODE_BODY_MAX`, Rate-Limit je IP).
- **Helfer-Kopplung:**
  - Die bestehende `geraet_kopplung` wird erweitert:
    - neue Ansicht `helfer`;
    - neue Spalte für den Zustand (`wartet`/`aktiv`/`abgelehnt`; beendet bleibt
      `widerrufen_at`);
    - Verweis auf die Einladung;
    - Anzeigename;
    - Ziel: Einheit oder Fahrzeug, genau eines, dazu optional die Person.
  - Die CHECK-Regel „höchstens eine Bindung“ aus Migration 0286 bekommt für `helfer` die
    Ausnahme „Einheit oder Fahrzeug, dazu optional Person“.
  - Eine eigene Tabelle ist verworfen. Sitzungsbindung, Widerruf, ETB und Prüfung „Einsatz
    aktiv“ hängen an `geraet_kopplung`, und Stufe 2 nutzt deren Auftragswege.
- **Routenliste `helfer`:**
  - im Zustand `wartet`: eigener Zustand, Zielliste, Ziel ändern, Abmelden, die gemeinsamen
    Routen `auth/me` und `live`;
  - im Zustand `aktiv` zusätzlich `PUT /api/devices/me/position`.
  - Nichts sonst. Stufe 2 ergänzt Aufträge und Quittung.
  - Neue Fähigkeit nach `frontend/src/geraet/AGENTS.md`: erst Eintrag in der Routenliste und Test
    in `tests/geraet_kopplung.rs`, dann `geraetDarf`. `ist_verfuegbar` wird erst gesetzt, wenn
    Server, Seite und mindestens eine Hülle stehen.
- **Positionsschreiben:**
  - Dieselbe Stelle wie für LLH-2091: Position am Lageobjekt mit `position_aktualisiert_at` und
    `position_quelle` (`manuell`, `einwurf`, `helfer`). Die Lagekarte zeigt das Alter und blendet
    „veraltet“ ein.
  - Den Baustein (Spalten, Vorrang, Anzeige) legt LLH-2091 fest. Wird LLH-2092 zuerst gebaut,
    baut es ihn mit, und LLH-2091 nutzt ihn.
  - **Vorrang:** Eine manuelle Position überschreibt bis zur nächsten automatischen; die Lagekarte
    zeigt die Quelle.
- **Personenposition:** Endet die Helfer-Kopplung, löscht der Server die Position an der Person
  (`lat`/`lon` auf NULL, Quelle bleibt als Hinweis). Die Position an Einheit und Fahrzeug bleibt
  als letzter Lagestand. Eine Person ist nach dem Abmelden nicht mehr auf der Karte, ein
  Fahrzeug schon.
- **Org-Schalter:**
  - Ist die Ortung der Organisation aus (Schalter aus LLH-2091; bei Hauptamt Vorgabe aus), gibt
    es keine Helfer-Einladung (Knopf gesperrt mit Grund) und `PUT …/position` antwortet 403.
  - Personenortung braucht zusätzlich die Freigabe „Personen orten“ im selben Schalter.
  - Wie der Schalter genau heißt und wo er steht, legt LLH-2091 fest.
- **Fehlerwerte:**
  - 401 Sitzung ungültig, 403 nicht `aktiv` oder Ortung der Org aus, 404 fremder Einsatz.
  - 422 Koordinate unplausibel; als Rahmen dient die Prüfung des Einwurfs (`ablage.rs`).
  - Konvention: `src/AGENTS.md`, Statuscodes.
- **Abwärts:** Die alte einmalige Kopplung bleibt unverändert.

### Oberfläche

- **Leitung, Einsatz → Einstellungen → Geräte:**
  - neuer Bereich „Helfer“ mit „Helfer einladen“: QR, Link, Gültigkeit, Drucken, Widerrufen;
  - „Wartende Helfer“ mit Bestätigen oder Ablehnen und Zuordnung der Person;
  - „Angemeldete Helfer“ mit Ziel, letzter Position (Alter) und Entfernen;
  - „Alle Helfer abmelden“.
  - Gestaltung nach `frontend/AGENTS.md`. Ob die Seite ein Entwurf über das Design System braucht,
    entscheidet die Umsetzung nach der Regel dort.
- **Kopfzeile:** Wartende Helfer zeigt der Einsatzkopf als Hinweis, damit niemand eine Stunde
  im Wartezustand hängt. Der Zähler läuft über das Ereignis der Geräteliste.
- **Lagekarte:** Ziele mit Helferposition zeigen am Symbol Alter und Quelle, und die Liste
  „Geortet“ nennt sie. Ein Fahrzeug, dessen Position älter als 5 Minuten ist, wird blass. Die
  Werte richten sich nach LLH-2091.
- **Helfer-Seite `/helfer`** (Gerätesicht, schmal):
  - die Zustände „Anmelden“, „Wartet auf Bestätigung“, „Angemeldet“ und „Beendet“;
  - im Zustand „Angemeldet“ eine große Anzeige „Ortung an“ mit Ziel und letzter Sendung,
    „Ortung pausieren“ und „Abmelden“;
  - ohne App (im Browser): Weg zur App, keine Ortung.

### Apps (Hüllen)

Die Logik sitzt im Kern (`ios/LifelineKern`, `android/kern`), mit Tests. Die Fälle stehen
gemeinsam in `src-tauri/faelle/` und decken Helfer-QR-Form, Deeplink und Entscheidung „senden
oder stoppen“ ab.

- **Brücke:**
  - neue Befehle `helfer_ortung_start`, `helfer_ortung_stop` und `helfer_ortung_state`;
  - nur aus dem Hauptframe und nur für die Origin des aktiven Servers, wie alle Befehle;
  - `start` nimmt keine Zieladresse aus der Seite an. Die Hülle sendet immer an
    `<aktiver Server>/api/devices/me/position`.
- **Senden:**
  - Die Hülle sendet mit dem Sitzungs-Cookie aus dem Datenspeicher des Serverprofils
    (`WKWebsiteDataStore` bzw. `CookieManager` des Profils), es gibt kein eigenes Geheimnis.
  - Damit endet das Senden genau mit der Sitzung, und Widerruf, Einsatzende und Ablauf greifen
    ohne eigene Logik.
  - Unter iOS ist das die vierte native Anfrage, die `ios/AGENTS.md` ausdrücklich an eine neue
    Entscheidung bindet; die ADR unten trifft sie.
- **Takt:**
  - Gesendet wird höchstens alle 30 s und nur bei einer Bewegung über 25 m. Ohne Bewegung kommt
    alle 5 min ein Lebenszeichen, damit die Karte nicht „veraltet“ zeigt.
  - Gewünscht ist Genauigkeit „beste für Navigation“ nur bei Bewegung. Die Werte sind ein
    Vorschlag der Umsetzung (siehe „Dem Bauenden überlassen“).
- **Ohne Netz:**
  - Gepuffert wird nur die **letzte** Position, im Speicher, ohne Datei.
  - Kommt das Netz zurück, geht sie raus, wenn sie jünger als 10 Minuten ist; sonst wird sie
    verworfen.
  - Einen Verlauf auf dem Gerät gibt es nicht.
- **iOS:**
  - `UIBackgroundModes` `location`, Recht weiter nur „When in Use“, kein Always.
  - Der Dienst startet nur im Vordergrund, durch den Brückenaufruf nach der Bestätigung.
  - `allowsBackgroundLocationUpdates = true` und `showsBackgroundLocationIndicator = true`: Die
    blaue Standortanzeige ist die Sichtbarkeit.
  - Wird die App beendet, endet die Ortung. Ein Neustart nimmt sie nicht von selbst wieder auf;
    die Seite fragt nach und ruft erneut `start`.
- **Android:**
  - Vordergrund-Dienst mit `foregroundServiceType="location"` und den Rechten
    `FOREGROUND_SERVICE` und `FOREGROUND_SERVICE_LOCATION`, weiter **ohne**
    `ACCESS_BACKGROUND_LOCATION`.
  - Er startet nur aus der Vordergrund-App. Seine dauerhafte Benachrichtigung „Lifeline ortet
    dich für Einsatz …“ hat „Pausieren“ und „Abmelden“.
  - Positionen kommen vom `LocationManager` des Systems (Fused Provider nur, wenn Play-Dienste
    da sind), weil die App ohne Play verteilt wird.
- **QR und Deeplink:**
  - Der Scanner erkennt neben der Serveradresse die Form `https://<server>/helfer#CODE`.
  - Der Deeplink `lifeline://helfer?server=…` mit dem Code im Fragment legt den Server bei Bedarf
    an. Das Anlegen bestätigt die Kraft wie im heutigen Onboarding.
  - Der Code geht an die Seite, nie an die Hülle selbst.

### ADR (neu, ersetzt ADR-0093 teilweise)

Titel-Vorschlag: „Die App-Hüllen orten im Hintergrund nur für eine aktive Helfer-Kopplung und
senden dann selbst an den aktiven Server“.

- MUST: Ortung im Hintergrund nur, solange der Ortungsdienst läuft. Starten darf ihn nur
  `helfer_ortung_start` vom aktiven Server, aus dem Vordergrund.
- MUST: iOS bleibt bei „When in Use“ (`UIBackgroundModes location` erlaubt, `NSLocationAlways…`
  weiter verboten). Android nutzt einen Vordergrund-Dienst vom Typ `location`
  (`ACCESS_BACKGROUND_LOCATION` weiter verboten).
- MUST: Die Ortung ist sichtbar, unter iOS mit der Standortanzeige, unter Android mit der
  Benachrichtigung des Dienstes.
- MUST: Die Hülle sendet nur an `/api/devices/me/position` des aktiven Servers und nur mit dessen
  Sitzung. Jede Antwort außer 2xx (außer Netzfehlern) beendet den Dienst.
- MUST NOT: Verlauf speichern, mehr als die letzte Position puffern, auf die Platte schreiben.
- Die übrigen Regeln von ADR-0093 gelten weiter. Die Prüfung wird angepasst: `verbiete` für
  Always und Background-Location bleibt, `UIBackgroundModes location` wird erlaubt, und ein
  `verlange` prüft `showsBackgroundLocationIndicator`.
- Die Nummer vergibt die Umsetzung nach `docs/architektur/AGENTS.md`.

### Datenschutz

- Eine DSFA-Vorlage für Personenortung kommt unter `docs/` neben die Vorlage aus LLH-2091; liegt
  die noch nicht vor, wird eine gemeinsame angelegt. Inhalt: Zweck (Lageführung im Einsatz),
  Rechtsgrundlage (Einwilligung bei Ehrenamt, Betriebsvereinbarung bei Hauptamt), Daten (letzte
  Position, Anzeigename), Speicherdauer (bis Ende der Kopplung; an Einheit und Fahrzeug als
  Lagestand bis zur Löschung des Einsatzes), Empfänger (Leitung und Lagekarte des Einsatzes).
- **Einwilligung:** Die Seite „Anmelden“ sagt in einem Satz, was gesendet wird, an wen und bis
  wann. Erst „Anmelden und Ortung erlauben“ löst ein. Personenortung ist ein eigenes Häkchen.
- Anwenderdoku: ein Kapitel „Helfer anmelden“ nach `docs/anwender/AGENTS.md`.

### Stufe 2 (nur Anschluss, LLH-2111)

- Dieselbe Helfer-Kopplung bekommt Aufträge: Empfänger Einheit wie in der Einheitenansicht, bei
  zugeordneter Person auch `person`.
- Push bei geschlossener App braucht:
  - unter iOS die Anmeldung von Gerätekonten in `ios_push_anmeldung` und eine Öffnung der
    Empfängerauflösung für Gerätekonten;
  - unter Android einen Pushweg, den es noch nicht gibt.
  - Der laufende Vordergrund-Dienst kann unter Android eine offene Verbindung halten, solange
    geortet wird. Das ist ein möglicher Weg ohne FCM, entschieden wird er in LLH-2111.
- Nichts in Stufe 1 darf diese Wege verbauen: Gerätekonto und Sitzung bleiben je Gerät, und das
  Ziel Person ist eine echte Zuordnung zu `einsatz_personal`.

## Umsetzungsaufgaben (nach Freigabe auf dem Board, unter LLH-2092)

1. **ADR** zur Hintergrund-Ortung (löst ADR-0093 teilweise ab) samt angepasster Prüfung.
2. **Server:**
   - Einladung: anlegen, widerrufen, einlösen; Drosselung.
   - Helfer-Kopplung: Zustände, Ziel, Bestätigen, Ablehnen, ETB.
   - Routenliste `helfer`; Tests in `tests/geraet_kopplung.rs`.
3. **Server:** `PUT /api/devices/me/position` mit Schreiben ans Ziel, Quelle und Zeitstempel
   (Baustein gemeinsam mit LLH-2091), Live-Ereignis, Löschen der Personenposition am Ende und
   Org-Schalter.
4. **Frontend, Leitung:** Helfer einladen (QR, Druck), wartende und angemeldete Helfer, Hinweis
   im Einsatzkopf, Alter und Quelle auf der Lagekarte.
5. **Frontend, Helfer-Seite** `/helfer`: Anmelden, Warten, Angemeldet, Beendet, Weg zur App;
   Brückenaufrufe.
6. **iOS:** Ortungsdienst im Kern und in der App, Brückenbefehle, `UIBackgroundModes`,
   QR-Erkennung und Deeplink `lifeline://helfer`.
7. **Android:** Vordergrund-Dienst, Brückenbefehle, Rechte, QR-Erkennung und Deeplink.
8. **Doku:** DSFA-Vorlage, Anwenderkapitel „Helfer anmelden“, arc42-Mitänderung nach
   `docs/architektur/AGENTS.md`.

Reihenfolge: 1 → 2 → 3 → (4, 5 parallel) → (6, 7 parallel) → 8. Mit 2–5 ist der Weg im
Browser testbar, auch wenn dort im Hintergrund nicht geortet wird.

## Dem Bauenden überlassen

- Genaue Werte für Takt, Bewegungsschwelle, Lebenszeichen und Puffer-Alter (Vorschlag oben:
  30 s, 25 m, 5 min, 10 min) und die Schwelle für „veraltet“, abgestimmt mit LLH-2091.
- Die Vorgabe zur Gültigkeit der Einladung (4 h) und die Frage, ob sie mit dem Einsatzende
  automatisch ungültig wird (ja, über die Prüfung „Einsatz aktiv“).
- Namen von Tabellen, Spalten und Routen nach `AGENTS.md`, „Bezeichner-Sprache“, und dem
  Glossar `scripts/api-routen-woerter.tsv`.
- Ob die Liste der wartenden Helfer eine eigene Seite oder ein Abschnitt der Geräteseite ist.

## Offene Punkte für die Umsetzung

- **TestFlight extern:** Apple prüft `UIBackgroundModes location` im Beta-Review und will einen
  sichtbaren Nutzen sehen. Die Beschreibung für das Review gehört zur iOS-Aufgabe.
- **Akku:** Vor der Freigabe ein Feldtest über 4 h Sanitätsdienst mit je einem iOS- und einem
  Android-Gerät. Ein Verbrauch über 25 % gilt als zu viel und führt zu gröberen Werten.
- **Lokaler Betrieb (ELW-LAN ohne Internet):** Stufe 1 braucht kein Internet, der Server muss nur
  erreichbar sein. Stufe 2 mit APNs schon.
