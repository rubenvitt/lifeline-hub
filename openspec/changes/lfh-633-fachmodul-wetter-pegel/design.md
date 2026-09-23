# Design

## Context

Die Anforderungen stehen in `specs/lage-wetter-pegel/spec.md`, die Motivation in
`proposal.md`. Maßgeblich für den Entwurf ist der Bestand am 23.09.2026 (`origin/alpha`
`cd7fef07`).

**Pegel (LFH-606/628).** `src/pegel/abruf.rs` holt je Station
`…/W/measurements.json?start=PT3H` und legt die geparste Reihe als `Vec<Messpunkt>` unter
`pegel:<uuid>` in den Nachschlage-Cache. Der Cache arbeitet stale-while-revalidate:

- TTL 5 min;
- höchstens ein Abruf je Station;
- 60 s Abkühlung nach einem Fehlschlag.

`trend::messung_aus_reihe` reduziert die Reihe auf den jüngsten Punkt samt Trend über
60 min. Die Reihe selbst verlässt das Backend nicht. Alle Pegel-Routen tragen
`OhneModul`. Im Frontend enthält `pegel/pegelKennzahl.ts` die geteilte Ableitung: Meter,
Trendwort, „veraltet“ ab 60 min, „Stand unbekannt“ und Prognosetext.

**DWD heute.** Die Kartenfachebene `dwd` reicht die bundesweite WFS-Antwort
`Warnungen_Gemeinden_vereinigt` roh durch (`src/karte/quellen.rs:100-128`). Dabei gilt:

- Sie hat keinen Gebietsfilter und wertet `ONSET`/`EXPIRES` nicht aus.
- `stand` ist immer `None`.
- Ein veralteter Cache kommt ohne Alter und mit Status `ok` zurück, bis zu 2 Tage lang.
- Das Backend hat keinen Punkt-in-Polygon-Code und kein Geo-Crate.
- Die Ebene trägt keinen Gemeindenamen.

**Bright Sky** (`https://api.brightsky.dev`) ist öffentlich, braucht keinen Schlüssel und
beruht auf DWD-Open-Data. Es gelten die Nutzungsbedingungen des DWD. Gemessen am 23.09.2026:

- `GET /alerts?lat&lon` liefert die Warnungen der Gemeinde-Warnzelle des Punkts und dazu
  `location {warn_cell_id, name, district, state}`.
- `GET /weather?lat&lon&date&last_date` liefert Stundenwerte aus MOSMIX, 25 Einträge für
  24 h. Die Einheiten laufen in der Vorgabe `dwd`: °C, mm, km/h, %.
  Die Antwort nennt außerdem `sources[] {station_name, distance, observation_type}`.

## Goals / Non-Goals

**Goals:**

- Eine Seite beantwortet „steigt das Wasser, kommt Wetter?“ für den Einsatzort, ohne die
  Lagekarte zu öffnen.
- Jeder Teil trägt ehrlich seinen Stand. Ein Ausfall eines Teils lässt die anderen stehen.
- Die Pegel-Ableitung wird wiederverwendet, keine zweite Wahrheit neben `pegelKennzahl.ts`.

**Non-Goals:**

- Die DWD-Kartenebene bleibt unverändert: gleiche Quelle, kein Filter, kein Stand. Die
  fehlende Alterskennzeichnung dort ist ein eigener Befund und wird als Folgeticket erfasst.
- Kein Modulzähler (etwa „2 Warnungen“) und kein Alarm-Toast bei neuer Unwetterwarnung.
  Beides wäre eine eigene Entscheidung über das Alarmbudget (EEMUA 191).
- Keine Vorhersage-Kurve des Wasserstands. LFH-628 schließt die `WV`-Reihe als Kurve aus.
  Die Prognose bleibt der gepflegte Höchststand.
- Kein Live-Ereignis. Die Seite fragt nach wie die Pegel-Kennzahl.
- Kein Einsatzgebiet aus Abschnitts- oder Zonenflächen. Maßgeblich ist der Einsatzort-Punkt
  (Entscheidung des Users).
