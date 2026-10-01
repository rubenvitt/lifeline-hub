# Design

## Context

Motivation steht in `proposal.md`, das Verhalten in den Delta-Specs (`lagekarte-ortssuche`,
`lagekarte-objektsuche`, `sprungpalette`). Vorhandene Bausteine:

- **Koordinaten erkennen:** `erkenneKoordinate` (`frontend/src/command-palette/koordinatenSprung.ts`)
  liest alle Formen an ihrer Gestalt, eng gegen Hausnummern und Uhrzeiten, MGRS mit Rückweg.
  Beschriftung über `formatiere` + `effektivesKoordinatenformat`.
- **Anfliegen:** `setFlyToZiel` in `LagekartePage.tsx` → `Kartenflaeche` (`map.flyTo`, Zoom 15).
  `?zentrum=` wird schon angeflogen und geräumt (LagekartePage, Effekt „Koordinatensprung“).
- **Objektsuche:** `MarkerSuche.tsx` filtert lokal (`gruppiereTreffer`, `objektsuche.ts`), ohne Enter-
  Verhalten und ohne Entprellung.
- **Geocoding im Backend:** nur Reverse (`src/geocoding/mod.rs`): prozessweiter `reqwest`-Client mit
  1500 ms Timeout und User-Agent, Token-Bucket 1/s, persistenter Cache in der Cache-DB,
  `geocoder_url` aus den Org-Einstellungen (Default `NOMINATIM_DEFAULT`).
- **Modul-Gate:** Routen unter `/api/einsaetze/{id}/karte` sind in `src/einsatz/modul.rs` dem Modul
  `lagekarte` zugeordnet; der Handler trägt `EinsatzLesezugriff<Lagekarte>`.
- **Leiste am Handschirm:** `useLeistenWahl` (`lagekarte/leistenWahl.ts`) kennt ein vorläufiges
  Öffnen (`zeige`, nicht gespeichert).
- **Fuß-Bänder:** `KartenFuss.tsx` stapelt schwebende Bänder (`bandStil`), Regel in
  `pages/lagekarte/AGENTS.md`.

## Goals / Non-Goals

**Goals:**
- Eine Eingabe auf der Karte für Objekt, Koordinate und Adresse; ein Codepfad für die Adresssuche
  (Feld und Palette landen beim selben Aufruf).
- Nominatim-Nutzungsregeln einhalten (≤ 1 Anfrage/s für Reverse und Forward zusammen, Cache,
  identifizierender User-Agent, kein Autocomplete).

**Non-Goals:**
- Routenführung (Wegbeschreibung, Anfahrt) — „Navigation“ heißt hier: die Karte an den Ort bringen.
- Objekt an der Suchnadel platzieren (am Checkpoint abgewählt).
- Adressfeld von Einsatzort/Schaden/UHS automatisch geokodieren (eigener Task, falls gewünscht).
- Offline-Adresssuche (ohne Geocoder gibt es keine; die Koordinatensuche bleibt offline nutzbar).

## Decisions

### D1 — Ein Feld: `MarkerSuche` wird zur Orts- und Objektsuche
Das Feld bleibt `MarkerSuche`, bekommt aber zwei Gruppen vor den Objektgruppen: „Koordinate“
(abgeleitet beim Rendern aus `erkenneKoordinate(suche)`) und „Adresse“ (Zustand der letzten
Enter-Suche). Die Erkennung wird aus `command-palette/koordinatenSprung.ts` nicht kopiert, sondern
nach `anzeige/koordinatenErkennung.ts` gehoben und von beiden importiert (Palette und Karte
erkennen dieselben Formen, eine Quelle). Die Lagekarte reicht der Suche ein Callback
`onOrtWaehlen({ lat, lon, beschriftung })` herein; die Suche selbst kennt die Karte nicht. Die
Beschriftung kommt aus `useAnzeigeKonventionen().formatKoordinate` (dieselbe Quelle wie die übrige
Karte). Die Adressabfrage lebt in einer Kindkomponente `AdressGruppe`, die nur bei einer laufenden
Enter-Suche existiert: ohne Ortssuche braucht `MarkerSuche` keinen `QueryClientProvider`.
*Alternative:* eigenes schwebendes Feld über der Karte — am Checkpoint abgewählt (neue
Überlagerung, konkurriert am Handschirm mit Fuß und Knopfspalte).

