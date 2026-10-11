## Context

Motivation: `proposal.md`. Bestand, auf dem der Entwurf aufsetzt:

- **Suche:** `GET /api/einsaetze/{id}/karte/ort-suche` (`src/routes/karte_ort_suche.rs`, LFH-638)
  ist ein dünner Handler um `geocoding::suche(base, q, ausschnitt)`. Grenzen, Cache (24 h, im
  Prozess) und der **eine prozessweite Token-Bucket (1/s)** stecken in `src/geocoding/suche.rs`
  und `mod.rs` und kennen keinen Einsatz. Das Gate sitzt allein im Extraktor
  (`EinsatzLesezugriff<Lagekarte>`).
- **Rechte:** Der PATCH der Kopfdaten nimmt `EinsatzVerwaltungszugriff` (Schreibrecht im Einsatz
  oder Admin der Einsatz-Org, nur am laufenden Einsatz). Anlegen prüft
  `benutzer.darf_einsatz_anlegen()` (Admin oder Führungskraft).
- **PATCH** nimmt `einsatzort`, `einsatzort_lat`, `einsatzort_lon` schon dreiwertig
  (`Option<Option<_>>`) in einer Anfrage, prüft die Koordinate aber weder auf Bereich noch auf
  Paar. `NeuerEinsatz` kennt keinen Einsatzort.
- **Organisation** hat keinen Standort; `geocoder_url` liegt in `org_einstellungen`.
- **Frontend:** `InlineAngabe` (eigenes `<form>`, Enter speichert, kein Speichern beim Verlassen),
  `KoordinatenEingabe`/`KoordinatenAnzeige`/`OrtZeile`, eine statische MapLibre-Karte ohne
  Bedienung gibt es schon im Lagemonitor (`geraet/LagemonitorKarte.tsx`), die Kartengrundlage
  baut `pages/lagekarte/basemapStil.ts` (`baueBasemapStyle`, `defaultModus`,
  `absolutiereProxyAnfrage`). Die Zustandstexte der Lagekarten-Suche stehen in
  `pages/lagekarte/MarkerSuche.tsx` (`adressAussage`), nicht exportiert.
- **Nebenläufig:** LFH-1170 (Einsatzdaten neu gliedern) steht auf `in design` und baut dieselbe
  Seite um, auch das Vollformular ab.

## Goals / Non-Goals

**Goals:**
- Ein Ortsfeld-Kern, den LFH-1248 nur noch erweitert (Nadel ziehen, Karte groß, `ohneSuche`,
  Regel „jede Ortsangabe nimmt Ortsfeld“) und LFH-1254 ausrollt, ohne ihn umzuschreiben.
- Ein Such-Kern im Server, den alle drei Einstiege teilen: ein Takt, ein Cache, eine Prüfung.

**Non-Goals:**
- Kein Umbau der Lagekarten-Suche im Frontend (`MarkerSuche` bleibt; nur die Zustandstexte werden
  geteilt, wenn das ohne Verhaltensänderung geht).
- Kein Abbau des Vollformulars (LFH-1170). Es behält sein freies Adressfeld und `KoordinatenFeld`.
- Keine Offline-Fähigkeit des Kopf-PATCH (heute nicht offline-fähig; bleibt so).

## Decisions

### D1 Suchauslöser: Enter oder Knopf, austauschbar
Gesucht wird auf Enter oder „Ort suchen“, wie auf der Lagekarte. Der öffentliche Nominatim
verbietet Autovervollständigung, und der eine Takt von 1/s für alle Nutzer wäre beim Tippen
sofort erschöpft. **Entscheidung des Menschen am Scope-Checkpoint (11.10.2026).** Vorschläge
beim Tippen kommen mit einem eigenen Geocoder-Dienst (Photon o. ä., Adapter, Takt je Geocoder,
Org-Schalter), Folgeticket „Eigener Geocoder“. Das Ortsfeld nimmt die Suche als Funktion
entgegen und löst sie selbst aus; ein späterer Auslöser „beim Tippen“ ist eine Prop, kein Umbau.
*Verworfen:* Tippen ab drei Zeichen mit Entprellung (Regelverstoß, Takt); Schalter schon jetzt
(Migration für eine Einstellung, die ohne eigenen Dienst immer aus bliebe).