- Keine Radar- oder Beobachtungsdaten, keine Warnungen auf Kreisebene.

## Decisions

### D1 Warnungen über Bright Sky `/alerts` statt Punkt-in-Polygon auf dem DWD-WFS

Beide Wege filtern serverseitig auf den Einsatzort-Punkt, wie vom User entschieden. Gewählt
ist Bright Sky `/alerts`. Die Gründe:

- Der Endpunkt ordnet den Punkt selbst der Gemeinde-Warnzelle zu, also derselben Zelle, für
  die der DWD warnt. Damit entfällt eigener Geometrie-Code (Ray-Casting über MultiPolygone).
- Er liefert den **Gemeindenamen**, den die WFS-Ebene nicht trägt.
- Die Warnfelder stehen strukturiert und auf Deutsch bereit: `event_de`, `headline_de`,
  `description_de`, `instruction_de`, `severity`, `onset`, `expires`.
- Die Vorhersage kommt ohnehin von Bright Sky, deshalb entsteht keine zusätzliche Quelle.

Die Alternative war, die globale `dwd`-Fachebene lokal nach Punkt-in-Polygon zu filtern. Das
hätte einen Upstream-Abruf für alle Einsätze gebraucht und den DWD als Erstquelle behalten.
Dagegen sprachen der eigene Geometrie-Code, das fehlende Gebietsnamen-Feld und der bekannte
Mangel des Umschlags (kein Alter).

**Preis:** Warnungen und Vorhersage hängen an einem Drittanbieter. Fällt Bright Sky aus,
fallen beide aus. Die Pegel bleiben unberührt, und die Kartenebene holt weiter direkt beim
DWD. Das ist eine Abweichung vom Wortlaut der Rückfrage (dort: „filtert den vorhandenen
DWD-Cache“), deshalb wird sie am Checkpoint ausdrücklich vorgelegt.

### D2 Ein Wetter-Endpunkt, zwei Teile mit eigenem Zustand

`GET /api/einsaetze/{id}/wetter`, Gate `EinsatzLesezugriff<WetterPegel>`. Die Antwort:

```
WetterAnzeige {
  ort?: { name, kreis?, land? }               // Warnzelle aus /alerts
  warnungen: WetterTeil<WetterWarnung[]>
  vorhersage: WetterTeil<{ station?, entfernung_m?, stunden: WetterStunde[] }>
}
WetterTeil = { zustand: ok | kein_ort | ausfall, abgerufen_at?, daten? }
```

- **`kein_ort`**: Der Einsatz hat keine Koordinate. Es gibt keinen Abruf, 200. Die leere
  Baseline des Guards `alle_modul_gruppen_gegated_get_baseline_und_versteckt` geht damit nie
  ins Netz.
- **`ausfall`**: Es gibt keinen Cache, und der Abruf scheitert. Oder der Cache ist älter als
  die Obergrenze (6 h Warnungen, 12 h Vorhersage). Die Obergrenze prüft das **Backend**,
  weil nur es das Cache-Alter kennt. Die Schwelle für „veraltet“ (30 min / 3 h) prüft das
  **Frontend** gegen `abgerufen_at` und seine Uhr. Das ist dieselbe Arbeitsteilung wie beim
  Pegel (LFH-606).
- `abgerufen_at` ist `jetzt − Cache-Alter`, also der Zeitpunkt des letzten erfolgreichen
  Abrufs. Er ist RFC 3339 in UTC.
- **Abgelaufene Warnungen** (`expires ≤ jetzt`) filtert das Backend bei **jeder** Antwort
  aus dem Cache heraus, nicht nur beim Abruf. Das gilt für Spec-Szenario „Abgelaufene Warnung
  aus altem Stand“.
- „gilt jetzt“ und „angekündigt“ trennt das Frontend anhand von `beginn` gegen seine Uhr.
  Das Backend liefert eine Liste, sortiert nach Stufe absteigend und dann nach Beginn.
