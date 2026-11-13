# Einwurf: einliefern ohne Signatur

Ein Einwurf-Zugang ist für Absender gedacht, die nur eine URL aufrufen können: BOSWatch 3 (GET
mit Platzhaltern), FE2 mit „URL öffnen“, der Divera-Webhook, OsmAnd und der Traccar-Client. Wer
signieren kann, nimmt den [Maschinenzugang](maschinenzugang.md). Der Vertrag steht im
OpenAPI-Dokument (`docs/api/public-v1.json`, `GET /api/v1/openapi.json`); Entscheidung:
[ADR-0023](../architektur/entscheidungen/ADR-0023-absender-ohne-signatur-werfen-ueber-einen-einwurf-zugang-ein.md).

Code: `src/public_api/einwurf/` (Schlüssel, Routen, Ablage), Verwaltung
`src/routes/einwurf_zugaenge.rs`, Tests `tests/einwurf.rs`.

## Zugang und Adresse

Ein System-Admin legt den Zugang auf der Seite „Anbindungen“ an und wählt den Zweck. Die Seite
zeigt die Adresse mit dem Schlüssel genau einmal:

```text
https://hub.example/api/v1/einwurf/llh_ew_Q2x…/alarmmeldung
https://hub.example/api/v1/einwurf/llh_ew_Q2x…/position
```

- Der Schlüssel besteht aus `llh_ew_` und 43 Zeichen (32 Zufallsbytes, base64url). Der Server
  speichert nur seinen SHA-256.
- Ein Zugang hat genau einen Zweck. An der Route des anderen Zwecks antwortet er mit
  `403 missing_scope`.
- „Schlüssel wechseln“ gibt eine neue Adresse aus; die alte gilt im selben Augenblick nicht mehr.
  Ein Widerruf wirkt ebenfalls sofort. Ein abgelaufener Zugang bekommt keinen neuen Schlüssel.
- Nur GET und POST. Jede andere Methode, auch HEAD, ergibt `405` und legt nichts ab; die Antwort
  auf HEAD nennt `Allow: GET, POST`.

## Nur über TLS

Der Server nimmt einen Einwurf nur an, wenn er verschlüsselt ankam, sonst `403 tls_required`:

- direkt mit `--tls`, oder
- über einen Reverse-Proxy aus `--trusted-proxies`, der `X-Forwarded-Proto: https` setzt. Jeder
  Wert des Kopfes muss `https` lauten.

Für ein Netz, das selbst verschlüsselt (Tailnet, WireGuard), gibt es den Schalter
`--einwurf-allow-http`. Einzelheiten: [`docs/betrieb-tls.md`](../betrieb-tls.md).

Bei GET stehen Schlüssel und Inhalt in der URL. Wer POST kann, nimmt POST. Der Reverse-Proxy darf
unter `/api/v1/einwurf/` weder Pfad noch Abfrage protokollieren.

## Alarmmeldung

Der Server legt ab, was ankommt, und deutet es nicht: Abfrage und Body unverändert. Er verlangt
nur, dass eines von beiden Inhalt trägt (`?&` allein ist leer). Die Deutung (Stichwort, Ort,
Einsatzmittel) macht später ein Adapter.

Die Abfrage liegt als dekodierte Paare in der Ablage. Kam sie nicht in UTF-8 an (etwa `%F6` für
„ö“ aus einem Latin-1-Absender), liegt sie zusätzlich so dabei, wie sie ankam, damit nichts
verloren geht.

```sh
# BOSWatch: nur GET, Platzhalter in der Abfrage
curl -i 'https://hub.example/api/v1/einwurf/llh_ew_Q2x…/alarmmeldung?ric=1234567&subric=a&text=B2%20Wohnung'

# POST mit JSON
curl -i -X POST 'https://hub.example/api/v1/einwurf/llh_ew_Q2x…/alarmmeldung' \
  -H 'Content-Type: application/json' \
  -d '{"external_id": "LS-2026-118833", "message_id": "1", "stichwort": "RD 2"}'
```

Der Body darf JSON, ein Formular (`application/x-www-form-urlencoded`), Text oder XML sein und
muss UTF-8 sein.

### Kennungen und doppelte Einwürfe

Der Server erkennt zwei Kennungen: in der Abfrage, in Formularfeldern oder auf oberster Ebene
eines JSON-Objekts. Der Body geht der Abfrage vor.

| Meldung trägt | Wiederholung, wenn derselbe Zugang schon hat | Zeitgrenze |
| --- | --- | --- |
| `message_id` | dieselbe `external_id` und `message_id` | keine |
| nur `external_id` | dieselbe `external_id` und denselben Inhalt | keine |
| keine Kennung | denselben Inhalt, letzter Empfang höchstens 2 Minuten her | 2 Minuten |

- `external_id` ist die Kennung des Alarms beim Absender, `message_id` die der einzelnen
  Meldung. Sie bleibt bei einer Wiederholung gleich; ein Nachtrag bekommt eine neue.
- Eine Wiederholung legt keinen zweiten Eintrag an. Sie wird am bestehenden mit Zahl und Zeit
  vermerkt; still verworfen wird nichts.
- Ohne Kennung zählt der Inhalt Byte für Byte. Die zwei Minuten laufen ab dem letzten Empfang.
  Kommt derselbe Inhalt später, entsteht ein neuer Eintrag mit Verweis auf den früheren.