### D2 Zwei Einstiege statt eines
- `GET /api/einsaetze/{id}/ort-suche` mit `EinsatzVerwaltungszugriff`: dasselbe Recht wie der
  PATCH, für den die Suche da ist; Umgebung = Einsatzort. Pfad ohne `/karte`, damit `PFAD_KEY`
  ihn ohne Modul führt (`None`, wie `/ort-vorschau`).
- `GET /api/ort-suche` mit `CurrentUser` und `darf_einsatz_anlegen()`, Org aus dem Benutzer,
  ohne Ausschnitt.

*Verworfen:* nur der Org-Einstieg für beide Seiten. Er verlöre die Umgebung des Einsatzorts und
prüfte ein Org-Recht, wo ein Einsatz-Recht gilt (Führungspersonal eines Einsatzes ist nicht
zwingend Führungskraft der Org). *Verworfen:* `EinsatzLesezugriff` ohne Modul für den
Einsatz-Einstieg. Wer nicht schreiben darf, braucht keine Suche; jede Suche verbraucht den
gemeinsamen Takt.

### D3 Gemeinsamer Such-Kern im Server
`pruefe_suchtext`, die DTOs (`OrtSucheAntwort`, `OrtTreffer`, `OrtSucheZustand`) und
`antwort_aus` ziehen aus `karte_ort_suche.rs` in ein Modul `src/routes/ort_suche.rs`, das alle
drei Handler nutzen. Die DTOs behalten Namen und Form, damit `types.generated.ts` nur das neue
Feld bekommt und die Lagekarte unverändert bleibt. Der Takt bleibt prozessweit (Spec
`lagekarte-ortssuche`, „ein Takt für alle Einstiege“).

### D4 Kurzadresse aus `addressdetails`
Die Geocoder-Anfrage bekommt `addressdetails=1`; `lies_treffer` baut aus `road`/`pedestrian`/…,
`house_number`, `postcode` und `city`/`town`/`village`/`municipality` die Kurzadresse
„Straße Nr, PLZ Ort“. `OrtTreffer` erhält `kurz: Option<String>` (`skip_serializing_if`). Ohne
Kurzadresse stünde nach der Wahl Nominatims `display_name` („…, Landkreis X, Niedersachsen,
12345, Deutschland“) in der Kopfleiste. Der Cache-Schlüssel ändert sich nicht (der Parameter ist
für alle Anfragen gleich). *Verworfen:* clientseitiges Kürzen von `display_name` (Reihenfolge je
Land und Geocoder verschieden, unzuverlässig).

### D5 Ortsfeld als kontrollierte Eingabe
`anzeige/Ortsfeld.tsx`, Wert `OrtsfeldWert = { text: string; koordinate: LatLon | null }`.
`koordinate` ist nur gesetzt, solange der Text der eines gewählten Treffers ist; jede Textänderung
setzt sie auf `null`. Props: `value`, `onChange`, `suchen: (begriff) => Promise<OrtSucheAntwort>`,
`suchSchluessel: (begriff) => QueryKey`, `id`/`aria-*` aus dem umgebenden Feld. Die Suche läuft
über `useQuery` mit dem gereichten Schlüssel (wie `AdressGruppe`), `retry: false`, nur `ok` wird
zehn Minuten gehalten. Enter im Feld ruft `preventDefault` und sucht; gespeichert wird in der
Zeile über „Speichern“ (wie mehrzeilige Zeilen). Ohne Netz (`useOnline`) ist „Ort suchen“
gesperrt. Treffer stehen als Liste von Knöpfen mit Kurzadresse und Geocoder-Beschriftung
(gedämpft, eine Zeile, abgeschnitten).

### D6 Zeile „Adresse“ als `InlineAngabe<OrtsfeldWert>`
Die Zeile vergleicht nur den Text plus Koordinate und baut den Patch:
`koordinate` gesetzt → `{ einsatzort, einsatzort_lat, einsatzort_lon }`; sonst `{ einsatzort }`.
Die Zeile „Koordinate“ ist eine `InlineAngabe<KoordinatenWert>` mit `KoordinatenEingabe`, Patch
als Paar (geleert → Paar aus `null`). Beide stehen im neuen Paneel „Einsatzort“ unter
„Lagedaten“; die Kopfleiste zeigt den Text ohne Aufforderung (ein Wert, eine Bearbeitungsstelle).
Die Zeile „Koordinate“ direkt darunter zeigt über `KoordinatenAnzeige` den Reverse-Ortsname der
gespeicherten Koordinate, damit ein Auseinanderfallen sichtbar bleibt; eine zweite `OrtZeile`
neben der Adresse fragte den Geocoder je Seitenaufruf doppelt.

