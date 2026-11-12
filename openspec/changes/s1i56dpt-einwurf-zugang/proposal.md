# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/s1i56dpt5qzoy005ynmtbith (LLH-1654)

## Why

BOSWatch 3, FE2 mit „URL öffnen“, der Divera-Webhook und OsmAnd können nur eine URL aufrufen,
aber keine Anfrage signieren. Der Maschinenzugang (LLH-1652, ADR-0022) schließt sie damit aus.
Ruben hat am 10.11.2026 (E1, `docs/konzepte/2026-11-10-schnittstellen-ausbau.md`) einen Zugang
mit geheimem Schlüssel im Pfad entschieden, der nur in eine Ablage schreibt und nichts liest
(Konzept `docs/konzepte/2026-11-11-oeffentliche-api.md`, Abschnitt „Einwurf“; ADR-0023,
vorgeschlagen). Die Alarmübernahme (LLH-1192) und die Ortung (LLH-1199) warten auf diesen Weg.

## What Changes

- **Einwurf-Zugang:** Ein Zugang gehört einer Org, hat einen Namen, genau einen Zweck
  (`alarmmeldungen:write` oder `positionen:write`) und optional ein „gültig bis“. Sein Schlüssel
  besteht aus `llh_ew_` und 32 Zufallsbytes; gespeichert wird nur der SHA-256.
- **Neue Routen ohne Signatur:**
  - `GET|POST /api/v1/einwurf/{schluessel}/alarmmeldung`
  - `GET|POST /api/v1/einwurf/{schluessel}/position`
  - Sie antworten `204` oder mit einem Fehler, nie mit Daten, und tragen `Cache-Control: no-store`.
- **Schmale Ablage für Alarmmeldungen** (abgestimmt 12.11.2026): Der Einwurf speichert
  Abfrage und Body roh und erkennt nur `external_id` und `message_id`. Eine Wiederholung legt
  keinen zweiten Eintrag an, verschwindet aber nicht: Sie wird am Eintrag gezählt. Ohne Kennung
  gilt gleicher Inhalt desselben Zugangs binnen 2 Minuten als Wiederholung; später entsteht ein
  neuer Eintrag mit Verweis auf den früheren. Einträge werden nach 7 Tagen gelöscht (E5). Den
  Einsatzvorschlag, seinen Lebenslauf und die Oberfläche baut LLH-1192 darauf.
- **Ablage für Positionen** (abgestimmt 12.11.2026): Eine Position hängt an der Kennung, die der
  Absender mitschickt (OsmAnd: `id`). Je Zugang und Kennung liegt genau eine letzte Position
  vor, ohne Verlauf. Ein älterer Zeitstempel wird nicht übernommen. 24 Stunden nach der letzten
  Meldung wird sie gelöscht. Zuordnung zum Fahrzeug und Anzeige bleiben LLH-1199.
- **Nur über TLS:** direkt mit `--tls` oder über `X-Forwarded-Proto: https` von einer Gegenstelle
  aus `--trusted-proxies`, sonst `403 tls_required`. Für ein Tailnet gibt es den Schalter
  `--einwurf-allow-http`; dann warnt die Seite „Anbindungen“.
- **Kein Schlüssel im Protokoll:** `pfad_fuer_protokoll` maskiert den Abschnitt nach `/einwurf/`
  und jeden Abschnitt mit dem Präfix `llh_ew_`.
- **Drosselung:** 30 Aufrufe je Minute und Zugang. Ein unbekannter Schlüssel zählt im
  Maschinenzähler je IP, nie in der Anmeldesperre. Dazu Obergrenzen gegen ein Vollschreiben der
  Ablage (Größe je Einwurf, Einträge je Zugang und Tag, Kennungen je Zugang).
- **Verwaltung:** zweites Paneel „Einwurf-Zugänge“ auf der Admin-Seite „Anbindungen“ mit
  Anlegen, „Schlüssel wechseln“ und „Widerrufen …“. Die Adresse mit Schlüssel erscheint genau
  einmal. Es gibt keine eigene Ansicht und kein nachträgliches Ändern.
- **Nachweis:** drei neue Aktionen in `admin_audit` (angelegt, Schlüssel gewechselt, widerrufen).
- **Gekoppelter ELW:** nimmt für seine Org keine Einwürfe an und legt keine Zugänge an, wie beim
  Maschinenzugang.