- Die Stufe steht auf dem Draht als Enum `WetterWarnstufe` (`gering|maessig|schwer|extrem`)
  und wird aus `severity` (`minor|moderate|severe|extreme`) abgebildet. Ein unbekannter Wert
  lässt die Warnung **nicht** fallen, er wird `gering`, und geloggt wird er ebenfalls. Eine
  Warnung zu verschweigen wäre schlimmer als eine zu niedrige Stufe mit ihrem Ereignistext.
  Nur `category = met` wird gezeigt. `health` (Hitze/UV) ist kein Wetterereignis im
  Einsatzsinn; der Filter wird im Code benannt.

Die zwei Teile sind in einer Antwort gebündelt, weil sie denselben Ort und dasselbe Gate
haben und die Seite beide zugleich zeigt. Ein Ausfall eines Teils wird **nicht** zum
HTTP-Fehler, sonst risse er den anderen mit.

### D3 Abruf und Cache für Wetter nach dem Muster von `pegel::abruf`

Neues Modul `src/wetter/` mit folgenden Dateien:

- `mod.rs`: DTOs, Enum `WetterWarnstufe`, Konstanten.
- `quelle.rs`: Parsen der Bright-Sky-Antworten, reine Funktionen.
- `abruf.rs`: SWR-Cache mit In-flight-Marke und Abkühlung.

Die Cache-Schlüssel lauten `wetter-warnungen:<org>:<lat>,<lon>` und
`wetter-vorhersage:<org>:<lat>,<lon>`. Die Koordinaten sind auf **zwei Nachkommastellen**
gerundet, das sind etwa 1 km. Einsätze derselben Organisation am selben Ort teilen sich damit
einen Abruf. Die Warnzelle ist ohnehin gröber als 1 km. Die Organisation steht nur im
Schlüssel, nicht in der Anfrage. Ein instanzweit geteilter Eintrag verriete über
`abgerufen_at`, dass eine fremde Organisation in den letzten Stunden am selben Ort abgefragt
hat (Review-Befund).
Das Frontend prüft die Obergrenze zusätzlich gegen seine Uhr (`wetterStand.ts`,
`OBERGRENZE_MS`). Es filtert auch abgelaufene Warnungen und vergangene Stunden erneut. Ohne
neue Antwort, etwa bei einem Rechner offline, griffe die Prüfung des Backends sonst nie.

| Teil | TTL | Anfrage |
|---|---|---|
| Warnungen | 5 min | `/alerts?lat&lon&tz=Etc/UTC` |
| Vorhersage | 30 min | `/weather?lat&lon&date=<jetzt, volle Stunde>&last_date=<+24 h>&tz=Etc/UTC` |

Für die Vorhersage genügt eine TTL von 30 min, weil MOSMIX stündlich erneuert wird.

Die Bremsen sind ABRUF_FRIST 8 s, Abkühlung 60 s, In-flight je Schlüssel und der Drop-Guard.
Sie werden aus `pegel::abruf` übernommen, nicht neu erfunden. Der Pegel-Abruf trägt seine
Bremsen im eigenen Modul. Eine gemeinsame Abstraktion für zwei Aufrufer lohnt nicht. Die
Abkühlung bekommt ein **eigenes** Feld am `FachebenenState` (`wetter_fehlschlag`), damit ein
Wetterausfall keine Pegelstation sperrt und umgekehrt.

Die Basis-URL steht als `wetter_basis_url` am `FachebenenState`, mit dem Setter
`mit_wetter_basis_url` für Tests, analog zu `pegel_basis_url`. Die Integrationstests lenken
sie auf einen lokalen Stub. Kein Test geht ins Netz.

### D4 Pegelverlauf: Fenster P1D, Reihe über eine Listenroute

- `messungen_url` fragt `start=P1D` statt `PT3H` ab. Gemessen sind 96 Punkte im 15-min-Raster
  bei rund 5,6 KB je Station. Der Trend nutzt weiter nur die letzten 60 min
  (`trend::FENSTER_S`). Bestehende 3-h-Einträge im Cache bleiben gültige `Vec<Messpunkt>`
  und wachsen mit dem nächsten Abruf auf 24 h. Eine Migration ist nicht nötig.
