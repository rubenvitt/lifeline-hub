# LFH-606 — Pegel/Wasserstand als Einsatz-Kennzahl mit Trend

Stand 22.09.2026. Ticket: LFH-606 (Entwicklungsboard). Entwurfsquelle:
`docs/design/2026-09-21-neuentwurf/neuentwurf.dc.html`, S3 `dashKennzahlen`, S2 `kennzahlen`.

## Entscheidungen des Auftraggebers (22.09.2026)

1. **Der Pegel ersetzt „Höchste Warnstufe“ im Kennzahlenband** und rückt an **Platz 1**
   (wie im Entwurf). Das Band bleibt bei sechs festen Plätzen (6 → 3 → 2 Spalten,
   Prüfliste Kriterium 9). Die Warnstufe bleibt sichtbar im Seitenkopf-Hinweis (bei
   Alarmbeitrag) und im Gefahrenmatrix-Paneel. Ist kein Pegel festgelegt, bleibt der Platz
   belegt: „kein Pegel festgelegt“ mit Weg zur Auswahl.
2. **Festlegen an zwei Stellen**: eigene Sektion der Einsatz-Einstellungen
   (`…/einstellungen/pegel`) **und** Schnellweg im Fachebenen-Inspector der Lagekarte an einem
   PEGELONLINE-Punkt.
3. **Prognose/Höchststand ist NICHT Teil dieses Tickets** → eigener Folgetask.
4. **Überblick (S2)**: die Warnstufen-Kennzahl bekommt die Pegel-Notiz zurück
   („Pegel 6,84 m steigend“).

## Datenquelle

PEGELONLINE REST v2 (gemessen 22.09.2026):

- Stationsliste: bereits als Fachebene `pegelonline` (`src/karte/quellen.rs`,
  `normalisiere_pegelonline`). Die Features tragen heute **keine** `uuid` — sie wird
  **additiv** als Property `uuid` ergänzt (Auswahlliste und Karten-Schnellweg brauchen sie).
- Zeitreihe je Station: `GET https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/{uuid}/W/measurements.json?start=PT3H`
  → `[{ "timestamp": "2026-09-22T09:15:00+02:00", "value": 63.0 }, …]`, 15-min-Raster,
  Einheit der W-Reihe ist **cm**. Unbekannte Station → 404 `{"status":404,"message":…}`.
  Der Trend liegt damit schon beim **ersten** Abruf vor (kein Sammeln über Polls).

## Backend

**Tabelle** `einsatz_pegel` (Migration `0103_einsatz_pegel.sql`):
`id`, `einsatz_id` (FK, `ON DELETE CASCADE`), `station_uuid TEXT NOT NULL`,
`name TEXT NOT NULL` (Snapshot zum Festlegen), `gewaesser TEXT`, `reihenfolge INTEGER NOT NULL`,
`gesetzt_von_id` (FK benutzer), `gesetzt_at`, `UNIQUE(einsatz_id, station_uuid)`.
Eigene Tabelle, **nicht** in `einsatz_einstellungen` — deren `PUT` ist Vollersatz (C10), ein
neues Feld dort würde von jeder anderen Sektion still genullt.

**Trend (rein, getestet):** lineare Regression (kleinste Quadrate) über die Messungen der
letzten **60 min** vor der jüngsten Messung, in cm/h, auf eine Nachkommastelle gerundet.
`None`, wenn weniger als zwei Messungen im Fenster liegen oder das Fenster weniger als
**30 min** überspannt. Eine Differenz „jetzt minus vor einer Stunde“ wäre gegen einen
einzelnen Ausreißer wehrlos.

**Abruf + Cache:** je Station über `karte::cache` (Schlüssel `pegel:<uuid>`), TTL 5 min,
Client aus `FachebenenState`. Scheitert der Abruf, wird der **alte** Cache-Eintrag
ausgeliefert (sein Messzeitpunkt ist der ehrliche Datenstand); ohne Cache fehlt die Messung.
Das Laden der Liste darf nicht an einem hängenden Abruf warten: Abrufe parallel, mit Timeout.

**Routen** (Gate `OhneModul` wie die Einsatz-Kopfdaten — die Kennzahl steht auf Dashboard
und Überblick, nicht nur auf der Karte; in `PFAD_KEY` als `None` eintragen):

