# Design

## Context

Motivation und Umfang: proposal.md. Das Verhalten steht in `specs/einwurf-zugang/spec.md` und im
Delta zu `maschinenzugang`; hier steht nur, wie es gebaut wird und warum so.

Stand im Repo (gelesen am 12.11.2026, `origin/alpha` 3d74eba3):

- **v1-Gerüst** (`src/public_api/mod.rs`): Routen entstehen nur per `.routes(routes!(…))` in
  `router()`, jeder Handler trägt `#[utoipa::path]`. `contract_layer` setzt `no-store` für alles
  unter `/api/v1/`. `tests/public_api.rs` verbietet `"/api/v1` im Produktionsteil von
  `src/app.rs` und `.route(` unter `src/public_api/`.
- **Fehlercodes** (`src/public_api/error.rs`): `unauthorized`, `missing_scope`, `tls_required`,
  `payload_too_large`, `unprocessable` und `rate_limited` gibt es schon. `tls_required` benutzt
  noch niemand. Ein neuer Code ist nicht nötig.
- **Maschinenzähler** (`src/auth/rate_limit.rs`, `pub mod maschine`): eigene Tabelle je IP,
  `sperre(ip)` und `fehlversuch(ip)`.
- **Drossel** (`src/public_api/drossel.rs`): Token-Bucket mit festen Konstanten 60 und 1 je
  Sekunde, eine prozessweite Map nach Zugangs-ID.
- **Hash-Schlüssel** (`src/lagemonitor_zugang/mod.rs`): 32 Bytes `OsRng`, base64url ohne
  Auffüllung, Präfix, `sha256_hex`, Suche über den Hash.
- **TLS:** `Config::tls` gelangt nicht in den Router. `auth::session::cookie_secure()` schließt
  `--cookie-secure` ein, `weitergeleitet_als_https` prüft keinen Proxy. Die Liste der vertrauten
  Proxys ist ein privates `OnceLock` in `src/extract.rs`.
- **Protokollpfad:** `pfad_fuer_protokoll` (`src/app.rs`) kürzt nur. Einziger Aufrufer ist der
  Span des `TraceLayer`. Sonst schreibt keine Stelle im Produktionscode einen Anfragepfad ins Log
  (`machine.rs` nutzt `MatchedPath`, die OIDC-Stelle liegt nicht unter `/api/v1/`).
- **Admin-Spur:** Jede neue Aktion braucht den neu gebauten CHECK (Muster 0334), den Eintrag in
  `tests/enum_wire_kontrakt.rs` und den Klartext im Frontend.
- **Purge:** `purge_scheduler` läuft alle 10 Minuten und ruft `public_api::zugang::purge`.
- **ADR-0023** ist `vorgeschlagen` und damit noch änderbar; ADR-0014 ist `akzeptiert`.

## Goals / Non-Goals

**Goals:**

- Die Routen sind von Anfang an vollständig: Wer eine Einwurf-Adresse bekommt, kann sie
  eintragen, und nichts geht verloren, bis LLH-1192 und LLH-1199 die Ablage lesen.
- Die Ablage ist so geschnitten, dass LLH-1192 und LLH-1199 darauf aufsetzen, ohne sie umzubauen.
- Der Schlüssel erscheint an keiner Stelle, an der ein Betreiber ihn nicht erwartet.

**Non-Goals:**

- Kein Leseweg für die Ablage, auch nicht für Admins. Das Paneel zeigt nur „zuletzt genutzt“.
- Keine Deutung der Rohdaten, kein Zusammenführen von Einträgen.
- Kein Abrufprotokoll je Tag wie beim Maschinenzugang: Die Ablage selbst hält Zugang und Zeit.

## Decisions

### D1 Schnitt: schmale Ablage in dieser Change (abgestimmt 12.11.2026)

Die Routen schreiben in zwei neue Tabellen. Einsatzvorschlag und Oberfläche folgen in LLH-1192.

- **Verworfen: nur Zugang und Tor, Routen später.** Das Akzeptanzkriterium „landet in der Ablage“
  bliebe offen, und ein angelegter Zugang nähme nichts an.
