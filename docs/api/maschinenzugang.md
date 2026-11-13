# Maschinenzugang: Fremdsysteme an Lifeline Hub anbinden

Stand: 12.11.2026 · LLH-1652, LLH-1638, LLH-1524 · Regeln: [ADR-0022](../architektur/entscheidungen/ADR-0022-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1.md),
Spec `maschinenzugang`, Vertrag der API: [`public-v1.json`](public-v1.json).

Ein Fremdsystem (Alarm-Adapter, Lagemonitor, Einsatzbuch, Rechner) meldet sich mit einem eigenen
Ed25519-Schlüsselpaar an. Es gibt kein Passwort und kein Token, das man stehlen und wiederverwenden
könnte: Jede Anfrage ist einzeln signiert und an Methode, Pfad und Body gebunden.

## Kurz

1. Ein System-Admin legt unter **Verwaltung › Einstellungen › Anbindungen** einen Zugang an:
   Name, Rechte (Scopes), optional „gültig bis“. Er bekommt einen Einmal-Code, 15 Minuten gültig.
2. Das Fremdsystem löst den Code ein:

   ```sh
   lifeline-hub zugang redeem https://hub.example ABCD-EFGH-JKMN-PQRS
   ```

   Das Kommando erzeugt das Schlüsselpaar, bindet es an den Zugang und legt
   `lifeline-zugang.json` ab (nur für den Besitzer lesbar, wird nie überschrieben). Es nennt den
   Fingerabdruck des Schlüssels; derselbe steht danach auf der Seite „Anbindungen“ am Zugang.

3. Erster Aufruf ist immer die Prüfroute:

   ```sh
   lifeline-hub zugang me lifeline-zugang.json
   ```

   Sie zeigt Zugang, Org, Rechte, Serverzeit und die Abweichung der eigenen Uhr.

Ohne das Binary: die Referenz-Clients unten tun dasselbe.

## Scopes

| Scope                  | Darf                                          |
| ---------------------- | --------------------------------------------- |
| `lage:read`            | Lage lesen (`GET /api/v1/lage`)               |
| `einsaetze:read`       | Einsätze lesen (`GET /api/v1/einsaetze`)      |
| `events:read`          | Ereignisse abrufen (`GET /api/v1/events`)     |
| `alarmmeldungen:write` | Alarmmeldungen als Vorschlag einliefern       |
| `positionen:write`     | Positionen einliefern                         |
| `rechner:use`          | Rechner nutzen (`/api/v1/rechner/unterkunft`) |

Lese-Scopes mit Einsatzbezug (`lage:read`, `einsaetze:read`) sehen nur den Einsatz, den die
Einsatzleitung für den Zugang freigegeben hat; siehe „Lage lesen“ und „Einsätze lesen“.
`events:read` allein öffnet nichts: Welche Ereignisse ein Zugang sieht, folgt aus seinen übrigen
Lese-Scopes. Neue Scopes kommen nur hinzu; ein Client überspringt unbekannte Werte.

## Einlösen im Einzelnen

Der Code selbst geht nie über die Leitung. Aus ihm werden drei Werte abgeleitet:

1. **Normalform:** Großbuchstaben, Leerzeichen und `-` entfernt, `O` → `0`, `I` und `L` → `1`.
   Genau 16 Zeichen aus `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
2. **HKDF-SHA256** (RFC 5869) mit Salz `lifeline-machine-client/1` über die Normalform, je 32
   Byte mit den Infos `suche` (→ `lookup`, Base64url), `einloeser` (Schlüssel `K_e`) und
   `aussteller` (Schlüssel `K_a`).
3. **Transkripte:** eine Kennung, dann je Teil seine Länge als u32 Big Endian und seine
   UTF-8-Bytes.
   - `T_e` = `machine-einloeser` ‖ `lookup` ‖ `public_key`
   - `T_a` = `machine-aussteller` ‖ `lookup` ‖ `public_key` ‖ `instanz_id` ‖
     `instanz_public_key` ‖ `zugang_id`

   `public_key` und `instanz_public_key` sind Base64url der 32 Schlüsselbytes.

4. **Prüfwerte:** HMAC-SHA256, Base64url ohne Auffüllung.

```http
POST /api/v1/zugang/redeem
Content-Type: application/json

