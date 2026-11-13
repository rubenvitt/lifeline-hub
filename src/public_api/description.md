Öffentliche API von Lifeline Hub für Fremdsysteme (Alarmübernahme, Lagemonitore, Einsatzbuch,
eigene Skripte). Grundlage: ADR-0022.

## Stabilitätszusage

- Nur die Pfade unter `/api/v1/` sind öffentlich. Die übrige API dient der eigenen Oberfläche und
  ändert sich ohne Ankündigung.
- Innerhalb von v1 kommen nur hinzu: neue Routen, neue optionale Felder, neue Scopes, neue
  Enum-Werte und neue Fehlercodes.
- Clients überspringen unbekannte Felder und unbekannte Enum-Werte, statt abzubrechen.
- Wer entfernen oder umdeuten muss, macht `/api/v2/`. v1 bleibt dann mindestens sechs Monate
  erreichbar und meldet `Deprecation` und `Sunset` im Kopf jeder Antwort.

## Namen

Fachbegriffe sind deutsch, alles Technische ist englisch. Umlaute werden umschrieben
(`einsaetze`).

| Art | Deutsch (Fachbegriff) | Englisch (Technik) |
| --- | --- | --- |
| Pfade | `lage`, `einsaetze`, `alarmmeldungen`, `positionen`, `einwurf`, `zugang`, `instanz` | `v1`, `me`, `events`, `redeem`, `jwks.json`, `openapi.json` |
| Felder | `stichwort`, `einsatznummer`, `einsatz_id`, `alarmiert_at` | `id`, `external_id`, `cursor`, `type`, `occurred_at`, `state` |
| Abfrage | – | `after`, `wait` |
| Fehler | Text (`error`) | `code` |

Felder sind `snake_case`.

## Zeitpunkte

Zeitpunkte sind UTC im Format `JJJJ-MM-TT hh:mm:ss` (etwa `2026-11-12 08:30:00`), ohne
Zonenkennung, und enden auf `_at`.

## Fehler

Jede Fehlerantwort ist `{"error": "<Text>", "code": "<code>"}`. Vertrag ist `code`; der Text ist
deutsch, für Menschen gedacht und kann sich ändern.

| Status | `code` |
| --- | --- |
| 400 | `invalid_field` |
| 401 | `unauthorized` |
| 403 | `missing_scope` |
| 403 | `tls_required` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 409 | `conflict` |
| 409 | `fuehrung_elsewhere` |
| 410 | `cursor_expired` |
| 413 | `payload_too_large` |
| 422 | `unprocessable` |
| 429 | `rate_limited` |
| 500 | `internal_error` |
| 503 | `unavailable` |

`fuehrung_elsewhere` heißt: Eine andere Instanz führt den Einsatz. Ein Status ohne eigene Zeile
trägt `unprocessable` (4xx) oder `internal_error` (5xx).

## Einwurf

Absender, die nur eine URL aufrufen und nicht signieren können (BOSWatch, FE2 mit „URL öffnen“,
Divera-Webhook, OsmAnd), werfen über einen Einwurf-Zugang ein (ADR-0023). Wer signieren kann,
nimmt den Maschinenzugang.

- Der Schlüssel (`llh_ew_…`) steht im Pfad: `/api/v1/einwurf/{schluessel}/alarmmeldung` oder
  `…/position`, je nach Zweck des Zugangs. Er ist die Anmeldung; einen Kopf `Authorization` gibt
  es hier nicht.
- Ein Einwurf schreibt nur und liest nichts. Die Antwort ist `204` ohne Body oder ein Fehler.
  Eine neue Meldung und eine Wiederholung bekommen dieselbe Antwort.
- Nur über TLS, sonst `403 tls_required`. Wer POST kann, nimmt POST: Bei GET stehen Schlüssel und
  Inhalt in der URL.
- **Alarmmeldung:** Abfrage und Body werden unverändert abgelegt und nicht gedeutet. Der Server
  erkennt nur `external_id` und `message_id`. Mit ihnen ist eine Wiederholung dauerhaft
  idempotent; ohne sie gilt gleicher Inhalt desselben Zugangs zwei Minuten lang als
  Wiederholung, danach entsteht ein neuer Eintrag.
- **Position:** `id`, `lat`, `lon` und optional `timestamp` (OsmAnd-Protokoll). Je Zugang und
  `id` hält der Server genau eine Position, ohne Verlauf; eine mit älterem Zeitstempel wird
  nicht übernommen.
- Nur GET und POST; jede andere Methode, auch HEAD, ergibt `405`.
- Grenzen: Body höchstens 16 KiB, Abfrage höchstens 8 KiB, abgelegte Rohdaten höchstens 48 KiB,
  30 Einwürfe je Minute und Zugang, 5 000 neue Alarmmeldungen je Zugang in 24 Stunden, 200
  Kennungen für Positionen je Zugang.

## Grenzen

- Ein Body ist höchstens 64 KiB groß, bei einem Einwurf 16 KiB.
- Antworten tragen `Cache-Control: no-store`.
- Es gibt kein CORS: Browser-Clients fremder Seiten sind nicht vorgesehen.