- **Verworfen: zusammen mit LLH-1192.** Ein Branch mit Zugang, Alarmübernahme, Adaptern und
  Modul wäre zu groß für einen Review.

### D2 Inhalt roh, Deutung später (abgestimmt 12.11.2026)

Der Einwurf speichert, was ankam, und erkennt nur `external_id` und `message_id`.

- **Rohdaten** sind ein JSON-Text mit `abfrage` (Liste von Paaren in Empfangsreihenfolge),
  `inhaltstyp` (Wert von `Content-Type`, falls vorhanden) und `body` (Text). Der Body muss UTF-8
  sein, sonst 422.
- **Kennungen** stehen in der Abfrage oder, bei `application/json` mit einem Objekt als Wurzel,
  als Zeichenkette oder Zahl auf oberster Ebene. Bei `application/x-www-form-urlencoded` zählen
  die Formularfelder wie die Abfrage. Der Body geht vor. Höchstens 200 Zeichen, sonst 422. Ein
  JSON-Body, der sich nicht lesen lässt, wird trotzdem als Text abgelegt.
- **Inhaltsgleichheit** ist der SHA-256 über die rohe Abfrage, ein Trennbyte und die Bytes des
  Bodys. Derselbe Absender erzeugt bei einer Wiederholung dieselben Bytes; eine Normalisierung
  wäre schon Deutung.
- **Verworfen: gegen die Normalform prüfen.** Das BOSWatch-Beispiel des Konzepts
  (`ric`, `subric`, `text`) fiele durch, bevor es einen Adapter gibt.

### D3 Datenmodell

Drei Tabellen, Nummern über allen auf `origin/alpha` (nach dem Zusammenführen von `alpha` am 12.11.2026: 0339), eine vierte Migration baut den
CHECK von `admin_audit` neu (0340).

```sql
CREATE TABLE einwurf_zugang (
    id                       TEXT    PRIMARY KEY,           -- UUID
    org_id                   INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    name                     TEXT    NOT NULL,
    scope                    TEXT    NOT NULL
                                     CHECK (scope IN ('alarmmeldungen:write', 'positionen:write')),
    schluessel_hash          TEXT    NOT NULL UNIQUE,       -- SHA-256-Hex
    gueltig_bis              TEXT,
    angelegt_at              TEXT    NOT NULL,
    angelegt_von             INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    schluessel_gewechselt_at TEXT,
    widerrufen_at            TEXT,
    widerrufen_von           INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    zuletzt_genutzt_at       TEXT                           -- höchstens minütlich
);

CREATE TABLE alarmmeldung (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id                  INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    zugang_id               TEXT    NOT NULL,   -- ohne Fremdschlüssel, s. u.
    external_id             TEXT,
    message_id              TEXT,
    inhalt_hash             TEXT    NOT NULL,
    rohdaten                TEXT    NOT NULL,
    empfangen_at            TEXT    NOT NULL,
    erneut_empfangen_anzahl INTEGER NOT NULL DEFAULT 0,
    erneut_empfangen_at     TEXT,
    frueher_id              INTEGER REFERENCES alarmmeldung(id) ON DELETE SET NULL
);

CREATE TABLE position_letzte (
    org_id       INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    zugang_id    TEXT    NOT NULL,
    kennung      TEXT    NOT NULL,
    lat          REAL    NOT NULL,
    lon          REAL    NOT NULL,
    gemessen_at  TEXT    NOT NULL,   -- Zeitstempel des Absenders in `zeit::FORMAT`, sonst Empfang
    empfangen_at TEXT    NOT NULL,
    rohdaten     TEXT    NOT NULL,   -- übrige Felder (Geschwindigkeit, Richtung …), ersetzt mit
    PRIMARY KEY (zugang_id, kennung)
);
```

- **`zugang_id` ohne Fremdschlüssel** in den Ablagen: LLH-1192 schreibt über
  `POST /api/v1/alarmmeldungen` Meldungen eines Maschinenzugangs in dieselbe Tabelle. Beide
  Zugangsarten tragen UUIDs; die Org hängt über `org_id` mit Kaskade daran. Zugänge werden nie
  gelöscht, nur widerrufen.
