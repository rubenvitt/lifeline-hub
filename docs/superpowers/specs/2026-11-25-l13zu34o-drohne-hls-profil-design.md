# Drohnenquelle „reine HLS-Adresse“ — Design

Stand: 25.11.2026 · Zunder LLH-2110 (`https://zunder.rubeen.dev/#/aufgabe/l13zu34ormzjup8syaxj7ttj`),
Schritt 8 aus `docs/konzepte/2026-11-24-drohnenbild-ueber-suchlage.md` · baut auf LLH-2105
(Drohnenvertrag, Adapter „suchlage“) und LLH-2107 (Video-Proxy, Bündel, Videofenster) auf.
Lösungsweg abgestimmt mit Ruben am 25.11.2026 („passt“ zu Punkt 1a–5).

## Warum

Das Livebild der Drohne soll nicht an DJI und nicht an Suchlage hängen. Viele Kunden betreiben
ein eigenes MediaMTX, in das jede Drohnen-App per RTMP sendet. Lifeline Hub soll dessen
HLS-Ausgabe wie das Bild aus Suchlage im Videofenster der Lagekarte zeigen, ohne eigenen
Medienserver und ohne Telemetrie.

## Ziele

- Eine Org legt unter „Anbindungen“ eine Anbindung **„Drohnenbild (HLS-Adresse)“** an: Adresse
  der Playlist, optional Benutzer und Passwort.
- Sie wird je Einsatz zugeschaltet wie „Suchlage“ (`adapter_einsatz`, gleiche Routen, gleiche
  Regeln: höchstens ein laufender Einsatz hält sie).
- Das Videofenster spielt das Bild über den bestehenden Proxy
  `GET /api/incidents/{id}/drone/video/{key}/hls/{file}` mit Segment-Bündel.
- Ein MediaMTX im LAN ist erreichbar: mit der LAN-Ausnahme des Adapters, und mit `http` nur zu
  einem privaten IP-Literal.

## Nicht-Ziele

- WHEP, Foto-Upload mit EXIF-GPS (eigene Aufgaben), Telemetrie, Marke auf der Karte.
- Lagemonitor-Kachel (Schritt 6); sie bekommt das Bild automatisch, sobald sie Videokennungen liest.
- Playlists, die auf fremde Hosts oder andere Verzeichnisse zeigen (CDN).
- Änderungen im Frontend außer dem, was über die Felder der Art von selbst entsteht, und einem
  Hinweistext (s. u.).

## Anti-Ziele

- Ein Weg, über den der Server ungeprüft ins Netz ruft: jede Anfrage geht über
  `adapter::ziel` und `check_url`, nie über den Client von `karte::proxy`.
- `http` zu einem Hostnamen: ein Name, der auf eine öffentliche Adresse zeigt, darf nie
  unverschlüsselt ins Internet rufen.
- Eine Anbindung, die jedes Mal auf „gestört“ geht, wenn die Drohne landet.
- Etwas aus dem Livebild in der Datenbank (die Art ist flüchtig).

## Ansätze

| | Weg | Abwägung | Wahl |
| --- | --- | --- | --- |
| 1a | **Eigene Adapterart `hls_adresse`** | Eigene Felder, Plätze und Abruf; der Rahmen ist je Art gebaut, „neues Ziel löscht Geheimnisse“ gilt ohne eigenen Code. Kosten: `drohne::ART` wird zu einer Menge, Live-Abrufe nehmen die Art des Adapters. | **gewählt** |
| 1b | Profilfeld an „suchlage“ | Formular mit je Profil wechselnden Pflichtfeldern, ein Abruf mit zwei Zweigen. | verworfen |
| 3a | **`http` nur bei LAN-Ausnahme und privatem IP-Literal, nur für Arten, die es erlauben** | Passt zum typischen MediaMTX (`http://…:8888`); Klartext bleibt im LAN. Ändert eine Regel (E2). | **gewählt** |
| 3b | nur `https` | Verlangt beim Kunden einen Reverse-Proxy mit gültigem Zertifikat. | verworfen |
| 3c | `https` mit hinterlegtem Zertifikats-Fingerabdruck | Sauber, aber eigener TLS-Prüfer und Bedienung für den Fingerabdruck. | verworfen (später möglich) |
| 4a | **Umschreiben auf Dateien im selben Verzeichnis desselben Hosts** | MediaMTX passt ganz hinein; Proxy-Route bleibt unverändert; kleine Angriffsfläche. Gilt für beide Arten. | **gewählt** |
| 4b | Kennungen ausgeben wie `rewrite_style` (beliebige geprüfte URLs) | Kann CDN, braucht aber Slot-Speicher und mehr Code für einen Fall, den niemand hat. | verworfen |