- Ein Absender ohne Kennung wiederholt deshalb höchstens zwei Minuten lang.
- Eine `message_id` muss je Meldung eindeutig bleiben, solange der Eintrag lebt (7 Tage). Zählt
  ein Absender sie nach einem Neustart wieder von 1 hoch, gilt eine neue Meldung als
  Wiederholung der alten: Sie wird gezählt, ihr Inhalt aber nicht abgelegt. Eine `external_id` je
  Alarm verhindert das.

Abgelegte Alarmmeldungen werden sieben Tage nach dem ersten Empfang gelöscht.

## Position

Das OsmAnd-Protokoll, das auch der Traccar-Client spricht:

```sh
curl -i 'https://hub.example/api/v1/einwurf/llh_ew_Q2x…/position?id=elw1&lat=52.1&lon=9.3&timestamp=1794475200'
```

| Feld | Bedeutung |
| --- | --- |
| `id` (auch `deviceid`) | Kennung des Absenders, höchstens 128 Zeichen |
| `lat`, `lon` | Grad (WGS 84), −90 bis 90 und −180 bis 180 |
| `timestamp` | optional: Unix-Sekunden, Unix-Millisekunden oder RFC 3339; ohne ihn gilt der Empfang |

- Die Felder stehen in der Abfrage, in einem Formular-Body oder in einem flachen JSON-Objekt.
- Je Zugang und `id` hält der Server genau eine Position. Eine neue ersetzt sie, ohne Verlauf.
- Eine Position mit älterem Zeitstempel als die gespeicherte wird nicht übernommen; die Antwort
  ist trotzdem `204`. Springt die Uhr eines Absenders zurück (etwa auf ein Werksdatum), bleibt
  die gespeicherte Position deshalb stehen, bis sie nach 24 Stunden verfällt. Ein Absender ohne
  verlässliche Uhr lässt `timestamp` besser weg.
- Die Kennung muss gültiges UTF-8 sein, sonst `400`.
- Ein Zeitstempel, der mehr als 5 Minuten in der Zukunft liegt, ist `422`.
- Weitere Felder (`speed`, `bearing`, `altitude`, `accuracy`, `batt` …) werden mit der Position
  abgelegt und mit ihr ersetzt.
- Eine Position wird 24 Stunden nach ihrem Empfang gelöscht, wenn keine neuere kam.

Die Ablage zeigt noch nichts auf der Lagekarte: Die Zuordnung einer Kennung zu einem Fahrzeug
folgt mit der Ortung (Zunder LLH-1199).

## Antworten

Jede Antwort trägt `Cache-Control: no-store`. An einer Antwort sind eine neue Meldung und eine
Wiederholung nicht zu unterscheiden.

| Status | `code` | Bedeutung |
| --- | --- | --- |
| 204 | – | angenommen, kein Body |
| 405 | `method_not_allowed` | andere Methode als GET oder POST, auch HEAD |
| 400 | `invalid_field` | Kennung zu lang, Body kein UTF-8, Koordinate oder Zeitstempel unlesbar |
| 401 | `unauthorized` | Schlüssel unbekannt, widerrufen oder abgelaufen |
| 403 | `tls_required` | nicht über TLS angekommen |
| 403 | `missing_scope` | der Zugang hat den anderen Zweck |
| 413 | `payload_too_large` | Body über 16 KiB, Abfrage über 8 KiB oder abgelegte Rohdaten über 48 KiB |
| 422 | `unprocessable` | leerer Einwurf, Zeitstempel in der Zukunft, zu viele Kennungen |
| 429 | `rate_limited` | gedrosselt; `Retry-After` nennt die Wartezeit in Sekunden |

## Grenzen

- 30 Einwürfe am Stück je Zugang, einer je zwei Sekunden nach. Wird ein Zugang gedrosselt,
  schreibt der Server eine Warnzeile mit der Kennung des Zugangs (je Zugang höchstens eine je
  Minute). Dasselbe gilt an der Tagesgrenze.
- Höchstens 5 000 neue Alarmmeldungen je Zugang in 24 Stunden. Wiederholungen zählen nicht mit;
  ist die Grenze erreicht, bekommt aber jeder Einwurf `429`, auch eine Wiederholung.
- Ein Eintrag der Ablage ist höchstens 48 KiB groß. Text mit vielen Steuer- oder
  Anführungszeichen wird beim Ablegen länger und kann die Grenze schon unter 16 KiB erreichen.
- Höchstens 200 Kennungen mit einer Position je Zugang.
- Zehn Einwürfe mit unbekanntem Schlüssel in fünf Minuten sperren die Quelle für die
  Maschinenwege, auch für signierte Anfragen. Ein widerrufener, abgelaufener oder durch einen
  Wechsel abgelöster Schlüssel zählt nicht: Wer nach einem Wechsel noch die alte Adresse aufruft,
  bekommt `401`, sperrt aber niemanden aus. Die Anmeldung von Menschen ist davon nie betroffen.
- Drosselung und Sperre liegen im Prozessspeicher; ein Neustart setzt sie zurück.

## Betrieb

- Am ELW, der sich für seine Org bei einem Hub meldet, nimmt die Instanz keine Einwürfe an.
  Einwurf-Zugänge gehören dann an den Hub.
- Der Server schreibt den Schlüssel in kein Protokoll: Im Pfad jeder Logzeile steht `***`
  (`pfad_fuer_protokoll`, `src/app.rs`), die Abfrage steht nie darin. Das gilt auch für einen
  vertippten Pfad, solange der Schlüssel sein Präfix `llh_ew_` trägt.