- **Entscheidungen:**
  - ADR-0023 wird akzeptiert. Vorher werden ihre Prüfung, `gilt_fuer` und zwei Formulierungen an
    die Ablage angepasst.
  - Eine neue ADR ersetzt ADR-0014 und nennt den Einwurf als einzige Ausnahme vom Schlüsselpaar.
- **Doku:** Anwenderkapitel „Anbindungen“, `docs/api/einwurf.md`, Betriebsdoku (TLS, Proxy
  protokolliert nichts unter `/api/v1/einwurf/`, neuer Schalter) und die arc42-Kapitel.

**Nicht in dieser Change:**

- Einsatzvorschlag, Modul „Alarmübernahme“, Deutung der Rohdaten (BOSWatch `ric`/`text`,
  Normalform), Adapter (LLH-1192, LLH-1632).
- Die signierte Route `POST /api/v1/alarmmeldungen` (LLH-1192). Die Ablage ist so geschnitten,
  dass sie dorthin mitschreiben kann.
- Zuordnung einer Kennung zu einem Fahrzeug, „nur im Einsatz“ und die Lagekarte (LLH-1199).
- Eine Ansicht zum Ändern eines Einwurf-Zugangs und ein Ablehnungsgrund am Zugang: Der Absender
  bekommt den Grund als Fehlercode in der Antwort.

## Capabilities

### New Capabilities

- `einwurf-zugang`: Zugang für Absender ohne Signatur. Dazu gehören Schlüssel, Zweck, Ablauf,
  Wechsel und Widerruf, die Einwurf-Routen mit ihren Antworten, die TLS-Pflicht, der Schutz des
  Schlüssels im Protokoll, Drosselung und Obergrenzen, die Ablage für Alarmmeldungen mit
  Doppelerkennung und Löschfrist, die Ablage der letzten Position, die Verwaltung auf
  „Anbindungen“ und die Admin-Spur.

### Modified Capabilities

- `maschinenzugang`:
  - „Kein Bearer-Token und keine Sitzung unter /api/v1/“ bekommt die Ausnahme Einwurf (Schlüssel
    im Pfad, nur unter `/api/v1/einwurf/`).
  - „Fehlversuche von Maschinen sperren nie die Anmeldung von Menschen“: Der Maschinenzähler
    zählt zusätzlich unbekannte Einwurf-Schlüssel.

## Impact

- **Backend:**
  - neu: `src/public_api/einwurf.rs` (Schlüssel, Repo, Ablage, Handler, Maskierung) und
    `src/routes/einwurf_zugaenge.rs` (Admin-Routen);
  - Umbau: `src/public_api/drossel.rs` (Vorrat und Nachfüllen als Parameter, zweite Instanz),
    `src/extract.rs` (TLS-Nachweis über vertraute Proxys), `src/app.rs` (`pfad_fuer_protokoll`,
    `RouterOptionen`, Admin-Routen), `src/config.rs` und `src/main.rs` (Schalter),
    `src/auth/admin_audit.rs`, `src/einsatz/purge_scheduler.rs`, `src/api_doc.rs`,
    `src/public_api/{mod.rs,description.md}`.
- **Migrationen:** drei neue Tabellen (`einwurf_zugang`, `alarmmeldung`, `position_letzte`) und
  der neu gebaute CHECK von `admin_audit`. Nummern über allen auf `alpha` (heute 0335, 0336).
- **Vertrag:** `docs/api/public-v1.json` bekommt vier Operationen; `frontend/src/api/openapi.json`
  und `types.generated.ts` die Admin-Typen.
- **Frontend:** Paneel und Dialoge unter `frontend/src/pages/einstellungen/`, API-Modul,
  Query-Key, Klartext der neuen Audit-Aktionen, Vitest und e2e.
- **Doku:** `docs/anwender/kapitel/anbindungen.md`, `docs/api/einwurf.md`, `docs/betrieb-tls.md`,
  `docs/betrieb/env-registry.md`, `docs/betrieb/observability.md`, arc42-Kapitel 3, 5, 6, 7, 8,
  11 und 12, ADR-0023, ADR-0014 und die neue ADR, `src/AGENTS.md`.
- **Betrieb:** Wer Einwürfe hinter einem Reverse-Proxy annimmt, muss `--trusted-proxies` setzen
  und dem Proxy das Protokollieren unter `/api/v1/einwurf/` abstellen.