- Neu ist `GET /api/einsaetze/{id}/pegel/verlauf`, Gate `EinsatzLesezugriff<OhneModul>`. Die
  Route liefert `Vec<PegelVerlauf { pegel_id, punkte: Vec<PegelVerlaufPunkt { zeitpunkt,
  wasserstand_cm }> }>` in der Reihenfolge der Pegel.
- Die Route nutzt denselben `reihe_fuer`-Weg wie die Messung. Dafür wird er `pub(crate)` als
  `abruf::reihen(...)`. Dadurch bleiben Wert und Linie **ein** Stand.
- Punkte älter als 24 h vor dem jüngsten Punkt werden abgeschnitten.
- Ist eine Reihe länger als **288 Punkte** (5-min-Raster), wird sie auf 288 Buckets
  ausgedünnt, je Bucket der letzte Punkt. Das betrifft Stationen mit 1-min-Takt. Der
  jüngste Punkt bleibt immer erhalten.
- Eine eigene Listenroute statt eines Felds in `PegelAnzeige`, weil die Liste auch Dashboard
  und Überblick alle 5 min lädt. Dort würde die Reihe nur Gewicht bedeuten.
- Eine Listen- statt einer Einzelroute, weil die Seite alle Pegel zugleich zeigt: ein Request
  statt bis zu fünf.
- Der Pfad `/pegel/verlauf` liegt unter dem modul-losen `PFAD_KEY`-Präfix
  `/api/einsaetze/{id}/pegel`. Ein neuer `PFAD_KEY`-Eintrag ist nicht nötig. Die Pegeldaten
  sind über `GET …/pegel` ohnehin für jeden Leser offen, ein Modul-Gate schützte hier nichts.

### D5 Frontend-Seite: drei Paneele, keine Tabelle

`pages/WetterPegelPage.tsx` im Seitenrahmen `EinsatzSeite`. `dataUpdatedAt` kommt aus
`gemeinsamerDatenstand` über beide Queries. Die Primäraktion „Pegel festlegen“ ist ein Link
zu Einstellungen › Pegel. Der Kopf-Slot trägt, was **öffnet**, nicht was absendet (LFH-346).
Darunter folgt ein Raster aus drei `Paneel`en.

**Pegel**

- Die Form ist eine Liste, keine Tabelle. Bei 1 bis 5 Stationen lautet die Frage „was ist mit
  diesem Pegel?“, nicht „welcher ist der richtige?“.
- Die Zeile trägt Name und Gewässer, darunter den Wert in Mono, Trendwort und cm/h, Stand
  (bei Bedarf mit „veraltet“), Prognosetext und die Verlaufslinie.
- Alle Texte kommen aus `pegelKennzahl.ts`. Dort entsteht eine neue exportierte Funktion für
  **eine** Station: `pegelZeile(p, jetzt, konv)`. `pegelKennzahl` baut auf ihr auf, damit
  „veraltet/Stand unbekannt“ an einer Stelle bleibt.

**Warnungen (DWD)**

- Das Kopf-Meta trägt Gemeinde und Stand.
- Es gibt zwei Abschnitte, „gilt jetzt“ und „angekündigt“.
- Je Warnung stehen `StatusChip` (Stufenwort, Rolle aus `dwdWarnstufe`), Ereignis, Zeitraum
  und Überschrift.
- Beschreibung und Handlungsempfehlung stehen in einem Inline-Expander. Das ist die Form
  „Inline“ aus LFH-19, weil es Zusatzinhalt im Kontext ist.

**Vorhersage**

- Die Stunden stehen in 3-h-Schritten als Liste, 8 Zeilen für 24 h. Jede Zeile ist eine
  Datenraster-Reihe aus Zeit, Temperatur, Niederschlag, Wahrscheinlichkeit, Wind und Böen
  sowie Richtung als Himmelsrichtung (N, NO, …).
- Der Fuß trägt Station und Entfernung sowie den Quellenvermerk.
- Das Frontend dünnt auf 3-h-Schritte aus. Das Backend liefert alle 24 Stunden, damit eine
  spätere Darstellung nicht an einer Backend-Entscheidung hängt.