- **Eine Zeile je Meldung**, nicht je Vorschlag: Der Verlauf zu einer `external_id` sind ihre
  Zeilen. Der Vorschlag (LLH-1192) gruppiert nach (`zugang_id`, `external_id`).
- **Indizes:** (`zugang_id`, `external_id`, `message_id`), (`zugang_id`, `inhalt_hash`,
  `empfangen_at`) und `empfangen_at` für den Löschlauf.
- **Namen:** `alarmmeldung` und `position_letzte` statt `einwurf_…`, weil die Tabellen nicht dem
  Einwurf gehören, sondern der Ablage, in die später auch signierte Routen schreiben.

### D4 Doppelerkennung als eine Entscheidung je Einwurf

In einer Transaktion (`write_retry!`) wird genau einer von drei Wegen genommen:

| Meldung trägt | Wiederholung, wenn derselbe Zugang schon hat | Zeitgrenze |
| --- | --- | --- |
| `message_id` | dieselbe `external_id` (auch beide leer) und `message_id` | keine |
| nur `external_id` | dieselbe `external_id` und denselben `inhalt_hash` | keine |
| keine Kennung | denselben `inhalt_hash` ohne Kennung, letzter Empfang ≤ 120 s her | 2 Minuten |

- **Wiederholung:** `erneut_empfangen_anzahl + 1`, `erneut_empfangen_at = jetzt`, kein neuer
  Eintrag. So zeigt die Ablage auch den Fall „nach A und B kommt wieder A“ aus dem Konzept: A
  trägt dann einen erneuten Empfang, der jünger ist als B.
- **Gleitendes Fenster:** „Letzter Empfang“ ist `erneut_empfangen_at`, sonst `empfangen_at`. Ein
  Absender, der alle 60 Sekunden wiederholt, erzeugt damit einen Eintrag mit Zähler statt alle
  zwei Minuten einen neuen. Verworfen: festes Fenster ab dem ersten Empfang.
- **Später gleicher Inhalt ohne Kennung:** neuer Eintrag, `frueher_id` zeigt auf den jüngsten
  Eintrag desselben Zugangs mit demselben Hash.
- **Antwort:** immer 204. Ob neu oder wiederholt, verrät sie nicht (Spec „Ein Einwurf liest
  nichts“).

### D5 Position an der Kennung des Absenders (abgestimmt 12.11.2026)

- **Felder** aus Formular-Body, flachem JSON-Objekt oder Abfrage, in dieser Reihenfolge: `id`
  oder `deviceid` (höchstens 128 Zeichen), `lat` (−90 bis 90), `lon` (−180 bis 180), optional
  `timestamp`. Das ist das OsmAnd-Protokoll, das auch der Traccar-Client spricht.
- **`timestamp`:** Unix-Sekunden, Unix-Millisekunden (ab 10¹¹) oder RFC 3339. Gespeichert wird
  UTC in `zeit::FORMAT`. Nicht lesbar oder mehr als 5 Minuten in der Zukunft: 422. Ohne die
  Zukunftsgrenze fröre ein einzelnes Paket mit falscher Uhr die Position ein, weil alle späteren
  als „älter“ gälten.
- **Schreiben:** ein `INSERT … ON CONFLICT (zugang_id, kennung) DO UPDATE … WHERE
  excluded.gemessen_at >= position_letzte.gemessen_at`. Ein älterer Zeitstempel ändert nichts und
  ist kein Fehler.
- **Verfall:** 24 Stunden nach `empfangen_at`.
- **Verworfen: ein Zugang je Fahrzeug, direkt nach `einsatz_fahrzeug.lat/lon`.** Das nähme die
  Gerätekopplung und die Karte aus LLH-1199 vorweg, bevor die Dienstvereinbarung geklärt ist.
