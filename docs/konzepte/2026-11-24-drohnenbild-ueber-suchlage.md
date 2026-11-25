# Drohnenbild in der Lage über Suchlage

Stand: 24.11.2026 · Machbarkeitsnotiz, kein Code · Zunder LLH-1202
(`https://zunder.rubeen.dev/#/aufgabe/a13wz4e6z0nvccikb8zrkzjt`), Teil von LLH-1191 (Stufe 3)

Gegenstück in Suchlage: `rubenvitt/suchlage`,
`docs/superpowers/specs/2026-11-24-lifeline-hub-schnittstelle-design.md` (SUL-49).

## Fazit

**Machbar, und zwar ohne eigenen Medienserver** (E9 in
[`2026-11-10-schnittstellen-ausbau.md`](2026-11-10-schnittstellen-ausbau.md)). Suchlage, unser
eigener Lagehub für die Drohne, nimmt das Bild der M350 schon an (MediaMTX), kennt Position und
Spur und legt Fotos mit Aufnahmeposition ab. Lifeline Hub wird **Abnehmer** von Suchlage:

- **Position, Spur und Suchgebiete** kommen über die vorhandene Bearer-Schnittstelle
  `/api/lagemonitor/v1/lage` von Suchlage. Diese Daten braucht Suchlage nicht neu zu bauen.
- **Livebild** als HLS über einen Proxy im Lifeline-Backend, als Fenster neben der Lagekarte
  **und** als Kachel auf dem Lagemonitor.
- **Standbilder** als Bildpunkte an der Aufnahmeposition. Dafür bekommt Suchlage einen kleinen
  Foto-Endpunkt (SUL-49). Lifeline Hub zeigt nur Vorschauen und speichert keine Kopie.

Anders als in der Aufgabe vermutet, ist das Livebild hier nicht der größere Brocken: Suchlage
trägt Annahme und Umwandlung bereits. Die meiste Arbeit liegt im Lifeline-Hub-Adapter und im
Player.

## Ausgangslage

- **Lifeline Hub** hat keinen Video-Code (kein hls.js, kein WebRTC, kein `<video>`) und liest kein
  GPS aus EXIF/XMP; `src/anhang/metadaten/` entfernt Metadaten nur. Der Adapter-Rahmen
  (`src/adapter/`, Regeln `src/AGENTS.md`, LLH-1632/LLH-2017) steht, hat aber noch keinen
  produktiven Adapter (`art::Verzeichnis::produktiv()` ist leer). LLH-1635 (EXIF der
  Kartenhintergründe) ist erledigt.
- **Suchlage** (`suchlage.iuk-ue.de`) bietet nach außen:
  - `/api/lagemonitor/v1/lage` mit Bearer-Großbild-Token: laufender Einsatz, `aircraft[]`
    (Position, Heading, Höhe, Akku, in der Luft), `videos[]` (nur laufende Streams), Karte als
    GeoJSON mit ETag (`?karte=aus|<etag>`), gzip; gedacht für Abruf alle 5 s
    (`src/web/lagemonitor.rs`, Vertrag `src/contract/lagemonitor.rs`).
  - `/api/lagemonitor/v1/video/{sn}/whep` und `/hls/{*file}` mit demselben Token; der Pfad hängt
    an der Seriennummer der Fernsteuerung.
  - Ohne CORS: Die Schnittstelle ist für Aufrufe von Server zu Server gedacht.
  - Token sind widerrufbar und wirken sofort, weil jede Anfrage sie neu prüft. Sie lesen alles
    oder nichts; als Zusatz gibt es bisher nur den Schalter `einsatztagebuch`.
  - Fotos (M3, `PhotoShot`: Position, Höhen, Gimbal, Linse Wärmebild/Weitwinkel/Zoom,
    Vorschau 640 px neu kodiert, also ohne EXIF) gibt es **nur** mit Sitzung, nicht per Bearer.