### D7 Kartenausschnitt als eigener Baustein
`anzeige/Kartenausschnitt.tsx`: `{ punkt: LatLon | null; etikett: string; hoehe?: number }`,
MapLibre ohne Bedienung, Stil wie `LagemonitorKarte` (`baueBasemapStyle(defaultModus(config), …)`,
`absolutiereProxyAnfrage`), `PUNKT_ZOOM`, eine Nadel als DOM-Marker mit `aria-label`. Ohne Punkt
„Nicht verortet“. Die Lagemonitor-Karte bleibt (mehrere Punkte, Monitor-Maße); eine Vereinigung
wäre ein eigener Refactor. Seiten-Tests mocken den Baustein, wie `LagemonitorPage.test.tsx` die
Monitorkarte; der Baustein selbst wird für „Nicht verortet“ und den Marker geprüft. „Offline“
heißt hier dasselbe wie auf der Lagekarte: installierte Offline-Karten oder der Kachel-Cache des
Servers; ohne beides zeigt der Blindstil die Nadel auf leerem Grund.

### D8 Sprung zur Lagekarte
„Auf Lagekarte zeigen ↗“ über `lagekartePfad(id, { zentrum })`, nur wenn der Einsatzort verortet
ist und die Person das Modul Lagekarte sehen darf (dieselbe Prüfung wie das Modulmenü).

### D9 Anlege-Dialog mit fünftem Feld
`EinsaetzePage` bekommt „Einsatzort“ als fünftes, optionales Feld (Ortsfeld mit
`sucheOrtInOrg`), darunter nach einer Wahl ein Kartenausschnitt mit 120 px Höhe. Der Kommentar
„vier sind die Obergrenze“ wird fortgeschrieben: das fünfte Feld ist optional und ersetzt einen
späteren Gang in die Kopfdaten für die wichtigste Erstangabe. **Entscheidung des Menschen
(11.10.2026).**

### D10 Prüfung der Koordinate im Server
Gemeinsamer Helfer in `src/routes/einsatz.rs`: Bereich → `AppError::Validation` (400), nur einer
der beiden Schlüssel oder Wert neben `null` → 422 (Zusammenhang, `src/AGENTS.md`). Gilt für
Anlegen und PATCH.

### D11 Query-Keys
`einsatzKeys.einsatzortSuche(einsatzId, begriff)` und `globalKeys.ortSuche(begriff)`, beide in
`NICHT_LIVE_KEYS` bzw. der globalen Entsprechung mit derselben Begründung wie `ortSuche`, beide
nicht im Lagebild offline.

## Risks / Trade-offs

- [LFH-1170 baut dieselbe Seite um] → Das Paneel „Einsatzort“ entspricht dessen Zielgliederung
  (Paneel 4); die Änderung bleibt in eigenen Komponenten (`EinsatzortPaneel`), damit ein Umbau sie
  verschiebt statt neu schreibt.
- [Ein Takt für alle Einstiege] → Bei vielen gleichzeitigen Suchen „ausgelastet“; das Feld sagt
  es und bietet „Erneut suchen“. Abhilfe ist das Folgeticket „Eigener Geocoder“.
- [`addressdetails` bei fremden Geocodern] → Fehlen die Teile, fällt `kurz` weg und die
  Beschriftung bleibt; kein Fehler.
- [MapLibre in jsdom] → Seiten-Tests mocken den Kartenausschnitt; die Karte selbst prüft die e2e
  mit `kartenFixture`.
- [Enter sucht statt speichert] → Ein Bruch mit den übrigen einzeiligen Zeilen; die Zeile trägt
  „Speichern“ sichtbar, die Anwenderdoku sagt es.

## Migration Plan

Keine Migration. Neue Routen sind additiv; `OrtTreffer.kurz` ist optional. Rückbau: Routen und
Paneel entfernen, die Prüfung der Koordinate kann bleiben.