| Methode | Pfad | Gate | Zweck |
|---|---|---|---|
| GET | `/api/einsaetze/{id}/pegel` | Lesezugriff | Liste in Reihenfolge, je Eintrag mit Messung |
| PUT | `/api/einsaetze/{id}/pegel` | Schreibzugriff | Liste vollständig ersetzen (Einstellungen: Hinzufügen, Entfernen, Umordnen) |
| POST | `/api/einsaetze/{id}/pegel` | Schreibzugriff | einen Pegel hinten anfügen (Karten-Schnellweg); schon vorhanden → 200 mit Bestand, idempotent |

Antwort-DTO `PegelAnzeige` (`ToSchema`, Codegen): `id`, `station_uuid`, `name`,
`gewaesser?`, `reihenfolge`, `messung?: { wasserstand_cm, zeitpunkt, trend_cm_pro_h? }`.
Optionale Felder mit `skip_serializing_if` (Norm LFH-265). **Kein** Richtungs-Enum auf dem
Draht — die Richtung formuliert das Frontend aus der Zahl.

Validierung (LFH-267): leere/zu lange `name` (> 200), keine UUID-Form, mehr als **5** Pegel
→ **400**; doppelte `station_uuid` in einer PUT-Liste → **422**.

**Live:** kein neues `LiveEvent`. Der Query-Key steht in `NICHT_LIVE_KEYS`, das Frontend
fragt alle 5 min nach (`refetchInterval`) — die Messwerte ändern sich ohnehin nur im
15-min-Raster, und die Festlegung ist selten.

## Frontend

- `api/pegel.ts` + `einsatzKeys.pegel(einsatzId)` (in `NICHT_LIVE_KEYS`).
- **Kennzahl** (`lage-dashboard/lagebild.ts`): `KENNZAHL_ETIKETTEN` =
  `['Pegel', 'Betroffene', 'Kräfte', 'Vermisste', 'Schäden offen', 'Einsatzdauer']`.
  Reine Funktion für die Pegel-Zelle, Leitpegel = erster in der Reihenfolge:
  - Messung da: Wert in **m** mit zwei Nachkommastellen („6,84“, Einheit „m“), Notiz
    „Weser · +9 cm/h · Stand 14:05“ (Gewässer, sonst Stationsname). Richtung als Wort, wo
    Platz ist (zweiter Kanal WCAG 1.4.1): „steigend“/„fallend“/„gleichbleibend“
    (|Trend| < 1 cm/h). Trend unbekannt → „Trend unbekannt“.
  - Messung älter als **60 min** → Datenstand als „veraltet“ markiert.
  - Festgelegt, aber keine Messung (Ausfall) → Wert „—“, Notiz „**Stand unbekannt**“ (AK).
  - Nichts festgelegt → Wert „—“, Notiz „kein Pegel festgelegt“, Ziel: Einstellungssektion.
  - Mehrere Pegel → Zusatz „+n weitere“.
  - Query-Fehler → Kennzahl-Zustand `fehler` (eigener Zustand, LFH-331).
- **Überblick** (`fuehrung/UeberblickPage.tsx`): Warnstufen-Notiz „Pegel 6,84 m steigend“
  aus derselben Funktion; ohne Pegel keine Notiz, bei Ausfall „Pegel: Stand unbekannt“.
- **Einstellungen**: Sektion `pegel` (`EinstellungenSektion`, Reiter „Pegel“), eigene Seite
  mit durchsuchbarer Auswahl über die Stationen der Fachebene `pegelonline`
  (Name · Gewässer · km), Liste mit Entfernen/Hoch/Runter, Speichern per PUT. Keine
  Vollersatz-Kopplung an `einsatzEinstellungenForm`. Ohne Schreibrecht: `RechteHinweis`,
  Knopf gesperrt (C10/M16).
- **Lagekarte**: `PegelInhalt` im `FachebenenInspector` bekommt „Als maßgeblichen Pegel
  festlegen“ (nur mit Schreibrecht und vorhandener `uuid`); ist er schon maßgeblich, steht
  das als Marke statt des Knopfs.
- Veraltete Kommentare „keine Datenquelle (LFH-606)“ in `LageDashboardPage.tsx`,
  `lagebild.ts`, `UeberblickPage.tsx` werden fortgeschrieben.

## Nicht Teil dieses Tickets

Prognose/erwarteter Höchststand (Folgetask), Modul „Wetter & Pegel“, Hochwasser-Meldestufen
am Pegel (`stateMnwMhw` bzw. LHP-Klassen) als Kennzahlfarbe.
