# Fremdebenen in gesicherten Ständen und im Offline-Budget (LLH-2130)

Zunder: https://zunder.rubeen.dev/#/aufgabe/m6rhqco4zu7fh7qex4lemk54

## Absicht

Fremdebenen (LLH-2099, `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md`) sind
Teil des Lagebilds. Ein gesicherter Stand („Stand sichern“, LFH-321) soll zeigen, was zu diesem
Zeitpunkt auf der Karte lag, auch die Fremdebenen. Heute blendet der Rückblick sie aus
(`useFremdebenen.ts`, `aktiv: false`), und LLH-2099 hat das als Nicht-Ziel offen gelassen.

Ohne Netz liegen Liste und Daten schon heute auf der Platte (`LAGEBILD_OFFLINE`), aber ohne
Grenze: eine Ebene darf 8 MiB normiertes GeoJSON haben, die Zahl der Ebenen ist nicht begrenzt,
und der Persister schreibt bei jeder Speicherung den ganzen Datensatz.

Bestand, der bleibt: Lageplan-Druck führt sichtbare Fremdebenen schon in Bild und Legende
(LLH-2099), der Rückblick druckt damit automatisch mit, sobald er sie zeichnet.

## Ziele

- Ein Stand friert je Fremdebene ihre Angaben und den Hash ihres Inhalts ein. Der Inhalt selbst
  liegt **einmal je Einsatz und Hash** in einer eigenen Tabelle, solange ein Stand darauf zeigt.
- Der Rückblick zeichnet genau den Inhalt von damals, mit derselben Farbe und demselben Namen,
  auch wenn die Ebene inzwischen geändert, neu abgerufen oder gelöscht ist.
- Ohne Netz liegen höchstens **16 MiB** normiertes GeoJSON je Einsatz auf der Platte. Eine Ebene
  über dem Budget zeigt ohne Netz „nicht geladen“, nie eine leere Ebene.

## Nicht-Ziele

- Fremdebenen im Lagemonitor bzw. Lagebild extern.
- Stände ohne Netz lesen: die Stand-Dokumente liegen heute nicht auf der Platte
  (`lageSnapshotDokument` fehlt in `LAGEBILD_OFFLINE`), ihre Fremdebenen-Daten also auch nicht.
- Eine Grenze für die Zahl der Stände oder der gesicherten Versionen.

## Anti-Ziele

- Ein Rückblick, der den **heutigen** Inhalt einer Ebene als damaligen zeigt.
- Die volle URL einer Ebene in einem Stand (sie kann ein Geheimnis tragen; Leser sehen nur den
  Host).
- Ein Stand-Dokument, das mit den Fremdebenen um Megabytes wächst.

## Ansätze

| Weg | Trägt | Kostet |
| --- | --- | --- |
| **Versionen nach Hash (gewählt)** | exakter Rückblick, Stand bleibt klein, jede Version einmal | neue Tabelle samt Schwärzung, Spiegel, Aufräumen, neue Leseroute |
| Nur Angaben + Hash, Daten live | billig, Vorbild Hintergrundbilder | URL-Ebenen fallen im Rückblick fast immer weg, sobald der nächste Abruf etwas ändert |
| Volles GeoJSON im Stand | einfach | bis 8 MiB × Zahl der Ebenen je Stand, jedes Mal neu, im JSON-Dokument |
| Nicht sichern | nichts zu tun | Rückblick bleibt unvollständig |

Entscheidung Ruben, 25.11.2026: Versionen nach Hash; Offline-Budget 16 MiB.

## Entwurf

### Speicher: `karte_fremdebene_stand` (neue Migration)

```sql
CREATE TABLE karte_fremdebene_stand (
    einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    sha256     TEXT    NOT NULL,
    geojson    BLOB    NOT NULL,
    objekte    INTEGER NOT NULL,
    verworfen  INTEGER NOT NULL,
    PRIMARY KEY (einsatz_id, sha256)
);
```

- **Kopie, keine Verweise auf die Live-Daten.** `karte_fremdebene_daten` bleibt, wie sie ist;
  `ersetze_daten`, Löschen und Abruf ändern sich nicht. Erst „Stand sichern“ kopiert den
  aktuellen Inhalt jeder Ebene mit Daten per `INSERT OR IGNORE … SELECT` hinein. Eine
  unveränderte Ebene kostet beim zweiten Stand nichts.
- **Wer verweist:** allein die Stände über `daten.fremdebenen[*].sha256`. Eine eigene
  Verweistabelle gibt es nicht.
- **Aufräumen:** Nach dem Löschen eines Stands löscht dieselbe Transaktion jede Zeile des
  Einsatzes, auf die kein verbleibender Stand mehr zeigt (`json_each` über `lage_snapshot.daten`).
  Das Löschen des Einsatzes nimmt die Zeilen per `ON DELETE CASCADE` mit (Aufbewahrung).