- **Folge für den Datenschutz:** Die Ablage hält Positionen auch außerhalb eines Einsatzes, aber
  nur die letzte je Kennung, höchstens 24 Stunden, und niemand kann sie lesen. „Nur im Einsatz“
  setzt LLH-1199 beim Lesen durch. Das steht so in Kapitel 11 und im Anwenderkapitel.

### D6 Reihenfolge der Prüfungen

Ein Baustein `Einwurf` in `src/public_api/einwurf.rs` (kein Extractor mit `Rejection`, damit die
Reihenfolge an einer Stelle steht), aufgerufen von den vier Handlern:

1. **TLS-Nachweis** (D7), sonst `403 tls_required`. Vor der Suche, damit eine Klartext-Anfrage
   kein Orakel für Schlüssel ist und nichts zählt.
2. **Sperre der Quelle** im Maschinenzähler, sonst `429 rate_limited` mit `Retry-After: 60`.
3. **Form des Schlüssels** (Präfix, 50 Zeichen) und **Suche über den Hash**. Nicht gefunden:
   `rate_limit::maschine::fehlversuch(ip)` und `401 unauthorized`.
4. **Zustand:** widerrufen, abgelaufen oder gekoppelter ELW (`zugang::hub_fuer_org`): `401`,
   ohne zu zählen.
5. **Zweck** gegen die Route: `403 missing_scope`.
6. **Drossel** je Zugang (D8): `429` mit `Retry-After`.
7. **Größe und Inhalt:** 413 oder 422.
8. **Schreiben**, `zuletzt_genutzt_at` höchstens minütlich, dann `204`.

Der Schlüssel wird nur über seinen Hash gesucht, wie bei `llh_lm_`; ein Vergleich in konstanter
Zeit ist dafür nicht nötig.

### D7 TLS-Nachweis

- Neue Funktion in `src/extract.rs`: `kam_ueber_tls(tls_direkt, gegenstelle, headers, vertraut)`.
  Sie ist wahr, wenn der Server TLS selbst terminiert oder wenn die Gegenstelle in der Liste
  steht, `X-Forwarded-Proto` vorhanden ist und **jeder** Wert `https` lautet. So gilt weder ein
  Kopf von einer fremden Gegenstelle noch ein Wert, den ein Client vor den des Proxys gesetzt
  hat. Die Funktion ist rein und mit ausdrücklicher Liste getestet; das `OnceLock` bleibt privat.
- `RouterOptionen` bekommt `tls: bool` und `einwurf_allow_http: bool`. `build_router_mit` legt
  sie als `Extension(Transport { … })` an den ganzen Router. Handler der Einwurf-Routen und die
  Admin-Liste lesen sie dort. Kein neues Feld in `AppState` und kein weiteres `OnceLock`: Tests
  prüfen „an“ und „aus“ im selben Binary (Begründung wie bei `RouterOptionen` selbst).
- **Schalter:** `--einwurf-allow-http`, `LIFELINE_EINWURF_ALLOW_HTTP`, Vorgabe aus. Beim Start
  schreibt der Server eine Warnzeile, wenn er gesetzt ist.
- **Lage für die Seite:** `EinwurfTransport` als Wire-Enum mit `tls`, `proxy` (Liste der
  vertrauten Proxys nicht leer), `http` (Schalter) und `keiner`. Das Paneel warnt bei `http` und
  `keiner`.
- **Verworfen: `cookie_secure()` oder `weitergeleitet_als_https` wiederverwenden.** Das erste
  ist auch ohne TLS wahr, das zweite fälschbar.

### D8 Drosselung und Obergrenzen

- `TokenBucket` und `Drossel` bekommen Vorrat und Nachfüllrate als Werte statt Konstanten. Es
  gibt zwei prozessweite Instanzen: Maschinenzugang (60, 1 je Sekunde, unverändert) und Einwurf
  (30, 0,5 je Sekunde). Getrennte Maps, also keine Kollision der Schlüssel.