- **Netz:** WebRTC/WHEP von Suchlage braucht das I&K-Tailnet (UDP 8189). Von außen geht nur HLS
  über Cloudflare, mit 5–10 s Verzug.

## Entscheidungen (Ruben, 24.11.2026)

| # | Thema | Entscheidung |
| --- | --- | --- |
| D1 | Weg | **Über Suchlage**, kein eigener Medienserver, keine DJI-Anbindung in Lifeline Hub. |
| D2 | Fotos | **Suchlage-API erweitern** (SUL-49). Lifeline Hub zeigt Vorschauen über seinen Proxy und **speichert nichts**; Aufbewahrung und Löschung bleiben in Suchlage. |
| D3 | Einsatzbezug | **Je Einsatz zuschalten.** Die Org richtet die Anbindung „Suchlage“ ein; im Einsatz schaltet man „Drohnenbild aus Suchlage“ zu (`einsatz_anbindungen`). Gezeigt wird der gerade laufende Suchlage-Einsatz (Suchlage hat höchstens einen). Keine feste ID-Verknüpfung. |
| D4 | Lagemonitor | **Livebild gleich mit** als Kachel auf dem Lagemonitor, nicht erst später. |
| D5 | Ablage | Diese Notiz hier, das Mini-PRD für den Foto-Endpunkt in Suchlage. |

## Lösungsweg

### Vertrag „Drohnenquelle“ (herstellerneutral)

Im Kern steht kein „Suchlage“ und kein „DJI“ (Grundsatz „alles sind Adapter“). Der Vertrag
beschreibt eine Drohnenquelle eines Einsatzes:

- `fluggeraete[]`: Kennung, Bezeichnung, Position, Heading, Höhe, in der Luft, Datenstand
- `spuren` und `gebiete`: GeoJSON, nur lesend (Fremdebene, Vertrag „Geodaten“)
- `videos[]`: Kennung und Art (`hls`, später `whep`); die Adresse kennt nur der Server
- `fotos[]`: Kennung, Aufnahmezeit, Position, Linse, Blickrichtung

Profile: **Suchlage** zuerst; danach **reine HLS/WHEP-Adresse**, etwa das MediaMTX des Kunden,
in das jede Drohnen-App per RTMP sendet. Damit ist der Weg nicht an DJI gebunden. Der manuelle
Upload eines Fotos mit EXIF-GPS kommt ganz zuletzt und braucht einen GPS-Leser in
`anhang/metadaten`.

### Adapter „Suchlage“

- Eine neue `AdapterArt` im Adapter-Rahmen. Geheimnis je Org: das Großbild-Token, angelegt in
  Suchlage unter *Einstellungen → Großbild-Zugänge* mit dem neuen Schalter `photos` (SUL-49).
  Ziel ist `https://suchlage.iuk-ue.de`, HTTP nur über `adapter::ziel`, keine Weiterleitungen.
- `abrufen` holt `lage?karte=<etag>`, `uebernehmen` legt den letzten Stand **nur im Speicher**
  ab und nicht in der DB, weil nichts davon aufbewahrt werden soll. Den Zustand des Adapters
  zeigt die Seite „Anbindungen“ (G7).
- Der Takt richtet sich nach den zugeschalteten Einsätzen: Ist keiner zugeschaltet, ruft der
  Adapter nicht ab.
- Zu prüfen: Hält der Takt im Adapter-Rahmen 5 s aus, oder braucht die Lage einen eigenen,
  schnelleren Takt?

### Lagekarte

- Eine neue Fachebene `drohne` über den bestehenden Weg `/api/map/overlays/:quelle`, mit ETag und
  Datenstand wie die anderen. Das Fluggerät erscheint als Marke mit Blickrichtung, Spur und
  Suchgebiete als blasse Fremdebene, Fotos als Bildpunkte.
- Klickt man einen Bildpunkt, öffnet sich ein Popup mit der Vorschau, nach dem Muster des
  Webcam-Standbilds (`FachebenenInspector.tsx`). Die Vorschau läuft aber **über den Proxy** und
  nicht direkt aus dem Browser, weil Suchlage nur das Token kennt.