- **Anlegen** und Kopieren laufen in **einer** Transaktion mit dem Insert des Stands, damit kein
  Stand auf einen fehlenden Hash zeigt. Der Torn-Read-Hinweis des Stands bleibt für die
  übrigen Quellen bestehen.

### Stand-Dokument: Feld `fremdebenen`

`SnapshotDaten` bekommt `fremdebenen: Vec<FremdebeneImStand>` (neue Struktur in
`lage_snapshot`, Wire-Felder englisch wie `FremdebeneAnzeige`):

| Feld | Herkunft |
| --- | --- |
| `id` | Ebene |
| `name` | Ebene |
| `color` | Ebene |
| `source` | `datei` / `url` |
| `url_host` | nur Host, nie `url` |
| `fetched_at` | Stand des Inhalts |
| `feature_count`, `dropped_count` | Daten |
| `sha256` | Daten, Schlüssel in `karte_fremdebene_stand` |

- Eingefroren werden nur Ebenen **mit** Daten (eine URL-Ebene vor dem ersten Abruf fehlt).
- `version` des Dokuments bleibt 1; ältere Stände tragen das Feld nicht (`#[serde(default)]`
  bzw. im Client `?? []`), wie bei `bereitstellungsraeume` und `tiere`.
- `daten` wird je Ebene um einige hundert Byte größer, nicht um ihren Inhalt.

### Leseroute

`GET /api/incidents/{id}/situation-snapshots/{sid}/foreign-layers/{sha256}/data`

- **Adressiert über den Hash, nicht die Ebenen-ID** (Entscheidung des Entwurfs): der Hash ist
  über Instanzen und über das Löschen der Ebene hinweg stabil, die ID nicht (s. Spiegel).
- Lesezugriff `EinsatzLesezugriff<Lagekarte>` wie das GET des Stands.
- 404, wenn `daten.fremdebenen` des Stands den Hash nicht nennt (kein Lesen fremder Versionen
  über einen geratenen Hash), sonst der Inhalt aus `karte_fremdebene_stand`.
- Antwort wie die Live-Route (`routes::karte_fremdebene::daten`): `application/geo+json`, ETag aus
  dem Hash, `If-None-Match` → 304, dieselbe `download_grenze`. Der Inhalt ist unveränderlich,
  ein langes `Cache-Control` ist zulässig (Wahl des Bauenden).
- Kein `refresh_if_due` (Stand ist eingefroren).
- Routen-Glossar: `foreign-layers` steht schon in `scripts/api-routen-woerter.tsv`.

### Schwärzung (`src/einsatz/schwaerzung_registry.rs`)

- `karte_fremdebene_stand` bekommt eine `TabellenRegel`: `Scoping::EinsatzId`, alle Spalten
  `ZeileLoeschen`, Zuordnung `Z_EINSATZ` wie `karte_fremdebene_daten`. **Im Nachlauf, nicht im
  atomaren Vorgang** (Entscheidung des Entwurfs): die Tabelle hat keine Mengengrenze
  (Versionen × Ebenen × bis 8 MiB); Vorbild sind die großen Anhänge (LFH-905), eine Transaktion
  je Zeile.
- **Kein `JSON_TEILE`-Eintrag:** `lage_snapshot.daten` fällt unter `Z_EINSATZ` schon mit der
  ganzen Zeile, ein Eintrag für `$.fremdebenen` würde übersprungen. Namen im Stand gehen damit
  mit dem Stand. Fremdebenen fallen unter keine Kategorie (wie `karte_fremdebene_daten`).
- Der Registry-Wächter findet die neue Tabelle ohne Eintrag ohnehin.

### Spiegel (Instanzkopplung, `src/instanz/spiegel/art.rs`)

- `karte_fremdebene_stand` wird gespiegelt wie `karte_fremdebene_daten` (Gruppe `Anhaenge`),
  mit den erzeugten Log- und Schutz-Triggern (`spiegel::art::tests::erzeuge_migration`,
  `src/AGENTS.md`, „Spiegel und Anträge“). Sonst zeigte ein gespiegelter Stand auf Hashes, die
  der Partner nicht hat.
- `fremdebenen[].id` im Stand wird bei der Übernahme umgeschrieben wie `bilder[].id`
  (`snapshot_bilder()` in `src/instanz/spiegel/uebernehmen.rs`): auf die lokale ID oder `null`,
  wenn die Ebene beim Partner nicht (mehr) besteht. Die ID dient nur der Sichtbarkeit je
  Arbeitsplatz; gelesen wird über den Hash. Eine Ebene mit `id: null` ist im Rückblick immer
  sichtbar und nicht ausblendbar.
- Ist eine Version beim Partner noch nicht angekommen, antwortet die Stand-Route wie die
  Live-Route (409 „wird geholt“, sofern die Live-Route das tut; sonst 404).