- **Obergrenzen** (neu in diesem Entwurf, nicht im Konzept): Der Schlüssel steht in einer URL
  und gelangt leichter in fremde Hände als ein privater Schlüssel. Ohne Grenze schriebe ein
  einziger Zugang bei 30 Aufrufen je Minute und 64 KiB je Aufruf bis zu 2,7 GB am Tag.
  - Body höchstens 16 KiB (`DefaultBodyLimit` an den Routen, wie beim Einlösen), Abfrage
    höchstens 8 KiB: 413.
  - Höchstens 5 000 neue Alarmmeldungen je Zugang in 24 Stunden: 429 mit `Retry-After: 3600`.
    Gezählt wird in der Schreib-Transaktion; Wiederholungen zählen nicht. Das sind im
    schlimmsten Fall 80 MB am Tag und 560 MB in der Löschfrist.
  - Höchstens 200 Kennungen je Zugang: 422.

### D9 Maskierung

- `public_api::einwurf::maskiere_pfad(pfad) -> Cow<str>` ersetzt den Abschnitt nach
  `/api/v1/einwurf/` und jeden Abschnitt, der mit `llh_ew_` beginnt, durch `***`.
  `pfad_fuer_protokoll` ruft sie vor dem Kürzen auf. So steht in `src/app.rs` kein
  `"/api/v1…"`-Literal, und der Wächter in `tests/public_api.rs` bleibt grün.
- Die zweite Regel fängt vertippte oder falsch geschriebene Pfade, die nicht zur Route führen und
  trotzdem protokolliert würden.
- **Akzeptanztest über den Span:** ein Einwurf durch den ganzen Router mit
  `test_log::LogPuffer::einfangen()`, danach enthält kein mitgeschnittenes Byte den Schlüssel.
- Der Handler selbst schreibt keine Logzeile mit Pfad, Abfrage, Schlüssel oder Hash. Was er
  protokolliert, nennt die Zugangs-ID.

### D10 Wechsel am selben Zugang

`POST …/{id}/schluessel` setzt einen neuen `schluessel_hash` und `schluessel_gewechselt_at`. Der
alte Schlüssel gilt ab dem Commit nicht mehr. Name, Zweck, „gültig bis“ und „zuletzt genutzt“
bleiben. Das entspricht dem Konzept („neuer Schlüssel, der alte wird widerrufen“), ohne dass die
Liste sich mit widerrufenen Zwillingen füllt.

- **Verworfen: Übergangszeit mit zwei gültigen Schlüsseln** wie beim Maschinenzugang. Dort endet
  sie, sobald der neue Schlüssel zum ersten Mal signiert. Beim Einwurf gibt es kein solches
  Signal, und ein vermutlich bekannt gewordener Schlüssel soll sofort enden.

### D11 Admin-Routen und Typen

Eigene Datei `src/routes/einwurf_zugaenge.rs`, registriert in `src/app.rs`:

| Route | Wirkung |
| --- | --- |
| `GET /api/admin/einwurf-zugaenge` | `EinwurfZugaengeListe { zugaenge, gesperrt_grund, transport }` |
| `POST /api/admin/einwurf-zugaenge` | legt an, 201 `EinwurfZugangSchluessel { zugang, schluessel }` |
| `POST /api/admin/einwurf-zugaenge/{id}/schluessel` | wechselt, `EinwurfZugangSchluessel` |
| `POST /api/admin/einwurf-zugaenge/{id}/widerrufen` | widerruft, `EinwurfZugangAnzeige` |

- Rechte wie bei `routes/anbindungen.rs`: lesen mit `darf_admin_bereich()`, schreiben als
  `AdminUser`, immer die eigene Org; ein fremder Zugang ist 404.
- `EinwurfZugangAnzeige`: `id`, `name`, `scope` (`public_api::Scope`), `gueltig_bis`,
  `is_abgelaufen`, `angelegt_at`, `schluessel_gewechselt_at`, `widerrufen_at`,
  `widerrufen_von_name`, `zuletzt_genutzt_at`.
- Namensgrenze und Prüfung von „gültig bis“ kommen aus `routes/anbindungen.rs` (`NAME_MAX`,
  `check_gueltig_bis`), keine zweite Konstante.