### D2 — Adresssuche: Enter, gebunden an den gesuchten Begriff
Der Zustand der Adresssuche ist `{ begriff, ergebnis }` über einen TanStack-Query mit Schlüssel aus
`queryKeys.ts` (`einsatzKeys.ortSuche(einsatzId, begriff)`, nicht live, nicht im Lagebild offline), `enabled` erst nach Enter. Ändert sich der
Text, ist `begriff !== suche.trim()` und die Gruppe „Adresse“ wird nicht mehr gezeigt (Spec:
Weitertippen verwirft). Der Query-Cache hält gleiche Begriffe mit `ok` frisch (`staleTime` 10 min),
ein zweites Enter auf denselben Begriff fragt dann nicht erneut. „ausgelastet“, „nicht erreichbar“
und ein Serverfehler sind sofort veraltet, und ein neues Enter fragt neu (Review: der Hinweis „gleich
erneut Enter drücken“ muss stimmen). Genau ein Treffer → `onOrtWaehlen` direkt, einmal je Enter;
ein Fehlzustand verbraucht das Enter nicht. Die Vorbelegung aus `?ort=` räumt die Seite nach der
Übernahme (`onVorbelegungVerbraucht`), sonst übernähme ein neu eingehängtes Suchfeld sie erneut.

### D3 — Suchnadel als GeoJSON-Ebene ohne Klickrolle
Die Suchnadel ist eine eigene GeoJSON-Quelle `suchnadel` mit Symbol-/Kreis-Ebene, gebaut wie
`eigenpositionLayer.ts` (Wiederherstellung nach `setStyle` über denselben Render-Poller). Sie hat
**keine** Rolle in `ordneKlickebene` und keinen Trefferzonen-Layer, damit ein Tipp das Ziel darunter
trifft (Spec „kein Klickziel“; `pages/lagekarte/AGENTS.md`, „Ein Tipp gehört genau einem Ziel“, wird
nicht berührt). Zustand `suchnadel: { lat, lon, beschriftung } | null` lebt in `LagekartePage`, nicht
in Ansicht oder Snapshot.
Die Beschriftung und „Suchnadel entfernen“ stehen in einem Band in `KartenFuss` (`bandStil('links')`),
nicht als Popup an der Nadel: ein Popup wäre ein Klickziel auf der Karte und verdeckte Marker; das
Band folgt der Stapelregel (LFH-355) und ist am Handschirm erreichbar.
*Alternative:* DOM-`Marker` von MapLibre — verworfen, er fängt Zeigerereignisse ab und wäre damit
eine Klickebene.

### D4 — Deeplinks: `?zentrum=` setzt die Nadel, `?ort=` startet die Suche
`lagekartePfad` bekommt `ort?: string`. Der bestehende `?zentrum=`-Effekt setzt zusätzlich die
Suchnadel (Beschriftung = Koordinate im wirksamen Format). Ein neuer Effekt nach demselben Muster
(`if (ladt) return`, danach räumen) übergibt `?ort=` an die Suche als Vorbelegung samt ausgelöster
Adresssuche und öffnet die Leiste per `zeige()` (vorläufig, nicht gespeichert, wie LFH-765 es für
Handschirme vorsieht). Die Vorbelegung geht als Prop `vorbelegung: { text, nonce }` an `MarkerSuche`
(Nonce, damit derselbe Text zweimal hintereinander wirkt).

### D5 — Palette: Zeile springt, sucht nicht selbst
Neue Gruppe `ortssuche` in `BefehlGruppe` (exhaustive Records `GRUPPE_MERKBAR` = false,
Beschriftung „Adresse“). Die Zeile entsteht in einem Hook neben `useKoordinatenSprung` (gleiche
Rechteprüfung, gleiche Lazy-Abfrage), steht **am Ende** der Treffer und ist nie vorausgewählt — auch
allein nicht (dann ist nichts markiert, ↓ wählt sie; Review-Befund: eine schnell getippte Kennung
mit ↵ landete sonst auf der Karte, bevor die Datensätze da sind), damit ↵ weiter den besten
Datensatz öffnet und navigiert per `sprungZu(lagekartePfad(id, { ort }))`. Damit
gelten ↵, Strg/⌘+↵ und Gedächtnisregeln wie für jede Navigationszeile, und die Adresssuche hat
genau einen Aufrufer (die Karte).
*Alternative:* Geocoding in der Palette mit Trefferliste — verworfen: die Palette sucht live und
entprellt, eine Enter-Semantik und der Lade-/Fehlerzustand müssten dort ein zweites Mal entstehen.
*Alternative:* eigener Präfix-Modus (etwa `!`) — verworfen: zusätzliche Schreibweise, die niemand
kennt; die Zeile am Ende kostet nichts.