{"lookup": "<lookup>",
 "public_key": {"kty": "OKP", "crv": "Ed25519", "x": "<public_key>"},
 "proof": "<HMAC(K_e, T_e)>"}
```

Die Antwort:

```json
{
  "zugang_id": "<UUID>",
  "instanz_id": "<UUID>",
  "instanz_public_key": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "…",
    "kid": "<instanz_id>",
    "use": "sig",
    "alg": "EdDSA"
  },
  "proof": "<HMAC(K_a, T_a)>"
}
```

Der Client prüft `proof`. Stimmt er, hat genau die Instanz geantwortet, die den Code ausgestellt
hat. Er legt `zugang_id`, `instanz_id`, seinen privaten Schlüssel und `instanz_public_key` ab.

Ein falscher Code, ein falscher Prüfwert oder ein zweites Einlösen ergeben `401`. Zehn
Fehlschläge in fünf Minuten sperren die Quelle auf den Maschinenwegen (`429`); die Anmeldung von
Menschen bleibt davon unberührt.

**Schlüssel wechseln:** Der Admin stellt am Zugang einen neuen Code aus, das Fremdsystem löst ihn
mit einem neuen Schlüssel ein. Der alte Schlüssel gilt, bis der neue zum ersten Mal eine Anfrage
signiert hat.

## Jede Anfrage signieren

```http
GET /api/v1/me
Authorization: Machine <jws>
```

`<jws>` ist ein kompaktes JWS: `B64(kopf) . B64(claims) . B64(signatur)`, Base64url ohne
Auffüllung, die Signatur Ed25519 über `B64(kopf) . B64(claims)`.

- **Kopf:** `{"alg":"EdDSA","typ":"lifeline-machine+jwt","kid":"<zugang_id>"}`
- **Claims:**

  | Claim | Wert                                                                  |
  | ----- | --------------------------------------------------------------------- |
  | `iss` | `zugang_id`                                                           |
  | `aud` | `instanz_id`                                                          |
  | `iat` | jetzt, Unix-Sekunden                                                  |
  | `exp` | höchstens `iat + 60`                                                  |
  | `jti` | Zufall, je Anfrage neu (16 Bytes, Base64url)                          |
  | `htm` | Methode in Großbuchstaben                                             |
  | `htu` | Pfad samt Abfrage, genau wie gesendet (`/api/v1/events?after=4711`)   |
  | `bh`  | SHA-256 des Bodys, Base64url (leerer Body: Hash der leeren Bytefolge) |

Der Server verlangt keine Reihenfolge der Felder. Die Testvektoren nutzen die Reihenfolge der
Tabelle; nur dann ist das JWS bytegleich.

Die Uhren dürfen um 5 Minuten abweichen. Dasselbe JWS gilt genau einmal. Je Zugang gehen 60
Anfragen je Minute; darüber kommt `429` mit `Retry-After`. Eine gedrosselte Anfrage verbraucht
ihre `jti` nicht und darf nach der Wartezeit mit demselben JWS wiederholt werden, solange es lebt.

## Antworten prüfen

Jede erfolgreiche Antwort einer angemeldeten Anfrage trägt den Kopf `Lifeline-Signature`: ein JWS
mit `typ` `lifeline-machine-response+jwt`, `kid` = `instanz_id` und den Claims `iss`
(`instanz_id`), `aud` (`zugang_id`), `iat`, `exp`, `jti`, `req` (die `jti` der Anfrage),
`status` und `bh` (SHA-256 des Antwort-Bodys, wie empfangen). Geprüft wird gegen
`instanz_public_key` aus dem Einlösen; `GET /api/v1/instanz/jwks.json` dient nur dem Wechsel des
Instanzschlüssels. Die Prüfung ist freiwillig, aber empfohlen.

## Lage lesen

`GET /api/v1/lage` mit dem Scope `lage:read` liefert das Lagebild genau eines Einsatzes: Kopf,
Zahlen zu Betroffenen und Kräften, Belegung der Unfallhilfsstellen, offene Sofortmeldungen als
Zahl, die Lagemeldung und die Lagekarte. Namen, Personenkennungen und freie Notizen kommen nicht
vor. Gedacht ist die Route für Anzeigen wie den Lagemonitor im Führungskraftwagen.

**Freigabe.** Welchen Einsatz ein Zugang liest, entscheidet die Einsatzleitung: im Einsatz unter
„Einstellungen“, „Geräte“ im Paneel „Anbindungen“. Ein Zugang liest höchstens einen Einsatz.
Schaltet die Einsatzleitung ihn an einem zweiten Einsatz ein, liest er ab dann diesen. Die
Freigabe endet mit dem Abschluss des Einsatzes, dem Widerruf oder Ablauf des Zugangs und dem
Entzug von `lage:read`.

**Ohne Freigabe** ist die Antwort kein Fehler:

```json
{ "stand_at": "2026-11-12 19:02:11", "einsatz": null }
```

**Mit Freigabe** (gekürzt):

```json
{
  "stand_at": "2026-11-12 19:02:11",
  "einsatz": {
    "id": 42,
    "bezeichnung": "Stadtfest",
    "stichwort": "San 2",
    "einsatzart": "sanitaetsdienst",
    "begonnen_at": "2026-11-12 16:00:00",
    "betroffene": {
      "gesamt": 4, "patienten": 3, "sk1": 1, "sk2": 1, "sk3": 1, "sk4": 0,
      "tot": 0, "unverletzt": 0, "ohne": 0, "vermisst": 1, "abgeschlossen": 0
    },
    "kraefte": {
      "einheiten": 2, "personal": 8,
      "staerke": { "fuehrer": 0, "unterfuehrer": 2, "mannschaft": 6 }
    },
    "uhs": [
      {
        "id": 5, "bezeichnung": "BHP Nord", "kind": "behandlungsplatz", "state": "aktiv",
        "belegt": 3, "plaetze": 10, "kraefte": 4
      }
    ],
    "sofortmeldungen_offen": 0,
    "lagemeldung": { "text": "Lage stabil.", "freigegeben_at": "2026-11-12 18:30:00" }
  },
  "karte": { "type": "FeatureCollection", "features": [] },
  "karte_etag": "3f1c0a9d2b7e4c55"
}
```

- `stand_at` ist der Zeitpunkt der Berechnung. `lagemeldung` ist die Zusammenfassung des jüngsten
  freigegebenen Lageberichts, ohne einen solchen `null`.
- `einsatz.sanitaetsdienst` (`kontakte`, `kontakte_letzte_stunde`, `in_versorgung`, `transporte`)
  kommt nur, wenn am Einsatz die Reihe „Sanitätsdienst“ gewählt ist.
- `einsatz.spiegel` (`letzter_abgleich_at`, `abgleich_beendet`) kommt nur, wenn die Instanz den
  Einsatz als Spiegel einer anderen hält, etwa der Hub einen Einsatz, den ein ELW führt. Die
  Zahlen sind dann so alt wie der letzte Abgleich; eine Anzeige sollte das kennzeichnen.

**Karte.** `karte` ist eine GeoJSON-FeatureCollection in WGS 84. `properties.kind` nennt die Art
jedes Features; unbekannte Arten überspringt ein Client.

| `kind`       | Weitere Eigenschaften                                                                      |
| ------------ | ------------------------------------------------------------------------------------------ |
| `einsatzort` | keine; ein Punkt                                                                           |
| `zone`       | `id`, `subkind`: `gefahrengebiet`, `absperrbereich`, `absperrgrenze` oder `sperrgebiet`    |
| `abschnitt`  | `id`, `bezeichnung`, optional `kurzbezeichnung`                                            |
| `uhs`        | `id` (wie in `einsatz.uhs`), `bezeichnung`, `subkind` (wie `uhs[].kind`), `belegt`, `plaetze` |
| `zeichen`    | `id`, `zeichen_spec`: die Zeichenbeschreibung als JSON-Text, ohne Beschriftung             |

Die Karte ändert sich selten und ist der größte Teil der Antwort. `karte_etag` nennt ihre
Fassung:

- `GET /api/v1/lage?karte=<karte_etag>`: Gleicht die genannte Fassung der aktuellen, fehlt
  `karte`, und `karte_etag` bleibt. Sonst kommt die neue Karte mit neuer Fassung.
- `GET /api/v1/lage?karte=none`: weder `karte` noch `karte_etag`.

Die Abfrage gehört zum signierten Pfad (`htu` ist `/api/v1/lage?karte=…`).

**Prüfen am Terminal.** Ob Anbindung und Freigabe stehen, zeigt

```sh
lifeline-hub zugang lage lifeline-zugang.json
```

Die Ausgabe ist die Antwort ohne Karte; `--karte` gibt sie mit aus. Steht dort `"einsatz": null`,
ist für den Zugang kein Einsatz freigegeben. Aus Rust:
`lifeline_machine_client::lage(&client, &cred, karte, now)` mit `karte` `None`, `Some("none")`
oder `Some(<karte_etag>)`.

## Einsätze lesen

Mit dem Scope `einsaetze:read` liest ein Fremdsystem den Kopf des Einsatzes, den die
Einsatzleitung für seinen Zugang freigegeben hat (Freigabe wie bei „Lage lesen“). Gedacht ist das
für ein Einsatzbuch, das Stichwort, Ort und Nummern führt.

`GET /api/v1/einsaetze` liefert die Liste und einen Cursor für die Ereignisse:

```json
{
  "cursor": 4711,
  "einsaetze": [
    {
      "id": 42,
      "einsatznummer": "2026-0042",
      "bezeichnung": "Hochwasser Süd",
      "stichwort": "B3",
      "einsatzart": "realeinsatz",
      "leitstellen_nr": "L-2026-118833",
      "einsatzort": "Marktplatz 1",
      "koordinate": { "lat": 52.1, "lon": 9.3 },
      "begonnen_at": "2026-11-12 16:00:00"
    }
  ]
}
```

- Ohne Freigabe ist die Liste leer; das ist kein Fehler. Heute steht höchstens ein Einsatz darin,
  weil ein Zugang höchstens einen liest. Die Form bleibt eine Liste.
- `stichwort`, `einsatznummer`, `leitstellen_nr`, `einsatzort` und `koordinate` fehlen, wenn sie
  leer sind. `koordinate` ist WGS 84.
- Sachverhalt, meldende Stelle, Zahl der Betroffenen, Personen und Mitglieder kommen nicht vor.
- `GET /api/v1/einsaetze/{id}` liefert denselben Einsatz einzeln. Für jeden anderen Einsatz kommt
  `404 not_found`, gleich ob er nicht freigegeben, abgeschlossen, fremd oder unbekannt ist.

## Ereignisse abrufen

Mit dem Scope `events:read` erfährt ein Fremdsystem, dass sich an seinem freigegebenen Einsatz
etwas getan hat. Ein Ereignis sagt nur, **was** sich geändert hat; den Inhalt liest der Client
danach über `GET /api/v1/einsaetze` oder `GET /api/v1/lage`.

```http
GET /api/v1/events?after=4711&wait=25
```

```json
{
  "cursor": 4714,
  "events": [
    { "id": 4712, "type": "einsatz.updated", "occurred_at": "2026-11-12 19:04:00", "einsatz_id": 42 },
    { "id": 4714, "type": "lage.changed", "occurred_at": "2026-11-12 19:05:30", "einsatz_id": 42 }
  ]
}
```

| `type`            | Bedeutung                                                      | Sichtbar mit     |
| ----------------- | -------------------------------------------------------------- | ---------------- |
| `einsatz.created` | Der Einsatz ist für den Zugang lesbar geworden (freigegeben).  | `einsaetze:read` |
| `einsatz.updated` | Ein Feld des Einsatzes aus „Einsätze lesen“ hat sich geändert. | `einsaetze:read` |
| `einsatz.closed`  | Der Einsatz ist für den Zugang nicht mehr lesbar.              | `einsaetze:read` |
| `lage.changed`    | Die Lage des Einsatzes kann sich geändert haben.               | `lage:read`      |

`einsatz.closed` kommt beim Abschluss des Einsatzes, wenn die Einsatzleitung die Freigabe
zurücknimmt oder den Zugang auf einen anderen Einsatz umstellt, und wenn dem Zugang das Recht
genommen wird. Danach antworten die Leserouten für diesen Einsatz mit `404` bzw. ohne ihn.

**Die Schleife:**

1. Beim ersten Start `GET /api/v1/einsaetze` lesen und den `cursor` merken.
2. `GET /api/v1/events?after=<cursor>&wait=25` aufrufen. Der Abruf bleibt höchstens 25 Sekunden
   offen und antwortet, sobald ein Ereignis vorliegt (binnen etwa einer Sekunde).
3. Die Ereignisse verarbeiten, den neuen `cursor` merken, weiter bei 2. Auch eine leere Antwort
   nennt einen neuen `cursor`; ihn merken, sonst altert der eigene.
4. Bei `410 cursor_expired` wieder bei 1 beginnen.

**Zu beachten:**

- **Reihenfolge und Lücken:** `id` steigt in der Reihenfolge der Änderungen. Zwischen zwei eigenen
  Ereignissen können Nummern fehlen; sie gehören anderen Zugängen oder wurden ersetzt.
- **`lage.changed` ist verdichtet:** Je Einsatz liegt höchstens eines vor; ein neues ersetzt das
  alte und trägt eine höhere `id`. In einem lebhaften Einsatz kommt es oft. Die Lage danach
  höchstens alle paar Sekunden neu lesen, sonst läuft der Zugang in seine Drosselung (60 je
  Minute, `429` mit `Retry-After`). Das Ereignis meldet eher zu oft als zu selten; eine Änderung
  an Stammdaten, die in die Stärke einfließt, meldet es nicht.
- **Seiten:** Eine Antwort trägt höchstens 500 Ereignisse. Bei einer vollen Seite gleich weiter
  abrufen.
- **Warteplätze:** Es warten höchstens 32 Abrufe zugleich, je Zugang einer. Ein Abruf darüber
  antwortet sofort mit `200`, leerer Liste und `Retry-After: 10`: so viele Sekunden bis zum
  nächsten Abruf warten.
- **Aufbewahrung:** Ereignisse leben sieben Tage. Ein älterer Cursor ergibt `410 cursor_expired`,
  ebenso ein Cursor, den der Server nicht kennt (etwa nach dem Zurückspielen einer Sicherung).
- **Sicherung:** Nach dem Zurückspielen einer Sicherung kann ein gemerkter Cursor wieder gültig
  aussehen, obwohl der Stand am Server ein anderer ist. `GET /api/v1/einsaetze` deshalb regelmäßig
  neu lesen, etwa stündlich.
- **Unbekannte Arten** überspringen; neue kommen nur hinzu.
- **Abfragewerte:** `after` ist eine ganze Zahl ab 0, `wait` eine von 0 bis 25. Anderes ergibt
  `400 invalid_field`. Die Abfrage gehört zum signierten Pfad (`htu`).

In Python, mit [`clients/python/machine_client.py`](clients/python/machine_client.py) daneben:

```python
import json, os, time, urllib.error, urllib.request
from machine_client import b64, sign_request, verify_response