- **Admin-Spur:** `einwurf_zugang_angelegt`, `einwurf_zugang_schluessel_gewechselt`,
  `einwurf_zugang_widerrufen`, Ziel `Ziel::EinwurfZugang(name)`, Angaben `zugang_id` und `scopes`.
  Geschrieben nach dem Commit und nur bei Wirkung, mit dem Stand aus derselben Transaktion.
- **Verworfen: unter `/api/admin/anbindungen/…` einhängen.** Der Pfad `…/{id}` ist dort belegt.

### D12 Öffentliches Dokument

- Je Route zwei Handler (`get` und `post`) mit eigenem `#[utoipa::path]`, eingehängt als
  `.routes(routes!(alarmmeldung_get, alarmmeldung_post))`. Beide rufen dieselbe Funktion.
- Kein Sicherheitsschema `machine` an diesen Operationen; die Beschreibung nennt den Schlüssel im
  Pfad. Antworten: 204, 401, 403, 413, 422, 429 und `default` mit `ApiErrorBody`.
- `description.md` bekommt einen Abschnitt „Einwurf“. Nach der Änderung
  `cargo test --test public_api_spec_aktuell` und `docs/api/public-v1.json` mitcommitten.

### D13 Oberfläche

- Neue Datei `frontend/src/pages/einstellungen/EinwurfZugaenge.tsx`: ein `Paneel` „Einwurf-Zugänge“
  mit `Liste`, eingebunden in `Anbindungen.tsx` unter „Zugänge“. Das Anlegen ist eine Aktion am
  Paneel, weil die Kopfaktion der Seite „Anbindung anlegen“ bleibt.
- **Anlegen:** `ErfassungsModal` mit drei Feldern (Name, Zweck, „Gültig bis“), Knopf „Anlegen und
  Adresse zeigen“.
- **Adresse einmal zeigen:** Dialog nach dem Vorbild `LagemonitorZugaenge.tsx` und `CodeDialog`:
  Adresse aus `window.location.origin`, dem Schlüssel und dem Unterpfad des Zwecks in
  `KopierbarerText`, dazu „Nur jetzt sichtbar.“; schließt nur über „Fertig“.
- **Zeilenaktionen:** eine `WeitereAktionen`-Quelle für ⋮ und Kontextmenü mit „Schlüssel
  wechseln …“ und „Widerrufen …“. Beide fragen nach (`danger`, benannter Knopf), weil der alte
  Schlüssel sofort endet.
- **Daten:** API-Modul `frontend/src/api/einwurfZugaenge.ts`, Schlüssel
  `GLOBAL_KEYS.einwurfZugaenge` in `NICHT_LIVE_GLOBAL_KEYS`, Abruf alle 30 Sekunden wie die
  Anbindungen. Zweck-Texte aus `SCOPE_TEXT`.
- **Keine eigene Ansicht, kein PATCH** (abgestimmt 12.11.2026). Kein `/design`-Entwurf: Paneel
  und Dialoge folgen den Mustern der Seite, es entsteht kein neuer Baustein.
- **Adresse hinter einem Proxy:** `window.location.origin` ist die Adresse, unter der der Admin
  die Seite gerade sieht. Weicht die öffentliche Adresse ab, stimmt der Host nicht. Das
  Anwenderkapitel sagt das; eine öffentliche Basis-URL kennt die Konfiguration nicht.

### D14 Entscheidungen und Regeln

- **ADR-0023** wird vor der Annahme angepasst, solange sie `vorgeschlagen` ist:
  - `gilt_fuer`: `src/public_api/**`, `src/routes/einwurf_zugaenge.rs`, `src/extract.rs`,
    `src/app.rs`, `src/auth/rate_limit.rs`.
  - Prüfung: `verlange 'einwurf::maskiere_pfad' src/app.rs`, `verlange 'llh_ew_'
    src/public_api/einwurf.rs`, `verlange 'kam_ueber_tls' src/public_api/einwurf.rs`.
  - Wortlaut: „am bestehenden Vorschlag“ wird „am bestehenden Eintrag der Ablage“; die Regel zum
    TLS-Kopf nennt „jeder Wert“; neu die Obergrenzen aus D8.
  - Danach `status: akzeptiert`. Die Annahme ist Rubens Freigabe dieser Change.
