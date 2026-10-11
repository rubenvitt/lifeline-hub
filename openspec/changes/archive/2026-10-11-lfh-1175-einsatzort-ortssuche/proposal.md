## Why

Der Einsatzort ist heute eine freie Textzeile, die Koordinate ein getrenntes Feld, das nur das
Vollformular ändert. Ob beides zusammenpasst, sieht niemand: ein Tippfehler in der Adresse
oder eine vergessene Koordinate verschiebt Wetter, Lagekarten-Start und Peilung, ohne dass es
auffällt. Ruben (10.10.2026, LFH-1154): „Einsatzort per Geo-Anbindung automatisch
vervollständigen, und zwar so, dass der Nutzer sieht, wo der Ort liegt.“ Die Adresssuche gibt es
schon, aber nur auf der Lagekarte und nur mit deren Modul-Recht; beim Anlegen eines Einsatzes
gibt es gar keinen Einstieg.

## What Changes

- **Server, zwei neue Such-Einstiege ohne Lagekarten-Gate**, mit denselben Grenzen wie die
  Lagekarte (3–200 Zeichen, höchstens fünf Treffer, ein gemeinsamer Takt von 1 Anfrage/s,
  1,5 s, Ausfall als `zustand` mit 200, kein Suchtext im Log):
  - im Einsatz `GET /api/einsaetze/{id}/ort-suche?q=` mit dem Recht, die Einsatzdaten zu
    ändern; bevorzugt die Umgebung des Einsatzorts;
  - auf Organisationsebene `GET /api/ort-suche?q=` für alle, die Einsätze anlegen dürfen
    (Admin, Führungskraft); ohne bevorzugte Umgebung (die Organisation hat keinen Standort).
- **Kurzbeschriftung der Treffer**: jeder Treffer trägt zusätzlich zur Geocoder-Beschriftung
  eine kurze Adresse („Hauptstraße 12, 12345 Musterstadt“), sofern der Geocoder die Teile liefert.
- **`POST /api/einsaetze` nimmt den Einsatzort an** (`einsatzort`, `einsatzort_lat`,
  `einsatzort_lon`, alle optional). Anlegen und `PATCH` prüfen die Koordinate: Bereich (400) und
  Paar (beide oder keine, 422).
- **Baustein `Ortsfeld`** (Kern von LFH-1248): Freitext, Suche auf Enter oder Knopf „Ort
  suchen“, Trefferliste, Zustände (sucht, keine Treffer, ausgelastet, nicht erreichbar, ohne
  Netz). Die Suchfunktion wird hineingereicht, damit derselbe Baustein beide Einstiege bedient.
- **Baustein `Kartenausschnitt`**: kleine Karte ohne Bedienung mit einer Nadel, Kartengrundlage
  wie die Lagekarte (online, Offline-Karten oder Blindstil); ohne Koordinate „Nicht verortet“.
- **Einsatzdaten**: neues Paneel „Einsatzort“ mit den Zeilen Adresse (Ortsfeld) und Koordinate
  (Koordinateneingabe in allen Formaten), dem Kartenausschnitt und dem Sprung „Auf Lagekarte
  zeigen ↗“. Ein gewählter Treffer speichert Adresse und Koordinate in **einem** PATCH; nur
  geänderter Text speichert nur die Adresse. Die Kopfleiste zeigt den Einsatzort nur noch an.
  Die Zeile „Koordinate“ wandert aus „Lagedaten“ ins neue Paneel.
- **„Einsatz anlegen“**: fünftes, optionales Feld „Einsatzort“ mit Ortsfeld; nach einer Wahl ein
  kleiner Kartenausschnitt.
- Regel in `frontend/AGENTS.md` („Bezeichnung und Koordinate nur im Vollformular“) und Kommentar
  zur Feldobergrenze im Anlege-Dialog fortgeschrieben; Kapitel `einsatzdaten.md` und
  `einsatz-oberflaeche.md` (Anlegen) nachgezogen.

**Nicht-Ziele** (bleiben bei LFH-1248, LFH-1254, LFH-1170 oder dem Folgeticket):
Vorschläge beim Tippen (verbietet der öffentliche Nominatim; kommt mit einem eigenen
Geocoder-Dienst, Folgeticket „Eigener Geocoder“), Nadel verschieben, Karte groß zum Wählen,
Personenadressen ohne Suche, Anbindung weiterer Ortsfelder, Abbau des Vollformulars, ein Standort
der Organisation.

## Capabilities

### New Capabilities
- `ortsfeld`: Baustein für eine Ortsangabe mit Adresssuche, Trefferwahl, Zuständen und
  Kartenausschnitt, samt den Such-Einstiegen ohne Lagekarten-Gate (im Einsatz, in der
  Organisation).

### Modified Capabilities
- `einsatzdaten-bearbeitung`: Einsatzort und Koordinate werden zeilenweise bearbeitbar; die Zeile
  Einsatzort darf mit einem gewählten Treffer Adresse und Koordinate gemeinsam senden; Paneel
  „Einsatzort“ mit Kartenausschnitt; das Vollformular bleibt.
- `lagekarte-ortssuche`: Die Grenzen der Adressauflösung (Takt, Zeitlimit, Zustände, 400) gelten
  für jeden Such-Einstieg; das Lagekarten-Recht nur für den Einstieg der Lagekarte.

## Impact

- Backend: `src/routes/karte_ort_suche.rs` (gemeinsamer Kern herausgelöst), neue Routen in
  `src/app.rs`, `src/einsatz/modul.rs` (`PFAD_KEY` ohne Modul), `src/geocoding/suche.rs`
  (Kurzbeschriftung, `addressdetails`), `src/routes/einsatz.rs` (`NeuerEinsatz`, Prüfung der
  Koordinate in Anlegen und PATCH), `src/api_doc.rs`, Tests unter `tests/`.
- Typ-Codegen: `OrtTreffer` bekommt ein Feld, `openapi.json` und `types.generated.ts` neu.
- Frontend: `anzeige/Ortsfeld.tsx`, `anzeige/Kartenausschnitt.tsx` (neu), `api/ortSuche.ts`,
  `api/queryKeys.ts`, `api/einsaetze.ts`, `pages/EinsatzdatenPage.tsx`, `pages/EinsaetzePage.tsx`,
  e2e-Spec für die Einsatzort-Suche.
- Keine Migration (die Spalten `einsatzort_lat/lon` bestehen).
- Überschneidung mit LFH-1170 (Einsatzdaten neu gliedern, `in design`): das Paneel „Einsatzort“
  nimmt dessen Zielgliederung vorweg; wer später umbaut, verschiebt das Paneel, nicht seinen
  Inhalt.
