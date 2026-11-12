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

## Ereignisse

`GET /api/v1/events` (Scope `events:read`) sagt einem Fremdsystem, dass sich an einem für seinen
Zugang freigegebenen Einsatz etwas getan hat. Ein Ereignis trägt nur `id`, `type`, `occurred_at`
und `einsatz_id`; den Inhalt liest der Client über die Leserouten nach.

| `type` | Bedeutung | Sichtbar mit |
| --- | --- | --- |
| `einsatz.created` | Der Einsatz ist für den Zugang lesbar geworden. | `einsaetze:read` |
| `einsatz.updated` | Ein Feld des Einsatzes hat sich geändert. | `einsaetze:read` |
| `einsatz.closed` | Der Einsatz ist für den Zugang nicht mehr lesbar. | `einsaetze:read` |
| `lage.changed` | Die Lage des Einsatzes kann sich geändert haben. | `lage:read` |

- **Cursor:** `id` steigt fortlaufend. Jede Antwort nennt einen `cursor`; der nächste Abruf gibt
  ihn als `after` mit. Ohne `after` kommt der aktuelle Stand ohne Ereignisse.
- **Warten:** `wait` hält den Abruf höchstens 25 Sekunden offen, bis ein Ereignis vorliegt. Es
  warten höchstens 32 Abrufe zugleich, je Zugang einer. Ein Abruf darüber antwortet sofort und
  setzt `Retry-After`.
- **Seiten:** Eine Antwort trägt höchstens 500 Ereignisse. Bei einer vollen Seite gleich mit dem
  neuen Cursor weiter abrufen.
- **`lage.changed` ist verdichtet:** Je Einsatz liegt höchstens eines vor; ein neues ersetzt das
  alte und trägt eine höhere `id`.
- **Aufbewahrung:** Ereignisse leben sieben Tage. Ein älterer Cursor ergibt `410 cursor_expired`;
  der Client liest dann die Einsätze neu und fährt mit dem dort gelieferten Cursor fort.

## Grenzen

- Ein Body ist höchstens 64 KiB groß.
- Antworten tragen `Cache-Control: no-store`.
- Es gibt kein CORS: Browser-Clients fremder Seiten sind nicht vorgesehen.