- Das Videofenster dockt neben der Karte an und lässt sich schließen. Läuft kein Stream, zeigt es
  „Kein Livebild“, statt einen Fehler zu werfen.

### Video-Proxy

- Neue Route `GET /api/incidents/{id}/drone/video/{key}/hls/{*file}`: Rechte wie die
  Lagekarte, nur bei zugeschaltetem Einsatz. Die Kennung ist eine eigene, die Seriennummer der
  Fernsteuerung erreicht den Browser nie.
- **Gleiche Herkunft** wie die App: Damit stören weder das fehlende CORS bei Suchlage noch die CSP
  der Tauri-Hülle (`src-tauri/tauri.conf.json`). Diese CSP braucht für hls.js (MSE) trotzdem
  `media-src 'self' blob:` und gegebenenfalls `worker-src 'self' blob:`; das ist zu prüfen und
  zusammen mit der offenen App-CSP (`src/AGENTS.md`) zu entscheiden.
- **Segment-Cache** im Proxy: Viele Zuschauer bedeuten nur einen Abruf bei Suchlage. Das ist die
  Antwort auf „Last im ELW-Netz“, denn ohne Cache vervielfacht jeder Bildschirm die Last auf der
  LTE-Strecke.
- Neue Abhängigkeit `hls.js` im Frontend. Safari spielt HLS nativ ab.
- WHEP (1–2 s) erst, wenn der Lifeline-Server im Tailnet steht (ELW/FüKw). Dann ist es ein eigener
  Schritt mit TURN/UDP-Frage.

### Lagemonitor (D4)

- Die Kachel „Livebild“ zeigt ein Bild ohne Bedienung, stummgeschaltet und mit Datenstand. Fällt
  das Bild aus, bleibt die Kachel mit „Kein Livebild“ stehen, ohne Alarm (eigene `KachelGrenze`).
- **Regeländerung nötig** in `frontend/src/geraet/AGENTS.md`: Bisher kommen alle Daten nur aus
  `situation-monitor`. Neu ist eine zweite Quelle: das Medium aus dem Video-Proxy. Welche Videos
  es gibt, steht als Kennungsliste (`drohne.videos`) in `situation-monitor`.
- **Personen im Bild** auf dem Großbild widersprechen dem Geist von „keine Personenkennungen“.
  Deshalb ist die Kachel **je Einsatz eigens zuzuschalten und steht standardmäßig aus**. Der
  Schalter sitzt bei der Einsatzleitung und ist unabhängig von der Lagekarte.
- Die Kachelung bei 1920 × 1080 bekommt mit Livebild einen eigenen Aufbau, etwa Karte und Video
  links übereinander oder das Video statt einer rechten Kachel. Das ist ein UI-Entwurf
  (`frontend/AGENTS.md`, „Größere UI-Entwürfe“).

## Datenschutz

- **Lifeline Hub hält nichts fest:** keine Kopie von Fotos, keine Aufzeichnung des Videos, der
  Lagestand der Drohne nur im Speicher. Damit braucht es keinen neuen Eintrag in der
  Schwärzung (`einsatz/schwaerzung_registry.rs`) und keinen `MODUL_LINKER`.
- Die **Aufbewahrung liegt bei Suchlage**, und dort gibt es bisher keine Löschfristen
  (Nicht-Ziel im Suchlage-Design vom 18.10.2026). Das ist eine Lücke in Suchlage, keine in Lifeline
  Hub. Sie ist dort als eigene Aufgabe zu schließen, bevor Bilder von Personen regelmäßig anfallen
  (Personensuche, Polizeiunterstützung).
- Vorschauen tragen kein EXIF (Neukodierung in Suchlage); der Proxy reicht nur das Bild durch,
  ohne Kopfzeilen von Suchlage.