def get(cred, path):
    jti, now = b64(os.urandom(16)), int(time.time())
    auth = sign_request(cred, "GET", path, b"", now, jti)
    req = urllib.request.Request(cred["base_url"] + path, headers={"Authorization": auth})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read()
        verify_response(cred, r.headers["Lifeline-Signature"], jti, r.status, body, now)
        return json.loads(body), r.headers.get("Retry-After")


cred = json.load(open("lifeline-zugang.json", encoding="utf-8"))
cursor = get(cred, "/api/v1/einsaetze")[0]["cursor"]
while True:
    try:
        antwort, warten = get(cred, f"/api/v1/events?after={cursor}&wait=25")
    except urllib.error.HTTPError as e:
        if e.code != 410:
            raise
        cursor = get(cred, "/api/v1/einsaetze")[0]["cursor"]  # cursor_expired: neu aufbauen
        continue
    cursor = antwort["cursor"]
    for ereignis in antwort["events"]:
        print(ereignis["id"], ereignis["type"], ereignis["einsatz_id"], flush=True)
    if warten:
        time.sleep(int(warten))
```

## Fehler

Fehler sind `{"error": "<Text>", "code": "<code>"}`. Vertrag ist `code`
([`public-v1.json`](public-v1.json), Beschreibung). Für die Anmeldung zählen:

| Status | `code`          | Bedeutung                                              |
| ------ | --------------- | ------------------------------------------------------ |
| 401    | `unauthorized`  | Anmeldung gescheitert. Den Grund sieht nur der Admin.  |
| 403    | `missing_scope` | Angemeldet, aber dem Zugang fehlt das Recht der Route. |
| 429    | `rate_limited`  | Gedrosselt; `Retry-After` nennt die Sekunden.          |

Ein `401` nennt bewusst keinen Grund. Der Admin sieht ihn auf der Seite „Anbindungen“ am Zugang,
etwa „Uhr geht 7 min nach“, „Body passt nicht zur Signatur (bh)“ oder „Anfrage für eine andere
Instanz (aud)“. Bei `5xx`, `429` und Zeitüberschreitung mit Backoff und neuer `jti` wiederholen,
bei anderen `4xx` nicht.

## Rechner Unterkunft und Zelte

Mit dem Scope `rechner:use` rechnet ein Fremdsystem eine Unterkunft durch, mit denselben Regeln
wie der Rechner der Oberfläche (LLH-1524, Spec `rechner-api-unterkunft`). Die Rechnung speichert
nichts.

`POST /api/v1/rechner/unterkunft` nimmt `weg` (`personen`, `raeume`, `flaeche` oder `zelte`),
`trennung` (Männer und Frauen getrennt) und genau den Block des Wegs:

```json
{
  "weg": "raeume",
  "trennung": false,
  "raeume": [
    {
      "bezeichnung": "Halle",
      "laenge_m": 15,
      "breite_m": 13.5,
      "abzuege": [{ "laenge_m": 4, "breite_m": 2.5 }]
    },
    {
      "bezeichnung": "Gymnastikraum",
      "laenge_m": 12,
      "breite_m": 8,
      "abzuege": [{ "laenge_m": 3, "breite_m": 2 }]
    }
  ]
}
```

Die Antwort trägt `ergebnis` (hier 48 und 22 Plätze je Raum, 70 gesamt, dazu Material, Sanitär,
Gesundheit, Versorgung und Verpflegung für 70 Personen), `richtwerte` (jeder Richtwert mit
wirksamem Wert und Herkunft) und `stand` (Stand der Vorgaben). Weitere Beispiele für jeden Weg
stehen als `eingabe` und `erwartet` in
[`tests/fixtures/unterkunft/faelle.json`](../../tests/fixtures/unterkunft/faelle.json); jede
`eingabe` dort ist eine gültige Anfrage. Trägt ein Fall `richtwerte`, gehören sie als Feld
`richtwerte` in die Anfrage, sonst kommt nicht `erwartet` heraus. `erwartet` gilt, solange die
Organisation keine eigenen Werte gesetzt hat.

**Richtwerte.** Wirksam ist je Schlüssel:

1. der Wert aus `richtwerte` der Anfrage (Herkunft `anfrage`), etwa
   `"richtwerte": { "wasser_je_person_l": 15 }`,
2. sonst der Wert, den die Organisation des Zugangs in ihren Stammdaten gesetzt hat (`org`),
3. sonst die Vorgabe des Programms (`basis`).

Schlüssel, Bezeichnung, Einheit und Grenzen jedes Richtwerts und die Zelttypen nennt
`GET /api/v1/rechner/unterkunft/richtwerte`. Werte, die ein Einsatz für sich gesetzt hat, gehören
nicht dazu: Ein Feld `einsatz_id` gibt es noch nicht, es wird als unbekanntes Feld abgelehnt.

**Prüfung.** Anders als die Maske der Oberfläche rechnet die API nie still mit 0. Zusammen passen
die Felder, wenn

- genau der Block des Wegs da ist;
- ohne Trennung `gesamt` steht (bei Personen und Fläche gehen stattdessen `maenner` und `frauen`
  zusammen, dann zählt die Summe; Zelte brauchen `gesamt`);
- mit Trennung `maenner` und `frauen` stehen, beide und ohne `gesamt`; eine leere Gruppe ist
  ausdrücklich `0`, bei Zelten `{}`;
- ein Raum genau dann eine `belegung` trägt, wenn getrennt wird.

| Status | `code`          | Wann                                                                                            |
| ------ | --------------- | ----------------------------------------------------------------------------------------------- |
| 400    | `invalid_field` | Ein Feld für sich: unbekanntes Feld, unbekannter Richtwert, Zahl außerhalb der Grenzen.         |
| 422    | `unprocessable` | Die Felder passen nicht zusammen, etwa ein Block eines anderen Wegs oder `gesamt` bei Trennung. |

Der Text nennt das Feld, etwa `raeume[1].laenge_m`, auch bei einem falschen Typ. Ein doppelter
Schlüssel und eine Liste an Stelle eines Objekts sind 400.

Grenzen: höchstens 200 Räume mit je höchstens 5 Abzügen, Maße über 0 und höchstens 1000 m, Flächen
höchstens 1 000 000 m², Personen je Angabe höchstens 1 000 000, Zelte je Typ höchstens 1000,
Bezeichnung eines Raums höchstens 80 Zeichen. Daneben gilt wie überall die Body-Grenze von 64 KiB
(`413 payload_too_large`): 200 Räume mit je 5 Abzügen passen hinein, wenn die Bezeichnungen kurz
bleiben, die Maße höchstens zwei Nachkommastellen tragen und das JSON ohne Einrückung geschrieben
ist. Eine leere Raumliste ist gültig und ergibt 0 Plätze.

## Referenz-Clients

- **Rust:** Crate [`crates/lifeline-machine-client`](../../crates/lifeline-machine-client),
  Feature `http` für Einlösen, `me` und `lage`. Das Kommando `lifeline-hub zugang` nutzt sie.
- **TypeScript:** [`clients/typescript/machineClient.ts`](clients/typescript/machineClient.ts),
  nur WebCrypto, für Node ab 22 (die API erlaubt kein CORS, also keine Browser-Clients fremder
  Seiten).
- **Python:** [`clients/python/machine_client.py`](clients/python/machine_client.py), braucht
  `cryptography`. `redeem URL CODE`, `me DATEI`, `--selftest`.

## Testvektoren

[`machine-auth-testvektoren.json`](machine-auth-testvektoren.json): fester Code, feste Schlüssel,
feste Zeit und `jti`. Ed25519 ist deterministisch; wer die Vektoren trifft, signiert wie der Server
erwartet. Server, Rust-, TypeScript- und Python-Client werden im Sammel-Gate gegen diese Datei
geprüft. Neu geschrieben wird sie mit

```sh
LIFELINE_TESTVEKTOREN_SCHREIBEN=1 cargo test -p lifeline-machine-client
```

## Betrieb

- Am Hub öffentlich hinter TLS; am ELW, der sich bei einem Hub meldet, nimmt die Instanz keine
  Fremdsysteme an. Anbindungen gehören dann an den Hub.
- Signierte Anfragen verraten ohne TLS kein wiederverwendbares Geheimnis, wohl aber ihren Inhalt:
  TLS, wo es geht.
- Drosselung und Sperre liegen im Prozessspeicher; ein Neustart setzt sie zurück.
