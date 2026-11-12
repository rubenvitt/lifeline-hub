# Betrieb: Web Push (LLH-1223)

Mit Web Push kommen Benachrichtigungen auch dann an, wenn kein Tab der App offen ist, etwa auf dem
Handy in der Tasche. Jeder Browser stellt Push nur über den Dienst seines Herstellers zu; der
Server schickt die Meldung dorthin, der Dienst weckt den Browser. Deshalb ist der Weg **aus**, bis
der Betrieb ihn einschaltet.

## Einschalten

```bash
LIFELINE_WEB_PUSH=true
LIFELINE_WEB_PUSH_KONTAKT=mailto:betrieb@example.org   # oder https://…
```

- Der Kontakt steht in jedem Push als Ansprechpartner für den Dienst. Apple lehnt Pushes ohne
  gültigen Kontakt ab. Ohne Kontakt, mit leerem oder anderem Schema bricht der Start ab.
- Beim Start steht im Log eine Warnung „Web Push AKTIV“.
- Die App muss über HTTPS erreichbar sein; Browser bieten Push nur auf sicheren Seiten an.
- Den Schalter „Auch bei geschlossener App“ setzt jede Person selbst, je Browser (Anwenderdoku,
  Kapitel „Einsatz-Oberfläche“). Ohne `--web-push` fehlt er.

## Ausgehende Verbindungen

Der Server baut HTTPS-Verbindungen (Port 443) nur zu diesen Diensten auf:

| Browser | Host |
|---|---|
| Chrome, Edge (Android), Chromium | `fcm.googleapis.com`, `*.google.com` |
| Firefox | `*.push.services.mozilla.com` |
| Safari (macOS, iOS als installierte App) | `*.push.apple.com` |
| Edge (Windows) | `*.notify.windows.com` |

Ein Abo mit einem anderen Ziel nimmt der Server nicht an (Schutz davor, dass ein Client den Server
Anfragen ins interne Netz schicken lässt). Weiterleitungen folgt er nicht. Eine Firewall, die
ausgehenden Verkehr beschränkt, muss diese Hosts freigeben.

## Was der Push-Dienst erfährt

- **Inhalt: nichts.** Der Push trägt nur Kennungen (Benachrichtigung, Einsatz, Art, Stufe),
  verschlüsselt für den Browser (RFC 8291). Titel und Text holt das Gerät danach selbst beim
  Server, mit seiner Sitzung. Hat die Person auf dem Gerät „Mit Absender und Wortlaut“
  eingeschaltet (LLH-1369), trägt der Push dazu nur die Marke `inhalt`; Absender und Wortlaut
  einer Meldung holt das Gerät ebenso selbst.
- **Wohl aber:** wann eine Benachrichtigung an welches Abo ging, die Größe des Pushs und die
  Dringlichkeit (Alarm `high`, Hinweis `normal`). Dazu die Adresse des Servers und den Kontakt.

## Verhalten

- Jede Benachrichtigung geht an alle Abos der empfangenden Person, Alarm wie Hinweis; abgeschaltete
  Hinweis-Arten nicht. Ein Abo trägt außerdem die Arten, die auf seinem Gerät stumm sind
  (LLH-1482, nur Namen von Eingangsarten); für sie geht an dieses Abo kein Push, ein Alarm immer.
  Gekoppelte Geräte haben kein Abo.
- Der Versand läuft neben der Anfrage her: höchstens acht Pushs gleichzeitig, je 10 s Zeitlimit.
  Ein hängender Dienst verzögert nichts in der App.
- Ein Push gilt 12 Stunden; ist das Gerät so lange nicht erreichbar, verwirft der Dienst ihn.
- Meldet der Dienst ein Abo als erloschen (404, 410), löscht der Server es. Andere Fehler stehen
  gedrosselt im Log, nur mit dem Host, nie mit der Adresse des Abos.
- Ein Abo hängt an der Sitzung und fällt mit ihr: Abmelden, Ablauf, Beenden der Sitzung und der
  Passwortwechsel, der die übrigen Sitzungen beendet, löschen ihre Abos. Meldet sich dieselbe
  Person im selben Browser wieder an, meldet die App das Abo selbst neu an.

## Gekoppelter ELW: Push über den Hub (LLH-1495)

Ist eine Instanz (ELW) mit einem Hub gekoppelt, schickt der Hub die Pushs für die Einsätze des
ELW. Der ELW reicht dazu jeden Anlass einer Benachrichtigung im Abgleich an den Hub weiter; der
Hub legt eigene Benachrichtigungen an und pusht an die Abos seiner Nutzer. So muss nur der Hub ins
Internet und zu den Push-Diensten, nicht der ELW.

- Der Hub braucht dafür `LIFELINE_WEB_PUSH` und einen Kontakt wie oben. Er nennt dem ELW in
  jeder Meldung, ob er Push anbietet.
- Bietet der Hub Push an, pusht der ELW für Einsätze der gekoppelten Org nicht mehr an Konten,
  die vom Hub stammen. Für sie weicht der Schalter „Auch bei geschlossener App“ am ELW dem
  Hinweis „Push läuft über ‹Hub›“ mit einem Link zum Hub; neue Abos am ELW lehnt der Server ab.
  Bestehende Abos bleiben gespeichert und gelten wieder, sobald die Kopplung der Org widerrufen
  ist. Konten, die nur am ELW bestehen (etwa Spontanhelfer), kennt der Hub nicht: Ihnen pusht der
  ELW weiter selbst, und sie behalten den Schalter.
- Bietet der Hub keinen Push an (oder kennt er die Hinweise noch nicht, älterer Softwarestand),
  pusht der ELW wie ohne Kopplung, sofern er selbst `LIFELINE_WEB_PUSH` hat.
- Der Link zeigt die Adresse, unter der der ELW den Hub erreicht. Läuft die Kopplung über ein
  internes Netz (Overlay, VPN), ist das diese interne Adresse.
- Ein Hinweis am Hub kommt mit dem nächsten Abgleich an, ohne Verbindung später, höchstens 12
  Stunden nach dem Anlass.

## Schlüssel und Sicherung

Der Server erzeugt beim ersten Start mit `--web-push` ein Schlüsselpaar (VAPID, P-256) und legt es
in der Datenbank ab (`web_push_schluessel`); damit liegt es in jeder Sicherung. Wird eine
Sicherung auf eine andere Instanz zurückgespielt, nimmt sie den Schlüssel mit. Ändert sich der
Schlüssel doch (neue Datenbank), legen die Browser beim nächsten Einschalten oder Anmelden ein
neues Abo an; alte Abos laufen ins Leere und fallen beim ersten Versand weg.

## Ausschalten

`LIFELINE_WEB_PUSH` weglassen oder `false`. Der Server sendet dann nichts mehr, die Abo-Routen
antworten 404, und der Schalter verschwindet. Gespeicherte Abos bleiben liegen, bis ihre Sitzung
endet.
