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
| Felder | `stichwort`, `einsatznummer`, `einsatz_id`, `alarmiert_at`, `lagemeldung`, `stand_at` | `id`, `external_id`, `cursor`, `type`, `occurred_at`, `state`, `kind` |
| Abfrage | `karte` | `after`, `wait` |
| Fehler | Text (`error`) | `code` |

Felder sind `snake_case`.

## Einsatzbezug

Ein Lese-Scope mit Einsatzbezug (`lage:read`) sieht nur den Einsatz, den die Einsatzleitung für
den Zugang freigegeben hat, und nur, solange dieser Einsatz läuft. Je Zugang ist das höchstens
einer. Ohne Freigabe antwortet `GET /api/v1/lage` mit `einsatz: null`, nicht mit einem Fehler.

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

## Grenzen

- Ein Body ist höchstens 64 KiB groß.
- Antworten tragen `Cache-Control: no-store`.
- Es gibt kein CORS: Browser-Clients fremder Seiten sind nicht vorgesehen.
