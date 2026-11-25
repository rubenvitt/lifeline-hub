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

1. **Grundlage (geändert bei der Freigabe, 24.11.2026):** Die Helfer-App ist eine **eigene, ganz
   native App**, je eine für iOS (SwiftUI) und Android (Jetpack Compose), „sehr modern“ und im
   **Lifeline Design System**. Die vorhandenen Lifeline-Apps bleiben dünne Hüllen; ADR-0093 gilt
   dort unverändert. Der erste Stand (Helfer-Modus in den vorhandenen Apps) ist damit überholt.
2. **Anmeldung:** Ein **Einsatz-QR für viele Kräfte**, befristet und widerrufbar. Jeder Scan legt
   eine eigene Kopplung an, und die gilt erst, wenn die **Einsatzleitung sie bestätigt**.
3. **Ziel der Position:** Die Kraft wählt nach dem Scan **Einheit oder Fahrzeug** und **optional
   sich selbst als Person**. Dort landet die Position.
4. Aus LLH-1636: Empfänger in Stufe 2 sind eine Einheit oder ein Trupp, auf Wunsch eine
   Einzelperson. Der Pager arbeitet nur im laufenden Einsatz. Die Alarmierung in den Einsatz
   bleibt bei Divera und aPager.
5. **Eigenes Konto:** Die Helfer-Anmeldung läuft immer über ein Gerätekonto. Ist in einem
   Anmeldespeicher schon eine Person angemeldet, wird nicht eingelöst („erst abmelden“). Seit der
   Helfer-App mit eigenem Speicher betrifft das nur noch Aufrufe aus Browser oder Hülle; die
   Weiche `/helfer` löst dort ohnehin nicht ein.
6. **Schalter und Positionsbaustein legt dieser Entwurf fest** (Abschnitt „Ortung der
   Organisation und Positionsbaustein“). LLH-2091 nutzt sie.