### Frontend: Rückblick

- `useFremdebenen` nimmt die `Standquelle` statt `aktiv`. Im Stand liest es die Liste aus
  `daten.fremdebenen` des Dokuments (gleicher Query-Key `lageSnapshotDokument`, kein zweiter
  Abruf, Vorbild `useKartenbilder`) und die Daten je Ebene über die neue Route unter einem neuen
  Key `einsatzKeys.lageSnapshotFremdebeneDaten(einsatzId, sid, sha256)` (neuer Prefix, im
  Guard ausdrücklich **draußen** gelassen, wie die Stand-Dokumente).
- Zeichnen, Farbe, Detailkarte und Druck-Legende laufen über denselben Weg wie live. Die
  Sichtbarkeit je Arbeitsplatz gilt auch im Rückblick (dieselben Ebenen-IDs).
- Die Baumzeile zeigt im Rückblick das Alter aus `fetched_at` relativ zum Stand (Datei-Ebenen
  haben keins und zeigen keins), keine Abruffehler, keine Bearbeitung. Ausblenden im Rückblick
  schreibt dieselbe Geräte-Einstellung wie live.

### Frontend: Offline-Budget

- `FremdebeneAnzeige` bekommt `data_size` (Bytes des normierten GeoJSON, `length(d.geojson)`,
  optional, fehlt ohne Daten). Damit misst der Client, ohne 8 MiB zu serialisieren.
  Typ-Codegen nachziehen (`scripts/check-typ-codegen.sh`).
- **Gezählt werden nur Ebenen, deren Daten im Cache liegen** (Entscheidung des Entwurfs).
  Ausgeblendete Ebenen laden nie Daten (`enabled: sichtbar.has(e.id)`), zählen also nicht, ohne
  dass der Filter die Geräte-Einstellung lesen muss. Die Größe kommt aus `data_size` der Liste,
  auch wenn der Cache eine ältere Version hält.
- Eine Funktion `fremdebenenAufDerPlatte(liste, imCache, budget)` in `offline/` wählt die Ebenen:
  nach `data_size` aufsteigend, bei Gleichstand neuere zuerst (`created_at` absteigend), solange
  die Summe ≤ `FREMDEBENEN_OFFLINE_BUDGET` (16 MiB, Konstante neben der Funktion).
- Der Persister-Filter (`lagebildFilter.ts` / `lagebildStandZulaessig`) lässt einen
  `fremdebeneDaten`-Key nur durch, wenn seine Ebene ausgewählt ist; die Liste der Ebenen liest
  er aus demselben dehydrierten Stand. Gilt für Live, Vorrat und `hydrate`.
- Ohne Netz zeigt die Baumzeile einer Ebene ohne Daten „ohne Netz nicht geladen“
  (`useOhneVerbindung`), die Karte zeichnet sie nicht.
- Die Regel kommt in `frontend/src/offline/AGENTS.md` (Abschnitt Lagebild ohne Netz).

## Grenzen

- Offline: 16 MiB normiertes GeoJSON je Einsatz.
- Stand-Tabelle: keine eigene Grenze; jede Version ist ≤ 8 MiB (`GEOJSON_MAX`) und dedupliziert.

## Prüfung

- Rust: Stand friert Ebenen mit Hash ein, ohne `url`; zweiter Stand ohne Änderung legt keine
  Zeile an; nach `ersetze_daten` zeigt der alte Stand den alten Inhalt; Löschen eines Stands
  räumt nur unverwiesene Zeilen; Ebene löschen lässt den Stand lesbar; Schwärzung räumt die
  Tabelle (Nachlauf); Leseroute 404 für einen Hash, den der Stand nicht nennt; Übernahme schreibt
  `fremdebenen[].id` um; Spiegel- und Registry-Wächter grün.
- Frontend: Budget-Auswahl (Grenzfälle, Gleichstand); Persister lässt Daten über dem Budget
  draußen; Rückblick zeichnet die Ebene aus dem Stand; ältere Stände ohne Feld.

## Entscheidungen des Entwurfs (zum Gegenlesen)

- Stand-Route über den Hash statt die Ebenen-ID.
- Stand-Tabelle im Nachlauf der Schwärzung, kein `JSON_TEILE`-Eintrag.
- IDs im gespiegelten Stand umschreiben wie bei Bildern, `null` = immer sichtbar.
- Offline-Budget zählt nur Ebenen mit Daten im Cache, kleinste zuerst.
- Nur Ebenen mit Daten kommen in den Stand.

## Dem Bauenden überlassen

- `Cache-Control` der Stand-Route.
- Genaue Stelle des Budget-Filters (Kürzung oder Zulässigkeit), solange Live, Vorrat und
  `hydrate` ihn gleich anwenden.
- Ob `useFremdebenen` intern in Live- und Stand-Zweig geteilt wird.