### D6 — Backend: `GET /api/einsaetze/{id}/karte/ort-suche?q=`
- **Route** in `src/routes/karte_ort_suche.rs`, Handler mit `EinsatzLesezugriff<Lagekarte>` (der
  Präfix `/karte` ist in `modul.rs` schon `lagekarte`). Validierung: `q` getrimmt 3–200 Zeichen,
  sonst `AppError::Validation` (400, `src/AGENTS.md` Statuscode-Konvention).
- **Antwort** `OrtSucheAntwort { zustand: OrtSucheZustand, treffer: Vec<OrtTreffer> }`,
  `OrtSucheZustand = ok | ausgelastet | nicht_erreichbar` (leere Treffer bei `ok` = nichts
  gefunden), `OrtTreffer { lat, lon, name }`. Immer 200, wie die Ort-Vorschau: der Geocoder ist
  Beiwerk, sein Ausfall ist kein Fehler der Anfrage. Typ-Codegen nachziehen.
- **Geocoding** `geocoding::suche_mit(...)` neben `reverse_mit`: `GET {base}/search?q=…&format=jsonv2&
  limit=5&accept-language=de[&viewbox=…&bounded=0]`. Der Token-Bucket wird **geteilt** (dasselbe
  `statics().bucket`), weil das Limit des Dienstes für die Anwendung gilt, nicht je Endpunkt.
  Kein Token → bis zu 1 s auf das nächste warten (die Suche ist eine bewusste Handlung, ein
  sofortiges „ausgelastet“ wäre nach einer Ort-Vorschau fast die Regel), danach `ausgelastet`.
- **Einsatzumgebung:** Liegt der Einsatzort vor (`geocoding::marker::lade_marker`, Typ
  `einsatzort`), geht eine `viewbox` von ±0,25° (~25 km) mit `bounded=0` mit: bevorzugen, nicht
  ausschließen. Mehr verlässt den Server nicht (Spec „Datenschutz“).
- **Cache:** prozessweiter In-Memory-Cache (Schlüssel: normalisierter Begriff + Viewbox, 24 h, höchstens
  500 Einträge, ältester fliegt). Nur `ok`-Antworten werden gecacht.
  *Alternative:* Tabelle in der Cache-DB wie `geocoding_cache` — verworfen: Vorwärtssuchen sind
  selten und handgetrieben, ein persistenter Cache brächte Schema-Pflege (operative Migration für
  die Repo-Tests) ohne Nutzen über einen Neustart hinaus.

### D7 — Wo die Regel steht
`pages/lagekarte/AGENTS.md` bekommt einen Punkt „Ortssuche“ (Suchnadel keine Klickebene, Band im
Fuß, Adresssuche nur auf Enter, Verweis auf diese Change bzw. ihr Archiv);
`command-palette/AGENTS.md` einen Satz zur Adresszeile (springt, sucht nicht). Der Datenschutz-
Hinweis im Kopf von `src/geocoding/mod.rs` wird um die Vorwärtssuche ergänzt.

## Risks / Trade-offs

- [Öffentlicher Nominatim lehnt Last ab oder sperrt] → geteiltes Limit 1/s, Cache, User-Agent;
  Admins können einen eigenen Geocoder eintragen (bestehende Einstellung). Zustand
  `ausgelastet`/`nicht_erreichbar` statt Fehler.
- [Photon oder andere Dienste sprechen kein Nominatim-`/search`] → bestehende Einschränkung der
  `geocoder_url` (Nominatim-kompatibel); im Modulkopf benannt, nicht gelöst.
- [Suchtext ist personenbezogen, z. B. Adresse einer betroffenen Person] → geht nur an den
  eingestellten Geocoder, wird serverseitig nicht protokolliert (nur `debug`-Log bei Fehlern, ohne
  Suchtext) und nicht persistiert.
- [Palettenzeile bei jeder Texteingabe] → nur mit Buchstabe, ab drei Zeichen, am Ende der Liste;
  sie verdrängt keinen Treffer.
- [Leerzustand der Objektsuche widerspricht Ortsgruppen] → MODIFIED-Requirement in
  `lagekarte-objektsuche` legt den knappen Hinweis fest.

## Migration Plan

Keine Datenmigration. Rückbau: Route und Frontend-Teile entfernen; `?zentrum=` fällt auf reines
Anfliegen zurück.