## Entwurf

### Adapterart `hls_adresse` (`src/drohne/hls.rs`)

- `code` `hls_adresse`, Bezeichnung „Drohnenbild (HLS-Adresse)“, `fluechtig() = true`,
  Intervall min. 5 s, Vorschlag 5 s.
- Felder: `playlist_url` (`FeldTyp::Url`, Pflicht, max 512, Bezeichnung „Adresse der Playlist“),
  `benutzer` (`FeldTyp::Text`, optional, max 128).
- Platz: `passwort` (optional, Bezeichnung „Passwort“). Mit `benutzer` und `passwort` geht
  Basic-Auth an das Ziel (`RequestBuilder::basic_auth`); fehlt eins, keine Anmeldung.
- `abrufen` (Muster `SuchlageArt`): nicht zugeschaltet und kein Probelauf → `OhneUebernahme(0)`.
  Sonst `GET playlist_url`, Deckel `DECKEL_PLAYLIST`, Playlist mit `rewrite_playlist` (s. u.)
  prüfen.
  - **200 und gültig** → `DrohnenLage` ohne Fluggeräte, Karte, Fotos, mit genau einem Video
    `{ key, art: hls }`. Die Kennung ist fest und undurchsichtig je Adapter (abgeleitet aus der
    Adapter-ID, z. B. gekürzter SHA-256 mit festem Präfix), damit das Videofenster über Takte
    hinweg denselben Schlüssel sieht und die Adresse den Browser nie erreicht.
  - **404** → Lage ohne Video, **kein Fehlschlag** („kein Stream“: MediaMTX baut den Pfad ab,
    wenn nichts sendet).
  - Alles andere → `Fehlschlag` wie im Rahmen (`fehler_aus_status`, Verbindung, Deckel,
    ungültige Playlist → `AntwortUngueltig`).
  - Probelauf: derselbe Abruf, Store bleibt unberührt; 404 gilt auch hier als Erfolg (Ziel
    erreichbar, nur kein Stream).
- `uebernehmen` wie bei Suchlage: Zuschaltung aus der DB, dann `store.put`; `geaendert`, wenn
  sich die Videoliste ändert.
- Im Verzeichnis `art::Verzeichnis::produktiv()` neben `suchlage`.

### Drohnenarten als Menge (`src/drohne/mod.rs`)

- `ART` weicht `ARTEN: &[&str] = &["suchlage", "hls_adresse"]`; `is_drohnen_art` prüft darauf.
- `Upstream.videos` bleibt `key → Pfadteil`. Für `hls_adresse` ist der Wert leer; der Abruf
  kennt die Playlist-Adresse aus den Einstellungen.
- Die Routen `video` und `foto_vorschau` nehmen zu `find_video` die Art des Adapters (aus dem
  Store-Stand oder `adapter_repo`) und übergeben sie an `live_kontext`; der Abruf verzweigt nach
  Art:
  - `suchlage`: wie heute (`{basis}/api/lagemonitor/v1/video/{sn}/hls/{file}`, Bearer).
  - `hls_adresse`: `file` gegen das Verzeichnis von `playlist_url` auflösen (Ergebnis muss
    Host, Port, Schema und Verzeichnis-Präfix der Playlist behalten), Basic-Auth wie oben.
  - Fotos gibt es nur bei `suchlage`; `foto_vorschau` bleibt fest an `suchlage`.

### `http` im LAN (`src/adapter/ziel.rs`, `src/adapter/art.rs`)

- `AdapterArt::http_im_lan(&self) -> bool`, Standard `false`; nur `hls_adresse` sagt `true`.
- Eine neue Prüfung im Adapter-Rahmen (z. B. `ziel::check_adapter_url(url, lan_erlaubt,
  http_im_lan)`) ruft `check_url` und lässt `ZielFehler::NichtHttps` nur durch, wenn alles gilt:
  Schema `http`, `http_im_lan`, `lan_erlaubt`, Host ist ein **IP-Literal** der Klasse `Privat`
  (`ausgehend::zieladresse::klasse`: RFC 1918, 100.64/10, fc00::/7). Alle anderen Prüfungen von
  `check_url` (keine Anmeldedaten in der URL, kein Anker, kein Loopback/Link-local) bleiben.
- Sie gilt an beiden Stellen, an denen eine Adapter-URL geprüft wird: `check_einstellungen`
  (Feld `FeldTyp::Url`) und `AbrufKontext::request`. `AbrufKontext` bekommt das Flag aus der Art
  (Lauf und `live_kontext`).
- Der Resolver bleibt: ein IP-Literal wird nicht aufgelöst, Loopback und Link-local sperrt
  `check_url` schon.