- Die Windrichtung erscheint als Text, nicht als Pfeil-Ikone. Das ist ein zweiter Kanal
  ohne Bildzeichen und im Ausdruck lesbar.

**Verlaufslinie** (`wetter/Verlaufslinie.tsx`)

- Ein eigenes, schlankes SVG ohne neue Abhängigkeit.
- Die x-Achse ist die Zeit (24 h), die y-Achse der Bereich min…max mit Rand.
- Beschriftet sind nur min und max (Mono, auf der Höhe ihres Werts) sowie „−24 h“ und die
  Uhrzeit des jüngsten Punkts (das Fenster endet dort, nicht bei „jetzt“).
- Die Linie steht in `token.colorText`, der jüngste Punkt als Marke. Eine gültige Prognose
  erscheint als gestrichelte waagerechte Hilfslinie, direkt an der Linie beschriftet.
- Die Farbe trägt keine Bedeutung. Der Steigungszustand steht bereits als Wort in der Zeile.
- Die Linie ist `role="img"` mit `aria-label`, das die Aussage in Worten trägt: „Verlauf
  24 h: 5,62 m bis 6,84 m, zuletzt steigend“.
- Die Geometrie ist eine **reine, exportierte** Funktion `verlaufsPfad(punkte, breite, hoehe)`.
  So ist sie ohne Layout in jsdom prüfbar.
- Beim Bauen gilt der Skill `dataviz`.

Die Query-Keys lauten:

- `einsatzKeys.pegelVerlauf(id)` = `['einsatz-pegel', id, 'verlauf']`. Das ist ein Sub-Key
  des vorhandenen, nicht-live Prefix, derselbe Weg wie bei `pegelVorhersage`.
- `einsatzKeys.wetter(id)` = `['einsatz-wetter', id]`. Er ist ein neuer Prefix in
  `NICHT_LIVE_KEYS`.

Beide Queries fragen alle 5 min nach (`PEGEL_ABRUF_MS`).

### D6 Vertragskarte `dwdWarnstufe`

`theme/statusFarben.ts` erhält `dwdWarnstufe: Record<WetterWarnstufe, StatusDarstellung>`.
Der Abdeckungstest wächst von 20 auf 21 und nimmt den Eintrag in die Literal-Liste auf.

| Stufe | Rolle | Bezeichnung |
|---|---|---|
| gering | achtung | Wetterwarnung |
| maessig | achtung | Markantes Wetter |
| schwer | alarm | Unwetterwarnung |
| extrem | alarm | Extremes Unwetter |

- Je zwei Stufen teilen sich eine Rolle. Unterschieden werden sie durch das Pflichtfeld
  `label` (WCAG 1.4.1), wie `warnstufeKarte` fünf Stufen auf drei Rollen legt.
- `gering` ist nicht `neutral`, weil eine amtliche Warnung kein Normalzustand ist. Nicht
  `bedien`/Blau, weil der Bestand im `FachebenenInspector` Minor auf Blau legte und das gegen
  „Rot bedient nichts / Blau ist Bedienung“ verstößt.
- Der Inspector wird **nicht** mit umgebaut (Non-Goal). Sein Befund wird im Folgeticket
  zur DWD-Kartenebene festgehalten.

### D7 Modul-Gerüst und Wege

Das Gerüst folgt dem Muster LFH-635 (`openspec/changes/lfh-635-fachmodul-abloesung/tasks.md`):

- **Backend:**
  - `MODUL_KEYS` wächst von 28 auf 29, `wetter-pegel` steht im Lage-Block hinter
    `gefahrenzonen`;
  - Marker `WetterPegel`;
  - `PFAD_KEY` bekommt `("/api/einsaetze/{id}/wetter", Some("wetter-pegel"))`;
  - `MODUL_GET_PFADE` bekommt `("wetter-pegel", "wetter")`.