7. **Ein Ortungsgerät je Ziel:** Je Einheit oder Fahrzeug sendet genau ein Gerät. Die Leitung legt
   es beim Bestätigen fest, Vorgabe ist das erste. Weitere Helfer derselben Einheit orten nur
   ihre Person oder senden nichts.

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
- Browser oder PWA als Helfer. Im Browser zeigt die Weiche `/helfer` den Weg zur App (siehe
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
| **B. Eigene native Helfer-App (gewählt)** | Je eine neue App „Lifeline Helfer“ für iOS und Android, alle Bildschirme nativ, Ortungsdienst nativ. Sie teilt Kern-Bausteine mit den Hüllen (Serveradresse, Deeplink-Prüfung) und nutzt dieselben Server-Routen. | Erfüllt „nativ und sehr modern“ und hält die Hüllen dünn. Kosten: zwei weitere Apps verteilen (TestFlight, APK) und pflegen, Push für Stufe 2 braucht eine eigene App-Kennung am Relais. |
| A. Helfer-Modus in den vorhandenen Apps | Die Hüllen bekommen einen Ortungsdienst und einen nativen Helfer-Bereich. | Bei der ersten Abstimmung gewählt, bei der Freigabe verworfen: native Bildschirme widersprechen „keine Anwendungslogik in der Hülle“, und die Hüllen würden deutlich größer. |
| C. Nur Vordergrund (Web) | Die Position kommt, solange die Seite offen ist. | Verfehlt den Kern: Bei gesperrtem Handy bleibt die Karte stehen. |

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
Leitung                          Server                         Lifeline Helfer (iOS/Android)
───────                          ──────                         ────────────────────────
„Helfer einladen“ am Einsatz ──► Einladung (Code, gültig bis)
QR zeigen / ausdrucken                                          QR scannen (App-Scanner
                                                                oder Systemkamera → Link)
                                 ◄── Einladung einlösen ──────── Server und Code übernommen
                                 Helfer-Kopplung „wartet“,       Bildschirm „Anmelden“: Name,
                                 Sitzung mit enger Routenliste   Ziel wählen, optional
                                                                 „mich als Person orten“
„Wartende Helfer“ (Zähler) ◄──── live
Bestätigen (Person zuordnen) ──► Kopplung „aktiv“, ETB-Eintrag ─► Bildschirm „Angemeldet“  
                                                                 Ortungsdienst läuft (schon ab Scan)
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
   - Der Scanner der Helfer-App erkennt die Form und übernimmt Server und Code.
   - Scannt die Kraft mit der Systemkamera, öffnet sich der Browser. Die Seite `/helfer` ist nur
     eine Weiche: „In Lifeline Helfer öffnen“ als `lifeline-helfer://anmelden?server=…#CODE`,
     dazu die Download-Wege (TestFlight, APK). Sie löst den Code nicht ein.
   - Universal Links und App Links bleiben außen vor (eigene Arbeit, später möglich).
3. **Anmelden.**
   - Die App löst den Code ein (`POST /api/devices/helpers/redeem`, Wort `helpers` aus dem
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
   - Schon beim Einlösen, also im Vordergrund, startet die App ihren Ortungsdienst. So beginnt die Ortung auch dann, wenn die Bestätigung kommt,
     während das Handy in der Tasche steckt.
   - Im Zustand `wartet` antwortet der Server auf eine Sendung mit 409 und speichert nichts. Der
     Dienst läuft weiter, und die Anzeige in der App sagt „wartet auf Bestätigung“
     (Entscheidung des Bauenden, siehe „Getroffene Festlegungen“).
   - Die App fragt den Standort an, falls noch nicht geschehen: iOS „When in Use“, Android fein.
   - Dann läuft der Ortungsdienst (siehe „Die Helfer-App“). Er sendet mit dem Sitzungs-Cookie der
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
   - Ist die App offen, beendet sie den Dienst schon beim Live-Ereignis.
   - **Stoppen** lassen den Dienst nur 401, 403 und 404 (Sitzung weg, nicht mehr berechtigt,
     Einsatz weg). Dazu kommen das Ende einer Wartezeit (`wartet` länger als 2 h) und die
     Ablehnung.
   - Bei 409 (`wartet`) läuft er weiter. Bei 5xx, 429 und Netzfehlern behält er nur die letzte
     Position und versucht es mit wachsendem Abstand erneut, höchstens jede Minute. Bei 422
     verwirft er die eine Position.
   - So legt ein Neustart des Servers nicht die Ortung aller Helfer still.

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
  - im Zustand `aktiv` zusätzlich `PUT /api/devices/me/position`, aber nicht mehr „Ziel
    ändern“. Ein neues Ziel setzt dann nur die Leitung, mit ETB-Eintrag.
  - `PUT /api/devices/me/position` steht auch im Zustand `wartet` in der Liste, antwortet dort
    aber 409 ohne zu speichern (siehe „Ablauf“, Schritt 5).
  - Nichts sonst. Stufe 2 ergänzt Aufträge und Quittung.
  - Neue Fähigkeit nach `frontend/src/geraet/AGENTS.md`: erst Eintrag in der Routenliste und Test
    in `tests/geraet_kopplung.rs`, dann `geraetDarf`. `ist_verfuegbar` wird erst gesetzt, wenn
    Server, Seite und mindestens eine Hülle stehen.
- **Positionsschreiben:** über den Baustein im Abschnitt „Ortung der Organisation und
  Positionsbaustein“.
- **Ein Ortungsgerät je Ziel** (Entscheidung 7):
  - Je Einheit und je Fahrzeug ist höchstens eine aktive Helfer-Kopplung „Ortungsgerät“; eine
    eindeutige Teilbedingung in der Datenbank sichert das.
  - Beim Bestätigen schlägt die Maske „Ortungsgerät für <Ziel>“ vor, wenn das Ziel noch keines
    hat. Hat es eines, bestätigt die Leitung den neuen Helfer nur für seine Person oder ohne
    Ortung, oder sie ersetzt das bisherige Gerät, mit ETB-Eintrag.
  - Ein Helfer ohne Ortungsrolle und ohne Person bekommt auf `PUT …/position` 403 und stoppt.
    Ihn gibt es, damit Stufe 2 ihm Aufträge zustellen kann.
  - Endet das Ortungsgerät, kann die Leitung einen anderen Helfer desselben Ziels nachrücken
    lassen.
- **Personenposition:** Endet die Helfer-Kopplung, löscht der Server die Position an der Person
  (`lat`/`lon` auf NULL, Quelle bleibt als Hinweis). Die Position an Einheit und Fahrzeug bleibt
  als letzter Lagestand. Eine Person ist nach dem Abmelden nicht mehr auf der Karte, ein
  Fahrzeug schon.
- **Org-Schalter:** siehe „Ortung der Organisation und Positionsbaustein“.
- **Eigenes Konto** (Entscheidung 5): Einlösen mit einer Personensitzung antwortet 409 mit
  Grund. Die Seite zeigt „erst abmelden“ und einen Knopf dafür.
- **Fehlerwerte:**
  - 401 Sitzung ungültig, 403 nicht `aktiv` oder Ortung der Org aus, 404 fremder Einsatz.
  - 422 Koordinate unplausibel; als Rahmen dient die Prüfung des Einwurfs (`ablage.rs`).
  - Konvention: `src/AGENTS.md`, Statuscodes.
- **Dauer:**
  - Eine Helfer-Kopplung im Zustand `wartet` läuft nach 2 h ab.
  - Eine bestätigte gilt bis zum Einsatzende, technisch höchstens 72 h ab der Bestätigung.
    Die Leitung kann sie verlängern wie heute (`…/extend`).
  - Die Gültigkeit der Einladung begrenzt nur, wie lange man sich anmelden kann, nicht, wie
    lange eine Anmeldung gilt.
  - 30 Minuten vor dem technischen Ablauf meldet der Ablauf-Takt (`src/geraet/ablauf.rs`) der
    Leitung, dass die Kopplung endet.
- **Zustandsname:** `KopplungStatus::Wartend` bedeutet heute „Code noch nicht eingelöst“. Der
  neue Zustand braucht deshalb einen eigenen Wire-Namen, Vorschlag `unbestaetigt`. Im Text
  heißt er weiter „wartet“.
- **Abwärts:** Die alte einmalige Kopplung bleibt unverändert.

### Ortung der Organisation und Positionsbaustein (für LLH-2091 mit)

- **Schalter je Organisation** in den Org-Einstellungen (Admin):
  - „Ortung im Einsatz“ mit dem Unterpunkt „Auch Personen orten“; Vorgabe für beide ist aus, für
    jede Organisation.
  - Ein Merkmal Hauptamt oder Ehrenamt gibt es nicht. Wer einschaltet, bestätigt in einem
    Dialog, dass eine Einwilligung bzw. Betriebsvereinbarung vorliegt, und der Dialog verweist auf
    die DSFA-Vorlage. Wer wann geschaltet hat, wird gespeichert.
  - Ist der Schalter aus, gibt es keine Helfer-Einladung (Knopf gesperrt mit Grund), und
    `PUT …/position` antwortet 403.
  - Ohne „Personen orten“ fehlt das Häkchen in der Helfer-App, und die Leitung kann keine
    Person zuordnen.
  - Der Schalter gilt ebenso für den Einwurf auf der Lagekarte (LLH-2091).
- **Positionsbaustein** an `einsatz_einheit`, `einsatz_fahrzeug` und `einsatz_personal`:
  - zwei neue Spalten, `position_aktualisiert_at` und `position_quelle` (`manuell`, `einwurf`,
    `helfer`);
  - eine Schreibstelle im Server für alle Quellen, die ältere Zeitstempel verwirft und das
    Live-Ereignis der Lagekarte auslöst.
  - **Vorrang:** Eine manuelle Position gilt, bis die nächste automatische kommt; die Lagekarte
    zeigt die Quelle.
  - **Anzeige:** Alter am Symbol und „veraltet“ (blass) ab 5 Minuten.
  - Der Bestand bekommt `manuell` und keinen Zeitpunkt.

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
- **Seite `/helfer`** (Weiche im Browser): erkennt den Code im Fragment, bietet „In Lifeline Helfer
  öffnen“ und die Download-Wege an. Keine Anmeldung, keine Ortung im Browser.

### Die Helfer-App (iOS und Android, nativ)

**Gestalt.** Eine App mit genau einer Aufgabe, ganz nativ, im Lifeline Design System:

- **iOS:** SwiftUI mit Observation und Swift 6 (strikte Nebenläufigkeit), gebaut mit dem
  aktuellen SDK. Auf iOS 26 nutzt sie das Systemaussehen (Liquid Glass) für Leisten und
  Bedienelemente; ab der Mindestversion der Hülle (iOS 17.4) läuft sie mit gleichem Ablauf. Die
  laufende Ortung zeigt eine **Live-Aktivität** auf Sperrbildschirm und Dynamic Island mit
  Einsatz, Ziel, letzter Sendung und „Pausieren“. Das ist sichtbar und modern zugleich.
- **Android:** Jetpack Compose mit Material 3 (Expressive, wo stabil) und Lifeline-Thema statt
  dynamischer Systemfarben. Die App läuft von Rand zu Rand und unterstützt die vorausschauende
  Zurück-Geste; `minSdk` 29 wie die Hülle. Die laufende Ortung zeigt die Benachrichtigung des
  Vordergrund-Dienstes, ab Android 16 als Live-Update.
- **Design System:** Farben, Schrift, Abstände und Radien kommen aus
  `docs/design/design-system/project/tokens.json`. Daraus wird je Plattform eine Token-Datei
  (Swift, Kotlin) erzeugt und mitcommittet. Eine Prüfung im Gate stellt sicher, dass sie zum
  JSON passt, wie beim Typ-Codegen. Hell und dunkel, große Schrift (Dynamic Type bzw.
  Schriftgröße) und VoiceOver/TalkBack gehören zur Abnahme.
- **Bildschirme:**
  1. **Start:** „QR-Code scannen“ (Kamera ganzflächig), darunter „Code eingeben“.
  2. **Anmelden:** Einsatz und Server, Anzeigename, Ziel aus der Liste (Einheiten und
     Fahrzeuge mit Rufname und taktischem Zeichen), Häkchen „Mich als Person orten“ (nur wenn die
     Org es erlaubt), Einwilligungssatz, Knopf „Anmelden und Ortung erlauben“.
  3. **Wartet:** Name des Einsatzes, „Die Einsatzleitung bestätigt dich gleich“, Ortung schon
     an (sichtbar), „Abbrechen“.
  4. **Angemeldet:** große Anzeige „Ortung an“ mit Ziel, Alter der letzten Sendung und
     Verbindungszustand, „Pausieren“/„Fortsetzen“, „Abmelden“.
  5. **Beendet:** Grund (Einsatz beendet, entfernt, abgelaufen, abgelehnt), „Neu anmelden“.
- **Je Gerät eine Anmeldung.** Die App kennt immer genau einen Server und eine Kopplung. Ein
  neuer Scan während einer Anmeldung fragt, ob die alte beendet werden soll. „Erst abmelden“
  (Entscheidung 5) betrifft damit nur die Lifeline-App im Browser oder in der Hülle. Ein Konflikt
  mit der Helfer-App entsteht nicht, weil sie ein eigenes Gerätekonto hat.

**Logik im Kern, mit Tests.** Wie bei den Hüllen steht alles, was ohne UI und System geht, in
einem Kern:

- iOS: Swift-Paket `HelferKern` (`swift test`, auch unter Linux), es nutzt `LifelineKern` für
  Adresse und Deeplink-Prüfung.
- Android: Modul `helferkern` (Kotlin/JVM, ohne SDK), es nutzt `kern`.
- Im Kern stehen: Erkennen des QR-Codes und Deeplinks, Zustandsautomat der Anmeldung (`start` →
  `anmelden` → `wartet` → `aktiv` ⇄ `pausiert` → `beendet`), die Entscheidung „senden, wiederholen
  oder stoppen“ je Antwort, Takt und Puffer (nur die letzte Position) und die Texte der Gründe.
- Die Fälle für Deeplink, QR und Antwortcodes stehen gemeinsam unter `src-tauri/faelle/` und
  gelten für beide Kerne.

**Server-Verbindung.**

- Die App spricht die Routen der Gerätekopplung direkt an: Einlösen, eigener Zustand,
  Zielliste, Ziel ändern, Position, Abmelden. Sie hält das Sitzungs-Cookie der Kopplung, unter
  iOS im Schlüsselbund, unter Android verschlüsselt im Keystore, kein weiteres Geheimnis.
- Damit endet alles mit der Sitzung, und Widerruf, Einsatzende und Ablauf greifen ohne eigene
  Logik.
- Live-Zustand (bestätigt, beendet) bekommt die App, solange sie offen ist, über `live` (SSE).
  Im Hintergrund erfährt sie ihn aus der Antwort auf die nächste Sendung.
- Prüfung des Hüllen-Vertrags (`GET /api/shell`): Die Helfer-App meldet sich mit eigener
  Kennung und Version, damit der Server zu alte Helfer-Apps ablehnen kann.

**Senden, Takt, ohne Netz.**

- **Pausieren** (in der App, unter Android auch in der Benachrichtigung, unter iOS in der
  Live-Aktivität): Der Dienst sendet einmal `PUT /api/devices/me/position` mit `paused: true`
  und ohne Koordinate und hört dann auf zu orten. Der Server löscht dann die Personenposition
  und zeigt der Leitung „pausiert“; die Position an Einheit oder Fahrzeug bleibt als letzter
  Stand. „Fortsetzen“ geht nur in der geöffneten App.
- **Takt:** Gesendet wird höchstens alle 30 s und nur bei einer Bewegung über 25 m. Ohne
  Bewegung kommt alle 5 min ein Lebenszeichen, damit die Karte nicht „veraltet“ zeigt. Die
  Genauigkeit ist hoch nur bei Bewegung. Die Werte schlägt die Umsetzung vor (siehe „Dem
  Bauenden überlassen“).
- **Ohne Netz:** Gepuffert wird nur die **letzte** Position, im Speicher, ohne Datei. Kommt das
  Netz zurück, geht sie raus, wenn sie jünger als 10 Minuten ist; sonst wird sie verworfen. Einen
  Verlauf auf dem Gerät gibt es nicht.

**Ortung im Hintergrund.**

- **iOS:**
  - `UIBackgroundModes` `location`, Recht nur „When in Use“, kein Always.
  - Der Dienst startet nur im Vordergrund, beim Anmelden.
  - Er nutzt `CLLocationUpdate.liveUpdates` mit `CLBackgroundActivitySession` (ab iOS 17) und
    zeigt die Standortanzeige des Systems.
  - Wird die App beendet, endet die Ortung. Ein Neustart nimmt sie nicht von selbst wieder auf;
    die App fragt nach.
- **Android:**
  - Vordergrund-Dienst mit `foregroundServiceType="location"` und den Rechten
    `FOREGROUND_SERVICE` und `FOREGROUND_SERVICE_LOCATION`, **ohne**
    `ACCESS_BACKGROUND_LOCATION`.
  - Er startet nur aus der Vordergrund-App. Seine dauerhafte Benachrichtigung „Lifeline ortet
    dich für Einsatz …“ hat „Pausieren“, und Tippen öffnet die App.
  - Positionen kommen vom `LocationManager` des Systems (Fused Provider nur, wenn Play-Dienste
    da sind), weil die App ohne Play verteilt wird.
- **Scanner:**
  - iOS: `DataScannerViewController` (VisionKit), Rückfall `AVCaptureMetadataOutput`.
  - Android: ML Kit gebündelt, ohne Play-Dienste, wie im Onboarding der Hülle.

**Ablage im Repo, Bauen, Verteilen.**

- **iOS:**
  - zweites App-Ziel `LifelineHelfer` im XcodeGen-Projekt `ios/project.yml` (Quellen
    `ios/Helfer/`, Paket `ios/HelferKern/`), eigene Bundle-ID und eigene TestFlight-App.
  - Gebaut wird wie die Hülle nur auf macOS; `HelferKern` testet auch unter Linux.
  - Kennungen: Bundle-ID `dev.rubeen.lifeline.helfer`, für die Live-Aktivität die
    Widget-Erweiterung `dev.rubeen.lifeline.helfer.aktivitaet`. Team `H95J852PKP` und Signierung
    wie bei der Hülle (Ruben, 24.11.2026). App-Name in App Store Connect „Lifeline Helfer“.
- **Android:**
  - Modul `:helfer` neben `:app` in `android/`, Kern `android/helferkern` per `includeBuild`.
  - Application-ID `dev.rubeen.lifeline.helfer`, signierte APK über GitHub-Releases mit dem
    vorhandenen Updater (eigener Kanal).
  - **Derselbe Signierschlüssel wie die Lifeline-App** (Ruben, 24.11.2026): Keystore und die
    vier Geheimnisse `ANDROID_KEY*` werden mitbenutzt (`android/AGENTS.md`, „Signierschlüssel
    wechselt nie“). Ein zweiter Keystore entsteht nicht.
- **Regeln:** je eine `AGENTS.md` unter `ios/Helfer/` und `android/helfer/`. Sie sagen, dass die
  Helfer-App eine native App ist, für die „keine Anwendungslogik in der Hülle“ nicht gilt, und
  dass ihre Logik im Kern steht. Die Tabelle in der Wurzel-`AGENTS.md` bekommt beide Einträge.
- **Gate:** `check-all.sh` bekommt die Kerntests der Helfer-App neben den Schritten 18 und 20,
  dazu die Token-Prüfung.

### ADR (neu)

Titel-Vorschlag: „Die Helfer-App ist eine eigene native App und ortet im Hintergrund nur für
eine aktive Helfer-Kopplung“.

- MUST: Die Helfer-App ist je Plattform eine eigene native App (SwiftUI, Compose) mit Logik im
  Kern. Die Lifeline-Hüllen bleiben unverändert dünn; ADR-0093 gilt für sie weiter.
- MUST: Ortung im Hintergrund nur, solange eine Helfer-Kopplung besteht (`wartet`, `aktiv`). Sie
  startet nur aus dem Vordergrund.
- MUST: iOS nur „When in Use“ (`UIBackgroundModes location` erlaubt, `NSLocationAlways…`
  verboten). Android nur ein Vordergrund-Dienst vom Typ `location` (`ACCESS_BACKGROUND_LOCATION`
  verboten).
- MUST: Die Ortung ist sichtbar: unter iOS mit Standortanzeige und Live-Aktivität, unter Android
  mit der Benachrichtigung des Dienstes.
- MUST: Die App sendet nur an den Server ihrer Kopplung und nur mit deren Sitzung. 401, 403 und
  404 beenden den Dienst; 5xx, 429 und Netzfehler führen zu Wiederholung mit wachsendem Abstand.
- MUST NOT: Verlauf speichern, mehr als die letzte Position puffern, Positionen auf die Platte
  schreiben.
- Prüfung mit `verbiete` und `verlange` wie in ADR-0093, für `ios/project.yml` (Ziel
  `LifelineHelfer`) und `android/helfer/src/main/AndroidManifest.xml`.
- Die Nummer vergibt die Umsetzung nach `docs/architektur/AGENTS.md`.

### Datenschutz

- Eine DSFA-Vorlage für Personenortung kommt unter `docs/` neben die Vorlage aus LLH-2091; liegt
  die noch nicht vor, wird eine gemeinsame angelegt. Inhalt: Zweck (Lageführung im Einsatz),
  Rechtsgrundlage (Einwilligung bei Ehrenamt, Betriebsvereinbarung bei Hauptamt), Daten (letzte
  Position, Anzeigename), Speicherdauer (bis Ende der Kopplung; an Einheit und Fahrzeug als
  Lagestand bis zur Löschung des Einsatzes), Empfänger (Leitung und Lagekarte des Einsatzes).
- **Einwilligung:** Der Bildschirm „Anmelden“ sagt in einem Satz, was gesendet wird, an wen und bis
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

1. **ADR** zur Helfer-App (eigene native App, Hintergrund-Ortung) samt Prüfung; `AGENTS.md` der
   beiden Helfer-Ordner und Eintrag in der Wurzeltabelle.
2. **Server:**
   - Einladung: anlegen, widerrufen, einlösen; Drosselung.
   - Helfer-Kopplung: Zustände, Ziel, Bestätigen, Ablehnen, ETB.
   - Routenliste `helfer`; Tests in `tests/geraet_kopplung.rs`.
3. **Server:** Org-Schalter „Ortung im Einsatz“ und Positionsbaustein (Quelle, Zeitpunkt,
   eine Schreibstelle; von LLH-2091 mitgenutzt), dann `PUT /api/devices/me/position` mit
   Schreiben ans Ziel, einem Ortungsgerät je Ziel, Pausieren und Löschen der Personenposition am
   Ende.
4. **Frontend, Leitung:** Helfer einladen (QR, Druck), wartende und angemeldete Helfer, Hinweis
   im Einsatzkopf, Alter und Quelle auf der Lagekarte, Org-Schalter in der Verwaltung, Weiche
   `/helfer`.
5. **Design-Tokens nativ:** Erzeugung aus `tokens.json` für Swift und Kotlin, Prüfung im Gate.
6. **iOS Helfer-App:** `HelferKern` (Zustand, Antwortentscheidung, Takt, QR/Deeplink), App-Ziel
   `LifelineHelfer` mit fünf Bildschirmen, Ortungsdienst, Live-Aktivität, Scanner.
7. **Android Helfer-App:** `helferkern`, Modul `:helfer` mit fünf Bildschirmen, Vordergrund-Dienst,
   Benachrichtigung, Scanner, Updater-Kanal.
8. **Doku:** DSFA-Vorlage, Anwenderkapitel „Helfer anmelden“, Betriebsdoku zur Verteilung
   (`docs/betrieb/`), arc42-Mitänderung nach `docs/architektur/AGENTS.md`.

Reihenfolge: 1 → 2 → 3 → (4, 5 parallel) → (6, 7 parallel) → 8. Mit 2–4 ist der Server-Teil
vollständig über die Routen testbar. Die Apps prüfen ihre Kerne unter Linux; gebaut und
ausprobiert werden die iOS-App nur auf macOS und die Android-App mit SDK.

## Getroffene Festlegungen (aus der Prüfung, vom Entwurf gesetzt, nicht vom Menschen)

- Ortung startet schon beim Einlösen, `wartet` antwortet 409 ohne Speichern.
- Nur 401, 403 und 404 stoppen den Dienst; 5xx, 429 und Netzfehler werden wiederholt.
- „Ziel ändern“ nur im Zustand `wartet`, danach nur durch die Leitung.
- Pausieren über denselben Endpunkt mit `paused: true`; in Benachrichtigung und Live-Aktivität
  gibt es kein „Abmelden“.
- Native Gestalt (nach Rubens Vorgabe „sehr modern, nativ, Design System“): Live-Aktivität unter
  iOS, Live-Update ab Android 16, Liquid Glass ab iOS 26, Tokens aus `tokens.json` erzeugt,
  Ablage als zweites App-Ziel bzw. Modul neben den Hüllen.
- Dauer: `wartet` 2 h, bestätigt bis Einsatzende bzw. höchstens 72 h, verlängerbar.
- Eigener Wire-Name für den neuen Zustand (`unbestaetigt`).

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