- Fehlertext bei `http` ohne Erfüllung: „Die Adresse muss mit https:// beginnen; http:// nur zu
  einer privaten IP-Adresse mit LAN-Ausnahme.“

### Playlist umschreiben (`src/drohne/video.rs`)

- `rewrite_playlist(bytes, playlist_url: &Url, lan_erlaubt, http_im_lan) -> Result<Bytes,
  VideoFehler>` ersetzt `check_playlist`. Für jede URI-Zeile und jedes `URI="…"`
  (`#EXT-X-MAP`, `#EXT-X-MEDIA`, `#EXT-X-PART`, `#EXT-X-PRELOAD-HINT`, `#EXT-X-I-FRAME-STREAM-INF`,
  `#EXT-X-SESSION-DATA`/`-KEY` nur mit `URI`):
  1. gegen `playlist_url` auflösen (`Url::join`),
  2. mit der Adapter-Prüfung oben prüfen,
  3. Schema, Host, Port gleich der Playlist; Pfad im selben Verzeichnis; letztes Segment ein
     sicheres Segment (`is_safe_segment`) mit einer Endung, die `ttl_for` kennt,
  4. durch den bloßen Dateinamen ersetzen; eine Query der URI fällt weg.
  Eine einzige URI, die das nicht erfüllt, macht die ganze Playlist ungültig
  (`VideoFehler::Upstream`).
- `#EXT-X-KEY` mit `METHOD=AES-128`/`SAMPLE-AES`: Schlüssel-URIs werden **abgelehnt** (Endung
  ist kein Medientyp), die Playlist ist dann ungültig. MediaMTX verschlüsselt nicht.
- Für `suchlage` ist `playlist_url` die Adresse, unter der die Datei abgerufen wurde; deren
  Playlists sind relativ und bestehen unverändert.

### Frontend

- Keine eigene Komponente: Die Art erscheint im Anbindungs-Formular über `felder`/`plaetze`.
- Hinweis am Feld der Playlist (Hilfetext der Art, falls der Rahmen einen hat; sonst im
  Formular über den Code der Art): „Bei http:// gehen Benutzer und Passwort unverschlüsselt durchs
  LAN.“ — Ort entscheidet der Builder nach dem, was das Formular schon trägt.
- Fachebene „drohne“: eine Quelle ohne Fluggeräte liefert eine leere Ebene, keine Fehlermeldung.

### Regeln und Doku

- `src/AGENTS.md`, Abschnitt Adapter: Regel „`http` nur für Arten mit `http_im_lan`, nur mit
  LAN-Ausnahme und privatem IP-Literal“; Drohnenarten als Menge (`drohne::ARTEN`).
- ADR für die `http`-Ausnahme (E2, Sicherheitsregel), Nummer nach
  `docs/architektur/AGENTS.md`; Mitänderung arc42 (`05-bausteinsicht.md` nennt Suchlage).
- Anwenderdoku: Kapitel zu Anbindungen/Drohnenbild um die neue Art ergänzen, falls vorhanden
  (Wächter nach `docs/anwender/AGENTS.md`).

## Tests (Kern)

- `rewrite_playlist`: MediaMTX-Multivariant und Medienplaylist (relativ) → Dateinamen; absolute
  URL ins selbe Verzeichnis → Dateiname; fremder Host, anderer Port, Unterverzeichnis, `..`,
  `data:`, Schlüssel-URI → Fehler; Query fällt weg.
- `check_adapter_url`: `http://10.0.0.5:8888/x` nur mit beiden Flags; `http://mediamtx.lan/x`,
  `http://8.8.8.8/x`, `http://127.0.0.1/x`, `http://169.254.1.1/x` immer abgelehnt; `https` wie
  bisher; Suchlage (ohne `http_im_lan`) lehnt `http` ab.
- `hls_adresse::abrufen` gegen einen Test-Server: 200 → ein Video mit fester Kennung; 404 → kein
  Video, kein Fehlschlag; 500 → Fehlschlag; Basic-Auth nur mit beiden Werten.
- Route `video` mit einer zugeschalteten `hls_adresse`: Playlist umgeschrieben, Segment
  durchgereicht; Videokennung eines Adapters einer anderen Art oder Org → 404.
- Bestehende Suchlage-Tests bleiben grün.

## Dem Builder überlassen

- Genaue Ableitung der Videokennung, Dateiaufteilung, Name der neuen Prüffunktion.
- Ob die Art des Adapters für den Abruf aus dem Store-Stand oder der DB kommt (DB ist
  maßgeblich; `live_kontext` prüft ohnehin).
- Ort des Hinweistexts im Formular.