- **Neue ADR** mit der nächsten freien Nummer (heute 0029; vor dem Anlegen `git fetch origin
  alpha` und die offenen PRs ansehen): `ersetzt: ADR-0014`, dieselben Regeln, `gilt_fuer` und
  Prüfung, dazu die Regel, dass der Einwurf nach ADR-0023 die einzige Anmeldung einer Maschine
  ohne Schlüsselpaar ist. ADR-0014 bekommt `status: ersetzt` und `ersetzt_durch`.
- **Verweise auf ADR-0014** in arc42, `AGENTS.md`-Dateien und Code-Kommentaren zeigen danach auf
  die neue ADR. ADR-0022 bleibt, wie sie ist (akzeptiert und unveränderlich); ihr Verweis führt
  über `ersetzt_durch` weiter.
- **`src/AGENTS.md`**, „Öffentliche API v1“: ein Punkt zum Einwurf (Schlüssel nie loggen,
  Reihenfolge der Prüfungen an einer Stelle, Verweis auf die Spec).

## Risks / Trade-offs

- **Schlüssel in der URL** gelangt in Proxy-Logs, Browserverläufe und Konfigurationsdateien →
  Maskierung im eigenen Protokoll, Betriebsdoku für den Proxy, TLS-Pflicht, Wechsel und Widerruf
  mit sofortiger Wirkung, Obergrenzen. Der Schlüssel kann nur schreiben. Neues Risiko in
  Kapitel 11.
- **Art.-9-Daten in den Rohdaten**, bei GET auch in der URL → Löschung nach 7 Tagen, kein
  Leseweg, Empfehlung POST. LLH-1192 löscht Rohdaten bei Annahme sofort.
- **Positionen vor der Dienstvereinbarung** (LLH-1199) → nur letzte Position, 24 Stunden, nicht
  lesbar; der Betreiber legt einen solchen Zugang bewusst an. Anwenderkapitel und Kapitel 11
  nennen die Grenze.
- **Hinter einem Proxy ohne `--trusted-proxies` lehnt der Einwurf alles ab** → Hinweis im Paneel
  (`transport: keiner`), Betriebsdoku, Fehlercode `tls_required` beim Absender.
- **Ein vorgeschalteter Proxy, der `X-Forwarded-Proto` anhängt statt setzt**, führt zu 403 →
  dokumentiert; sicherer als ein fälschbarer Nachweis.
- **Die Tagesgrenze kann einen echten Massenanfall bremsen** (ungefilterter POCSAG-Mitschnitt
  einer großen Leitstelle) → 5 000 liegt weit über einem Wachbereich; die Grenze ist eine
  Konstante und steht in der Doku.
- **Gleitendes Fenster** fasst zwei echte Alarme mit gleichem Text binnen 2 Minuten zusammen →
  vom Konzept so gewollt; der Zähler zeigt es, der Mensch entscheidet in LLH-1192.
- **Geteilter Maschinenzähler:** Zehn unbekannte Einwurf-Schlüssel sperren für die Quelle auch
  signierte Anfragen 5 Minuten lang → gewollt (eine Quelle, die rät), getrennt von der
  Anmeldung von Menschen.
- **`Extension` am ganzen Router** fehlt in Tests, die Handler ohne `build_router_mit` montieren
  → der Baustein behandelt eine fehlende Angabe wie „kein TLS, kein Schalter“ (fail closed).

## Migration Plan

- Nur neue Tabellen und der neu gebaute CHECK; kein Bestand wird umgeschrieben. Vor dem Push
  `scripts/check-migrationen.sh` gegen `origin/alpha`.
- Kein Schalter nötig: Ohne angelegten Zugang antworten die Routen mit 401.
- Rückweg: Zugänge widerrufen. Die Tabellen bleiben nach einem Zurückrollen des Codes ungenutzt
  liegen.

## Open Questions

- Braucht das Paneel ein Bild im Anwenderkapitel? Für „Anbindungen“ gibt es bisher keine
  Bilder-Spec; die Change legt keine an.