- Lagemonitor siehe D4: standardmäßig aus.

## Schnitt und Reihenfolge

| # | Schritt | Repo | hängt ab von |
| --- | --- | --- | --- |
| 1 | Foto-Endpunkt und Token-Schalter `photos` (SUL-49) | suchlage | – |
| 2 | Vertrag „Drohnenquelle“ und Adapter „Suchlage“ (Lage, ohne Fotos) | lifeline-hub | – |
| 3 | Fachebene `drohne`: Fluggerät, Spur, Gebiete | lifeline-hub | 2 |
| 4 | Video-Proxy mit Segment-Cache und Videofenster an der Lagekarte | lifeline-hub | 2 |
| 5 | Fotos als Bildpunkte | lifeline-hub | 1, 3 |
| 6 | Lagemonitor-Kachel „Livebild“ samt Regeländerung und Schalter | lifeline-hub | 4 |
| 7 | Löschfristen für Fotos und Aufzeichnungen | suchlage | – |
| 8 | Profil „reine HLS/WHEP-Adresse“, später WHEP und manueller Foto-Upload mit EXIF-GPS | lifeline-hub | 4 |

Schritt 1 und 2 können parallel laufen. Der schnelle Gewinn ist 2 und 3: Die Drohne erscheint auf
der Lagekarte, ohne dass Suchlage etwas ändern muss.

## Risiken / Pre-Mortem

| Risiko | Umgang |
| --- | --- |
| LTE im FüKw trägt mehrere HLS-Zuschauer nicht | Segment-Cache im Proxy; Last messen bei der ersten Übung |
| Suchlage ist nicht erreichbar (VPN/LTE weg) | Adapter meldet den Zustand (G7), die Fachebene zeigt den Datenstand, das Videofenster „Kein Livebild“ |
| Großbild-Token leckt | nur im Geheimnisspeicher; in Suchlage sofort widerrufbar; Schalter `photos` begrenzt den Umfang |
| Suchlage ändert `lagemonitor/v1` | Vertrag trägt `api_version`; der Adapter lehnt unbekannte Versionen ab und meldet das |
| Instanzkopplung: Der ELW sieht nichts, wenn nur der Hub den Adapter hat | offen, siehe unten |
| Personen auf dem Großbild | Kachel je Einsatz zuschalten, Standard aus |

## Offene Punkte

- **Instanzkopplung (G5):** Läuft der Adapter am Hub, und bekommt der ELW Lage und Bild über die
  Kopplung? Oder hat jede Instanz ihre eigene Anbindung? Für das Video spricht viel für die
  eigene Anbindung am ELW, im Tailnet dann sogar mit WHEP.
- **Takt** des Adapter-Rahmens (5 s) und **CSP** der Tauri-Hülle für `blob:`, siehe oben.
- **Mehrere Drohnengruppen:** Eine Org mit mehreren Suchlage-Instanzen bräuchte mehrere
  Anbindungen je Einsatz. Das ist im Vertrag schon angelegt (eine Quelle je Anbindung), wird aber
  zuerst nicht gebaut.

## Referenzen (intern)

- Lifeline Hub: `docs/konzepte/2026-11-10-schnittstellen-ausbau.md` (E9, „Drohne (LLH-1202)“),
  `src/AGENTS.md` (Adapter-Rahmen, Anhänge, Schwärzung), `frontend/src/geraet/AGENTS.md`
  (Lagemonitor), `frontend/src/pages/lagekarte/AGENTS.md` (Fachebenen),
  `src/karte/copernicus.rs` (nächstes Vorbild für eine Fachebene aus Fremddaten).
- Suchlage: `docs/superpowers/specs/2026-10-16-suchlage-design.md`,
  `docs/adr/0003-broker-und-video-zugang.md`, `src/web/lagemonitor.rs`, `src/contract/photos.rs`,
  `docs/betrieb/runbook-deployment.md` (Großbild-Zugänge, Lagemonitor der IUK-Suite).
