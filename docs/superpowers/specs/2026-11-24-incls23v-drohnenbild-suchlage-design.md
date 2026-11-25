# Drohnenbild in der Lage über Suchlage – Design

- **Stand:** 24.11.2026 · Zunder LLH-2116 (`https://zunder.rubeen.dev/#/aufgabe/incls23vb9dij0ygtgles2kr`)
- **Umfang dieses Laufs:** LLH-2105 (Adapter), LLH-2106 (Fachebene), LLH-2107 (Livebild),
  LLH-2108 (Fotos). LLH-2109 (Lagemonitor) folgt in einem eigenen PR; hier steht nur, was er
  vorfindet.
- **Grundlage:** Konzeptnotiz [`docs/konzepte/2026-11-24-drohnenbild-ueber-suchlage.md`](../../konzepte/2026-11-24-drohnenbild-ueber-suchlage.md)
  (D1–D5), Phase-1-Checkpoint vom 24.11.2026, Suchlage-Schnittstelle aus SUL-49
  (`rubenvitt/suchlage`, `docs/superpowers/specs/2026-11-24-lifeline-hub-schnittstelle-design.md`, PR #40).

## 1. Zweck

Drohnengruppen fliegen bei Personensuchen und Großlagen. Ihr Bild läuft heute in Suchlage auf
einem eigenen Bildschirm neben Lifeline Hub. Die Einsatzleitung soll **Position, Flugspur,
Suchgebiete, Livebild und Fotos der Drohne in der Lagekarte ihres Einsatzes** sehen, ohne zweites
System und ohne dass Lifeline Hub Aufnahmen aufbewahrt.

**Erfolg:** In einem Übungseinsatz schaltet die Einsatzleitung „Drohnenbild aus Suchlage“ zu;
Fluggerät mit Blickrichtung, Spur und Suchgebiete erscheinen auf der Lagekarte, das Livebild
öffnet sich in einem Fenster über der Karte, ein Wärmebildfoto liegt als Bildpunkt an der
richtigen Stelle. Nach dem Abschalten ist nichts davon mehr da, auch nicht in der Datenbank.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- Ein herstellerneutraler Vertrag „Drohnenquelle“ im Kern; Suchlage ist das erste Profil.
- Zuschalten je Einsatz durch die Einsatzleitung; ohne Zuschaltung kein Abruf.
- Livebild für viele Zuschauer mit nur einem Abruf je Segment bei Suchlage (LTE im FüKw).
- Fotos nur als Vorschau, nur ab dem Zeitpunkt der Zuschaltung.

**Nicht-Ziele (dieser Lauf)**
- Lagemonitor-Kachel (LLH-2109, eigener PR), WHEP (LLH-2117), reine HLS-Adresse (LLH-2110),
  Foto-Upload von Hand (LLH-2118).
- Mehrere gleichzeitig zugeschaltete Drohnenquellen je Einsatz in der Oberfläche (Datenmodell
  erlaubt es, die UI zeigt die erste; siehe §9).
- Betrieb an einer Instanz, deren Org sich bei einem Hub meldet (siehe §8, Instanzkopplung).

**Anti-Ziele** (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Lifeline Hub speichert Bilder, Videos, Positionen oder Spuren der Drohne in der Datenbank.
- Eine Seriennummer von Fernsteuerung oder Fluggerät erreicht den Browser.
- Das Großbild-Token von Suchlage steht in Log, Fehlertext, Antwort oder bleibt entschlüsselt im
  Speicher liegen.
- Die offene, globale Route `/api/map/overlays` liefert Einsatzdaten.

## 3. Rahmenbedingungen

- Adapter-Rahmen: `src/adapter/` mit Regeln in `src/AGENTS.md`, „Backend — Adapter“, ADR-0077,
  ADR-0086, Design-Doc `2026-11-21-r19tuh60-adapter-rahmen-design.md`. Takt 5 s (`lauf::TAKT`),
  höchstens 4 parallel; nächster Abruf = Ende des Laufs + Intervall. Bei einer Org am Hub läuft
  kein Adapter (`lauf::is_org_am_hub`).
- Suchlage-Vertrag `lagemonitor/v1` (`suchlage/src/contract/lagemonitor.rs`): `LmLage` mit
  `api_version` (= 1), `server_time_ms`, `mission`, `map` (GeoJSON, fehlt bei passendem
  `?karte=<etag>`), `map_etag`, `aircraft[]` (`gateway_sn`, `label`, `position`, `heading_deg`,
  `elevation_takeoff_m`, `battery_percent`, `airborne`, `flight_id`), `videos[]`,
  `photos_latest_ms` (nur bei Token mit Schalter `photos`). Fotos: `GET /photos?since_ms=` →
  `LmPhotoShot { id: Zahl, taken_at_ms, position, relative_altitude_m, gimbal_yaw_deg,
  photos: [{ lens, thumb_url }] }`, `thumb_url` ist ein Pfad mit `?v=`. HLS:
  `GET /video/{gateway_sn}/hls/{*file}` mit `Cache-Control: private, no-cache`.
- Fachebenen (`/api/map/overlays/:quelle`) sind global und ohne Anmeldung, Spec
  `lagekarte-fachebenen`: nur amtliche und offene Quellen.
- `openspec/` ist eingefrorenes Archiv: neue Regeln gehen in AGENTS.md-Dateien bzw. ADRs.
- Routenwörter: jedes feste Segment steht in `scripts/api-routen-woerter.tsv`;
  `scripts/api-routen-bestand.txt` wächst nicht.
- DTOs mit `ToSchema` → `openapi.json` + `types.generated.ts` (`scripts/check-typ-codegen.sh`).

- **Benennung (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“, ADR-0097):** neue Routen liegen unter
  `/api/incidents/{id}/…` (`einsaetze` steht nicht im Glossar, der Bestand wächst nicht); neue
  Request-/Response-Typen und GeoJSON-Eigenschaften haben englische Wire-Felder (`kind`,
  `heading_deg`, `airborne`, `taken_at_ms`, `lens`, …). Deutsche Feldnamen in diesem Doc sind
  sinngemäß gemeint; maßgeblich sind die Namen im Plan.

## 4. Ansätze

Am Phase-1-Checkpoint entschieden (Ruben, 24.11.2026):

| Frage | Gewählt | Verworfen und warum |
|---|---|---|
| Wohin mit dem Lagestand | **Im Speicher der Art** (`fluechtig`), nichts in der DB | eigene Tabelle: widerspricht D2; Rahmen-Store: kein zweiter Nutzer, Traits nur bei zwei Implementierungen |
| Kartenroute | **Einsatzroute** `/api/incidents/{id}/map/drone` mit Antwortform und ETag der Fachebenen | `/api/map/overlays/drohne`: global und ohne Anmeldung, bricht die Fachebenen-Regel |
| Zuschalten | **Neue Tabelle `adapter_einsatz`** mit Flag `lagemonitor`, gesetzt von der Einsatzleitung | `einsatz_anbindungen`: gibt eingehende Maschinenzugänge frei, nicht Adapter; Flag in `einsatz_einstellungen`: falsches Recht, getrennt von der Zuschaltung |
| Token für Video und Fotos | **Live-Abruf außerhalb des Laufs** über `adapter::ziel`, Token je Abruf entschlüsselt, nie zwischengespeichert (ADR-Nachtrag) | Token im Speicher halten: verletzt ADR-0077; alles im Lauf vorladen: Video ist nicht vorladbar |
| Video | **HLS ohne Low-Latency** über Proxy mit Bündelung im Speicher | LL-HLS: Query-Parameter zerstören die Bündelung, Gewinn 3–5 s; WHEP: nur im Tailnet (LLH-2117) |
| Videofenster | **Schließbares Fenster über der Kartenspalte** | zweite Spalte: neue feste Breite in der Kartenspalte (`pages/lagekarte/AGENTS.md`) |
| Fotos | **Vorschau über Proxy, trotzdem bereinigt**, nur ab Zuschaltung | Bild direkt aus dem Browser: Suchlage kennt nur das Token, kein CORS |
| Abrufrate | **5 s**, Art-Flag `fluechtig` spart die Versuchszeile bei Erfolg | 10 s ohne Rahmenänderung: Drohne springt sichtbar; eigener Lauf: verboten |

## 5. Bausteine

```
Suchlage ──HTTPS/Bearer──▶ adapter::ziel ──▶ Art „suchlage“ ──▶ drohne::Speicher (RAM)
                              ▲     ▲                                 │
                 Lauf (5 s) ──┘     └── adapter::live (Video, Fotos)  │
                                                                      ▼
Browser ◀── /api/incidents/{id}/map/drone  (GeoJSON, ETag)  ◀── Lesezugriff + Zuschaltung
Browser ◀── /api/incidents/{id}/drone/video/{key}/hls/{*file} ◀── drohne::video (Bündelung)
Browser ◀── /api/incidents/{id}/drone/photos/{key}/thumb      ◀── bereinigt, kurz gecacht
```

### 5.1 Neutraler Vertrag `src/drohne/` (LLH-2105)

Neues Modul ohne Herstellernamen im Typ. Kern:

- `DrohnenLage { stand_ms, quelle_stand_ms, fluggeraete: Vec<Fluggeraet>, karte: Option<FeatureCollection>, videos: Vec<Video>, fotos: Vec<Foto> }`
- `Fluggeraet { kennung, bezeichnung, position: Option<[lon,lat]>, heading_deg, hoehe_m, akku_pct, in_der_luft }`
- `Video { kennung, art: VideoArt::Hls }`
- `Foto { kennung, aufgenommen_ms, position, linse, blickrichtung_deg, hoehe_rel_m }`

**Kennungen** sind eigene, stabile Schlüssel: die ersten 16 Hex-Zeichen von
`SHA-256(adapter_id ‖ ":" ‖ upstream_schluessel)`. Der Upstream-Schlüssel (Seriennummer der
Fernsteuerung, Foto-ID samt `thumb_url`) bleibt im `Speicher` und geht nie hinaus. Die Abbildung
Kennung → Upstream lebt nur im Speicher.

`drohne::Speicher` (in `AppState`, `Arc`): `Mutex<HashMap<adapter_id, Stand>>`, dazu die Menge der
zugeschalteten Adapter (`HashSet<adapter_id>`). `Stand` hält die `DrohnenLage`, den letzten
`map_etag` samt Karte (Suchlage lässt die Karte bei passendem ETag weg), den letzten
`photos_latest_ms` und die Abbildungen der Kennungen.

### 5.2 Art „suchlage“ (LLH-2105)

- `code = "suchlage"`, Feld `basis_url` (`Url`, Pflicht), Platz `token` (Pflicht),
  `intervall_min_s = 5`, `intervall_vorschlag_s = 5`.
- Die Art hält ein `Arc<drohne::Speicher>`. `Verzeichnis::produktiv()` bekommt ihn als Argument
  (Aufruf in `src/main.rs`; Tests bauen ihr Verzeichnis weiter selbst; der Test in
  `src/adapter/art.rs`, der ein leeres Verzeichnis erwartet, wird auf die Art „suchlage“
  umgestellt).
- **Quelle der Wahrheit für die Zuschaltung ist die DB** (`adapter_einsatz`); der Merker im
  Speicher ist nur ihr Abbild (Festlegung Builder-Check): `drohne::Speicher::laden` füllt ihn beim
  Start aus `adapter_einsatz` ⋈ laufende Einsätze, die Schreibwege (§5.3) setzen ihn sofort, und
  `uebernehmen` gleicht ihn in jedem Lauf mit derselben Abfrage ab (räumt ab, wenn der Einsatz
  inzwischen abgeschlossen ist).
- `abrufen`:
  1. Nicht zugeschaltet (`speicher.ist_zugeschaltet(adapter_id)` falsch) und kein Probelauf →
     `OhneUebernahme(0)` ohne Netz. (Nach einem Neustart greift das nicht fälschlich, weil
     `laden` den Merker vor dem ersten Lauf setzt.)
  2. `GET {basis_url}/api/lagemonitor/v1/lage?karte=<etag>` mit `Authorization: Bearer`, Deckel
     4 MiB. `api_version != 1` → `Fehlschlag(VersionUnbekannt)`.
  3. Hat sich `photos_latest_ms` gegenüber dem Stand geändert: `GET …/photos` (Deckel 2 MiB).
  4. Liefert eine `Uebernahme`, die die neue `DrohnenLage` trägt.
- `uebernehmen` (nach dem CAS des Laufs, in seiner Transaktion): fragt
  `SELECT EXISTS(…)` nach einer Zuschaltung an einem laufenden Einsatz, setzt damit den
  Zugeschaltet-Merker im Speicher (selbstheilend innerhalb eines Intervalls) und legt den neuen
  Stand in den Speicher. Schreibt nichts in die DB.
- Probelauf („Verbindung prüfen“) ruft `lage` ab und prüft die Version; nichts in den Speicher.
- **Rahmenänderung `fluechtig`:** neue Trait-Methode `fn fluechtig(&self) -> bool { false }`.
  Für Arten mit `true` (Festlegungen Builder-Check; andere Arten bleiben unverändert):
  - **Takt:** der nächste Abruf zählt ab dem **Beginn** des Laufs (`beginn + intervall`), nicht
    ab seinem Ende; so trifft ein 5-s-Intervall jeden Takt, statt jeden zweiten.
  - **Versuchszeile:** nach einem Erfolg schreibt `run_one` **keinen** `save_versuch`, außer der
    Lauf beendet eine Störung (`war_gemeldet`) oder der vorige Versuch war ein Fehlschlag; dann
    bleibt die Zeile, damit `AdapterWiederOk` (ADR-0086) seine `versuch_id` hat. `save_erfolg`
    (nächster Abruf, Zustand) bleibt immer. Fehlschläge werden wie bisher protokolliert.
- **Neuer Fehlercode** `AdapterFehler::VersionUnbekannt` (`version_unbekannt`),
  `braucht_eingriff = true`; Text in `benachrichtigung::adapter::fehler_text` und
  `frontend/src/api/adapter.ts` („Unbekannte Schnittstellenversion“), Enum-Kontrakt.
- Die Seite „Anbindungen“ zeigt die Art ohne eigenen Frontend-Code (Felder/Plätze sind generisch).

### 5.3 Zuschaltung je Einsatz (LLH-2105)

Migration: `adapter_einsatz(adapter_id TEXT NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
einsatz_id <Typ wie einsatz.id> NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
zugeschaltet_at TEXT NOT NULL, lagemonitor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (adapter_id, einsatz_id))`.
Kein Personenbezug in der Tabelle; wer zugeschaltet hat, steht im ETB (Systemeintrag
„Drohnenbild aus Suchlage zugeschaltet/abgeschaltet“).

Routen (Modul `lagekarte`, `PFAD_KEY`-Eintrag `/api/incidents/{id}/drone` und
`/api/incidents/{id}/map/drone`):
- `GET  /api/incidents/{id}/drone/sources` – Drohnenquellen der Org mit Zustand (Lesezugriff):
  je Quelle Bezeichnung, zugeschaltet an diesem Einsatz ja/nein, belegt durch einen anderen
  Einsatz (dessen Name, wenn der Nutzer ihn lesen darf; sonst nur der Hinweis `held_by_other_hidden`, angezeigt als „einem anderen Einsatz“),
  `lagemonitor`, Adapter-Zustand, Name des laufenden Suchlage-Einsatzes (`mission.name`) und die
  Video-Kennungen.
- `PUT  /api/incidents/{id}/drone/sources/{aid}` `{ lagemonitor: bool }` – zuschalten oder Flag
  ändern (`fordere_einsatzleitung`, aktiver Einsatz; Adapter derselben Org, Art mit
  Drohnenvertrag, sonst 422). **Exklusiv** (Ruben, 24.11.2026): Ist die Quelle an einem anderen
  laufenden Einsatz zugeschaltet, 409 mit Hinweis; eine Quelle gehört also höchstens einem
  laufenden Einsatz (Prüfung in der Schreibtransaktion; ein Teilindex o. Ä. ist dem Builder
  überlassen).
- `DELETE /api/incidents/{id}/drone/sources/{aid}` – abschalten (Einsatzleitung).
- Beide Schreibwege setzen den Merker im Speicher sofort; beim Abschalten des letzten Einsatzes
  leert der Speicher den Stand des Adapters.
- Eine Zuschaltung gilt nur, solange der Einsatz läuft; Abschluss und Löschung räumen über die
  Abfrage in `uebernehmen` bzw. `ON DELETE CASCADE` ab.

### 5.4 Fachebene „Drohne“ (LLH-2106)

- `GET /api/incidents/{id}/map/drone` (`EinsatzLesezugriff<Lagekarte>`): die **unveränderte**
  `FachebeneAntwort` über `fachebene_antwort` (ETag, 304), Status `ok`/`leer`/`offline` wie
  gehabt, `abgerufen` = Zeit des letzten Stands (Festlegung Builder-Check: kein neues Feld im
  gemeinsamen DTO; Videos und Missionsname liefert `GET …/drone/sources`, „veraltet“ leitet das
  Frontend wie bei allen Ebenen aus `abgerufen` und `veraltetNachMin = 1` ab). Ohne Zuschaltung
  oder ohne Stand: `offline`.
- **Umfang** (Ruben, 24.11.2026): alles des laufenden Suchlage-Einsatzes, auch von Flügen vor dem
  Zuschalten (Abdeckungsnachweis); nur Fotos erst ab Zuschalten. Features mit `art`:
  `fluggeraet` (Punkt, `heading_deg`, `in_der_luft`, `bezeichnung`), `spur` (Linie je Flug),
  `element` (Kartenelement aus Suchlage als Punkt, Linie oder Fläche, mit Bezeichnung) und
  `foto` (Punkt, `kennung`, `aufgenommen_ms`, `linse`, `blickrichtung_deg`), nur mit
  `aufgenommen_ms >= zugeschaltet_at` dieses Einsatzes. Unbekannte Feature-Arten aus Suchlage
  werden verworfen und gezählt (Probelauf zeigt die Zahl).
- Frontend: neue Quelle `drohne` in `FachebeneQuelle`/`FACHEBENEN` mit eigenem Lader auf die
  Einsatzroute (`queryKeys` mit Einsatz-ID), `pollMs = 5000`, `veraltetNachMin = 1`; Symbol
  Fluggerät mit Blickrichtung, Spur als Linie, Gebiete blass, Fotos als Bildpunkt; Gruppe „Drohne“
  in der Fachebenen-Leiste. Die Leiste zeigt der Einsatzleitung „Suchlage zuschalten“, wenn eine
  Drohnenquelle existiert und keine zugeschaltet ist, sonst den Zustand und „Abschalten“.

### 5.5 Livebild (LLH-2107)

- **`adapter::live`** (Rahmenänderung): `live_abruf(pool, rahmen, adapter_id) -> LiveKontext`
  liest Einstellungen und Chiffrat, entschlüsselt das Token **für genau diesen Abruf** und gibt
  einen Kontext mit `request`/`get` über `adapter::ziel` (Zielschutz, LAN-Regel, Deckel). Nichts
  davon wird zwischengespeichert. Nur Routen der Drohnenquelle nutzen ihn. **Kein Live-Abruf**
  (Festlegung Builder-Check), wenn der Adapter angehalten ist, einen Eingriff braucht
  (`zustand::braucht_eingriff`), der Geheimnisspeicher gesperrt ist oder die Org sich bei einem
  Hub meldet; dann 503 und im Fenster „Kein Livebild“ bzw. „Vorschau nicht abrufbar“.
- `GET /api/incidents/{id}/drone/video/{key}/hls/{*file}` (`EinsatzLesezugriff<Lagekarte>`,
  Zuschaltung des Einsatzes Pflicht, sonst 404): `key` → Adapter und `gateway_sn` aus dem
  Speicher, `file` nur `[A-Za-z0-9._-]`, Query wird verworfen.
- **`drohne::video::Buendel`:** In-Memory-Bündelung nach dem Muster `tile_cache::hole_gebuendelt`
  (`futures::Shared`): Schlüssel `(adapter_id, gateway_sn, file)`, TTL nach Endung (`.m3u8` 1 s,
  Segmente 30 s), Gesamtdeckel 64 MiB (älteste zuerst raus), Deckel je Antwort `DECKEL_VIDEO`
  8 MiB, Playlist 256 KiB.
- Playlists: nur relative URIs zulassen; eine absolute URI → 502 „Livebild nicht abrufbar“.
- Antwort: `Content-Type` fest nach Endung (`application/vnd.apple.mpegurl`, `video/mp4` für
  `.mp4`/`.m4s`, `video/mp2t` für `.ts`, sonst 404), `nosniff`, `Cache-Control: private, no-cache`
  für Playlists und `private, max-age=30` für Segmente, keine Kopfzeilen von Suchlage.
- Frontend: `DrohnenVideoFenster` über der Kartenspalte, schließbar, öffnet aus der Leiste bzw.
  vom Fluggerät; `hls.js` (dynamischer Import, `lowLatencyMode: false`), Safari nativ; stumm;
  „Kein Livebild“ ohne Fehlerton, wenn `videos` leer oder der Player aufgibt; neuer Versuch, wenn
  die Kennung wieder auftaucht. Der Baustein ist neu: Entwurf über `/design` nach
  `frontend/AGENTS.md`, „Größere UI-Entwürfe“.

### 5.6 Fotos (LLH-2108)

- `GET /api/incidents/{id}/drone/photos/{key}/thumb` (`EinsatzLesezugriff<Lagekarte>`,
  Zuschaltung Pflicht, Foto ab `zugeschaltet_at`, sonst 404): holt `thumb_url` über
  `adapter::live`, Deckel 2 MiB, **bereinigt mit `anhang::metadaten::bereinigen(…, "image/jpeg")`**
  (fail-closed 422), kurz im Speicher (5 min, Deckel 32 MiB).
- Antwort: `Content-Type: image/jpeg`, `inline`, `ANHANG_CSP`, `nosniff`,
  `Cache-Control: private, max-age=300`.
- Inspector: Popup mit Vorschau nach dem Muster `WebcamStandbild`, Linse, Aufnahmezeit,
  Blickrichtung; kein `AnhangVorschau` (kein Anhang).

## 6. Regeln, die sich ändern (E2)

- `src/AGENTS.md`, „Backend — Adapter“: flüchtige Arten (Übernahme in den Speicher, `fluechtig`);
  Live-Abruf außerhalb des Laufs über `adapter::live` (Token je Abruf, nie zwischengespeichert,
  nur für Routen der eigenen Art); Zuschaltung je Einsatz über `adapter_einsatz`.
- `src/AGENTS.md`, „Anhänge“: fremde, nicht gespeicherte Bilder (Drohnenvorschau) gehen bereinigt
  und mit `ANHANG_CSP` hinaus, nicht über `anhang_antwort`.
- `src/AGENTS.md`, CSP-Notiz: `media-src 'self' blob:`, `worker-src 'self' blob:` (hls.js).
- `frontend/src/pages/lagekarte/AGENTS.md`: einsatzbezogene Ebenen laden über die Einsatzroute,
  nie über `/api/map/overlays`.
- ADR (nächste freie Nummer, Nachtrag zu ADR-0077): „Adapter dürfen für ihre eigenen Routen
  außerhalb des Laufs abrufen; das Geheimnis wird je Abruf entschlüsselt.“ Verfahren nach
  `docs/architektur/AGENTS.md`.
- `scripts/api-routen-woerter.tsv`: `drone`, `sources`, `video`, `hls`, `photos`, `thumb`, soweit
  nicht vorhanden.

## 7. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Suchlage nicht erreichbar | Adapter-Zustand gestört (G7, Meldung nach ADR-0086); Karte zeigt „veraltet“ mit Datenstand, dann „offline“ |
| Token widerrufen (401/403) | `Abgelehnt`, braucht Eingriff; Video und Fotos 502, Fenster „Kein Livebild“ |
| Unbekannte `api_version` | `version_unbekannt`, Adapter hält an, Admins bekommen die Meldung |
| Kein laufender Suchlage-Einsatz | leere Lage, Karte „keine Drohne aktiv“ |
| Einsatz abgeschlossen | Zuschaltung wirkt nicht mehr; Routen 404, Speicher leert sich beim nächsten Lauf |
| Server-Neustart | Speicher leer; der Merker kommt mit dem ersten Lauf zurück (≤ 5 s + Lauf) |
| Bereinigung einer Vorschau scheitert | 422, Popup „Vorschau nicht abrufbar“ |

## 8. Sicherheit und Datenschutz

- Nichts aus Suchlage in der DB; `adapter_einsatz` trägt keinen Personenbezug. Kein
  `MODUL_LINKER`, kein Eintrag in der Schwärzung.
- Token nur im Geheimnisspeicher, je Abruf entschlüsselt; nie in Log, Fehler, Antwort.
- Seriennummern bleiben serverseitig (eigene Kennungen).
- Vorschauen werden in Lifeline Hub bereinigt, obwohl Suchlage neu kodiert.
- **Instanzkopplung:** An einer Org, die sich bei einem Hub meldet, läuft kein Adapter (bestehende
  Regel). Akzeptiert: Drohnenbild gibt es zunächst nur dort, wo der Adapter angelegt ist; eine
  Folgeaufgabe klärt den Weg über die Kopplung.

## 9. Dem Builder überlassen

- Schnitt der Commits (je Unteraufgabe mindestens einer, mit `Zunder:`-Zeile).
- Genaue Symbolik und Farben der Ebene im Rahmen von `theme/statusFarben.ts`/Tokens.
- Ob das Fenster mehrere Videos als Reiter zeigt; Datenmodell und Route können es.
- Zeitüberschreitung des Live-Abrufs (unter `REQUEST_BUDGET`), Größe der Caches im genannten Rahmen.
- Bei mehreren zugeschalteten Quellen zeigt die UI die zuerst zugeschaltete; die Route liefert alle.

## 11. Festlegungen aus dem Builder-Check (zum Gegenlesen)

Vom Entwurf selbst getroffen, nicht von Ruben: Takt ab Laufbeginn und Versuchszeile nur bei
Zustandswechsel für `fluechtig` (§5.2); DB als Quelle der Wahrheit für die Zuschaltung mit
Laden beim Start (§5.2); unveränderte `FachebeneAntwort`, Videos und Missionsname über
`…/drone/sources` (§5.3, §5.4); kein Live-Abruf bei angehaltenem oder gestörtem Adapter (§5.5).
Von Ruben am 24.11.2026 entschieden: Zuschaltung exklusiv (§5.3), Kartenumfang „alles des
Suchlage-Einsatzes, Fotos ab Zuschalten“ (§5.4).

## 10. Tests

- Reine Funktionen mit synthetischen Fixtures (`src/drohne/testdaten/`): Übersetzung `LmLage` →
  `DrohnenLage`, Kennungen stabil und ohne Seriennummer, ETag-Fortschreibung der Karte, Fotofilter
  ab Zuschaltung, Playlist-Prüfung, Content-Type nach Endung.
- Rahmen: `fluechtig` schreibt bei Erfolg keinen Versuch, bei Fehlschlag schon
  (`tests/adapter_lauf.rs` mit Testart).
- Routen: Zuschaltung (Rechte: nur Einsatzleitung schreibt, Beobachter liest; andere Org 404;
  falsche Art 422), Kartenroute mit eingespeistem Speicherstand (ETag/304, offline ohne
  Zuschaltung), Video- und Fotoroute ohne Zuschaltung 404. Live-Abruf über Loopback ist nicht
  testbar (Zielschutz); er bekommt Unit-Tests auf den reinen Teilen.
- `drohne::video::Buendel`: N gleichzeitige Anfragen → ein Abruf (Zähl-Fetcher), TTL, Deckel.
- Vorschau: synthetisches JPEG mit GPS-EXIF → Antwort ohne EXIF.
- Frontend: Konfiguration der Quelle (Poll unter TTL-Wächter), Fensterzustände (läuft, kein
  Livebild, geschlossen), Leiste mit/ohne Recht der Einsatzleitung.
- Guards: `einsatz_kontext_guard` (`PFAD_KEY`), Routenwörter, Typ-Codegen, Enum-Kontrakt.
