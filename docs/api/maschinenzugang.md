# Maschinenzugang: Fremdsysteme an Lifeline Hub anbinden

Stand: 12.11.2026 · LLH-1652, LLH-1524 · Regeln: [ADR-0022](../architektur/entscheidungen/ADR-0022-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1.md),
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
| `einsaetze:read`       | Einsätze lesen                                |
| `events:read`          | Ereignisse abrufen (`GET /api/v1/events`)     |
| `alarmmeldungen:write` | Alarmmeldungen als Vorschlag einliefern       |
| `positionen:write`     | Positionen einliefern                         |
| `rechner:use`          | Rechner nutzen (`/api/v1/rechner/unterkunft`) |

Lese-Scopes mit Einsatzbezug sehen nur Einsätze, die die Einsatzleitung für den Zugang freigegeben
hat. Neue Scopes kommen nur hinzu; ein Client überspringt unbekannte Werte.

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
  Feature `http` für Einlösen und `me`. Das Kommando `lifeline-hub zugang` nutzt sie.
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

## Absender ohne Signatur

Ein Absender, der nur eine URL aufrufen kann (BOSWatch, FE2 mit „URL öffnen“, Divera-Webhook,
OsmAnd), nimmt statt des Maschinenzugangs einen Einwurf-Zugang: [`einwurf.md`](einwurf.md).

## Betrieb

- Am Hub öffentlich hinter TLS; am ELW, der sich bei einem Hub meldet, nimmt die Instanz keine
  Fremdsysteme an. Anbindungen gehören dann an den Hub.
- Signierte Anfragen verraten ohne TLS kein wiederverwendbares Geheimnis, wohl aber ihren Inhalt:
  TLS, wo es geht.
- Drosselung und Sperre liegen im Prozessspeicher; ein Neustart setzt sie zurück.