- **Frontend:**
  - Registry-Eintrag mit Status `fertig`, ohne `zaehlerQuelle`;
  - `App.tsx` `MODUL_ELEMENTE`;
  - `deeplinks.ts` bekommt `wetterPegelPfad`;
  - `EinsatzLayout.test.tsx` nimmt den Key in die Liste der Lage-Keys auf. Der veraltete
    Eintrag `kraefteuebersicht` fällt dort bei der Gelegenheit heraus.

Die Wege aus Dashboard und Überblick laufen so:

- Dashboard (`lagebild.ts`) und Überblick (`UeberblickPage.tsx`, Marke `pegelprognose`)
  entscheiden mit `istKeyFreigegeben('wetter-pegel', benutzer, overrides)`
  (`einsatz/modulRegistry.ts`). `darfZaehlerLaden` taugt dafür nicht, weil es sein Modul über
  `zaehlerQuelle` sucht und das Modul keine hat. Bis die Overrides geladen sind, gilt die
  Pflege.
- Ist das Modul sichtbar, geht es zu `wetterPegelPfad`, sonst zu
  `einsatzEinstellungenPfad(id, 'pegel')`.
- `lagebild.ts` bleibt rein: Die Entscheidung kommt als Eingabe `pegelZiel` herein, sie wird
  nicht im Modul berechnet.

## Risks / Trade-offs

- **[Drittanbieter-Ausfall]** Bright Sky ist ein Einzelbetrieb ohne Zusage. → Jeder Teil
  zeigt bei Ausfall „Stand unbekannt“. Die Pegel und die DWD-Kartenebene bleiben unabhängig
  davon. Die Basis-URL ist an einer Stelle austauschbar, zum Beispiel gegen eine eigene
  Bright-Sky-Instanz. Eine Umgebungsvariable dafür ist nicht Teil dieses Tickets.
- **[Datenschutz]** Die Einsatzort-Koordinate geht an einen Dritten. → Sie ist auf zwei
  Nachkommastellen (~1 km) gerundet. Die Anfrage trägt keinen Einsatzbezug, keinen Namen und
  keine Kennung. Das Risiko wird in der Prüfliste als bewertetes Restrisiko festgehalten.
- **[Payload-Wachstum Pegel]** Mit P1D wächst der Cache-Eintrag je Station von rund 13 auf 96
  Punkte. → Die Größe ist vernachlässigbar (~6 KB). Die Liste auf dem Draht bleibt unberührt,
  nur die Verlaufsroute trägt die Reihe.
- **[Stationen mit 1-min-Takt]** Solche Stationen hätten bis zu 1440 Punkte. → Sie werden auf
  288 Buckets ausgedünnt (D4). Den Trend rechnet die volle Reihe.
- **[Warnung verschluckt]** Ein unbekannter `severity`-Wert oder eine unerwartete Kategorie
  könnte eine Warnung verschwinden lassen. → Ein unbekannter `severity`-Wert wird zu `gering`
  und geloggt. Nur `health` wird bewusst gefiltert, benannt und getestet.
- **[Zwei DWD-Wege]** Karte (WFS) und Modul (Bright Sky) können für einen Moment verschiedene
  Stände zeigen. → Das ist hingenommen. Das Modul trägt seinen Stand sichtbar, die Karte
  nicht; das bleibt Gegenstand des Folgetickets.

## Migration Plan

Die Änderung braucht keine Datenmigration. Das Ausrollen ist ein normales Deployment. Der
erste Pegelabruf nach dem Deployment füllt die 24-h-Reihe auf. Bis dahin zeigt der Verlauf
nur die alten 3 h, das ist ehrlich und selbstheilend.

Rückbau: Modul ausblenden oder den Commit zurücknehmen. Es entstehen keine Daten, die zu
räumen wären.

## Open Questions

Keine, die Spec, Ansatz oder Aufgabenschnitt ändern. Zu erfassen sind zwei Folgetickets:

- Die DWD-Kartenebene gibt ihr Alter nicht an, dazu kommt die Farb- und Emoji-Abweichung im
  `FachebenenInspector`.
- Ob eine Unwetterwarnung (schwer/extrem) einen Modulzähler oder Hinweis bekommt, ist eine
  eigene Entscheidung über das Alarmbudget.
