# Design

## Context

Den Anlass nennt `proposal.md`. Den folgenden Ist-Zustand habe ich am 13.10.2026 auf `alpha` bei
Migration `0185` erhoben.

- **Backend:** `repo::liste` (`src/infotelefon/repo.rs`) lädt alle Anrufe des Einsatzes,
  geordnet nach `eingang_at DESC, id DESC`. Es gibt keinen Filter, keine Seite und keinen
  Einzelabruf. Der Index `idx_infotelefon_anruf_einsatz (einsatz_id, eingang_at)` steht seit
  `0129`.
- **Vorbilder:**
  - Die ETB-Zählung (LFH-612) teilt eine `filter_bedingung` zwischen Liste und Zählung und baut
    die Antwort mit einem vollständigen `match` über den Typ (`src/etb/zaehler.rs`). Den
    Paritätstest trägt `tests/etb_zaehler.rs`.
  - Das Presse-Log (LFH-1075) zählt über den ganzen Bestand (`…/medienkontakte/kennzahlen`). Es
    lädt offene Kontakte ganz und erledigte seitenweise mit dem Cursor `vor_zeit` + `vor_id`
    (`kommunikation::phase_und_seite`, Seitengröße 100, Obergrenze wie im ETB). Einen nicht
    geladenen Kontakt holt es für den Deeplink einzeln.
- **Abnehmer der Vollliste:** Drei Stellen lesen `ladeAnrufe` unter demselben Key
  `einsatzKeys.infotelefon(e)`:
  - `InfotelefonPage` für Protokoll, Kennzahlen und „Nach Anliegen“
  - `PressePage`, nur für die Medienlage
  - `stab/medienlageQuelle.ts` („Aus S5 übernehmen“ im Lagevortrag)
- **Live:** `EINSATZ_STREAM_EVENTS.infotelefon` invalidiert den ganzen Prefix
  `[EINSATZ_KEYS.infotelefon]`. Der Key steht nicht in `LAGEBILD_OFFLINE`.
- **Zufluss-Schleuse** (`infotelefon/zufluss.ts`): Liegt der Fokus in der Liste, merkt sie sich
  die gezeigten Kennungen und die höchste Kennung (Wassermarke). Ein Anruf, der nicht gezeigt
  ist, eine höhere Kennung hat und von einem anderen Platz stammt, wird gezählt statt
  eingeschoben.

## Goals / Non-Goals

**Goals:**

- Liste und Zählung lesen **eine** Filterbedingung. Die Parität belegt ein Test, keine
  Absprache.
- Keine Zahl auf der Seite stammt aus dem geladenen Fenster.
- Das Protokoll bleibt eine Zeitachse: jüngste oben, offene und erledigte gemischt.

**Non-Goals:**

- Volltextsuche oder Filter nach Anliegen in der Liste. Die Spec verbietet Spaltenfilter, und
  ohne Abnehmer gibt es keinen Parameter.
- Ein zeilenweiser Live-Abgleich wie bei den Medienkontakten (LFH-931); Begründung in D5.
- Druck oder Export des Protokolls.

## Decisions

### D1 Eine Filterbedingung für Liste und Zählung

`repo.rs` bekommt `struct AnrufFilter { status: Option<InfotelefonStatus> }` und eine Funktion
`filter_bedingung(qb, einsatz_id, &filter)` auf einem `sqlx::QueryBuilder`. Sie schreibt
`WHERE a.einsatz_id = ? [AND a.status = ?]`. Zwei Abfragen verwenden sie:

- `liste_seite(pool, einsatz_id, &filter, &seite)` hängt den Cursor an
  (`AND (a.eingang_at < ? OR (a.eingang_at = ? AND a.id < ?))`), dazu
  `ORDER BY a.eingang_at DESC, a.id DESC LIMIT ?`.
- `zaehlen(pool, einsatz_id, &filter)` liest `SELECT a.anliegen, a.status, COUNT(*) … GROUP BY
  a.anliegen, a.status`.

Das Alias `a` gilt in beiden Abfragen, damit dieselbe Bedingung passt. Der Cursor gehört nicht
zur Filterbedingung. Deshalb kann ihn der Zähl-Endpunkt gar nicht anwenden, und das Ignorieren
der Seitenparameter folgt aus dem Bau.

*Verworfen:* die Gesamtzahl als Kopfzeile der Listenantwort (`X-Total-Count`). Die Medienlage
braucht die Zahlen ohne Liste, und das ETB hat den eigenen Endpunkt schon etabliert.

### D2 Die Liste ist immer geblättert, über den Cursor Eingang + Kennung

`GET …/stab/infotelefon` nimmt `status`, `vor_zeit`, `vor_id` und `limit` und liefert stets eine
Seite. `limit` hat die Vorgabe `kommunikation::SEITE_STANDARD` (100) und wird auf
`SEITE_MAX` geklemmt.

Das Auslesen von Cursor und Seitengröße steckt heute in `phase_und_seite` und ist dort an
`phase=abgeschlossen` gebunden. Es wird zu `kommunikation::seite(vor_zeit, vor_id, limit) ->
Result<Seite, AppError>` herausgelöst: halber Cursor → 422, Klemmen. `phase_und_seite` ruft es
danach selbst, ihre Tests bleiben unverändert grün. Ein unbekannter `status` liefert 400 über
`parse_enum_opt`. Ein unlesbarer Zeitwert im Cursor wird nicht geprüft: Er vergleicht sich nur
als Text, wie beim Presse-Log.

Der Cursor ist `(eingang_at, id)` und nicht die Kennung allein. Die Liste ist nach Eingang
geordnet, und ein nachgetragener Anruf hat einen frühen Eingang, aber eine hohe Kennung.

*Verworfen:*

- **Das Muster des Presse-Logs (offene ganz, erledigte seitenweise):** Es ordnet offene zuerst.
  Das Protokoll ist aber eine gemischte Zeitachse (Spec: „jüngste oben“), und bei einer
  Großlage können auch die offenen Rückrufe in die Hunderte gehen.
- **Ohne Parameter weiter die Vollliste:** Genau sie soll weg, und der einzige Abnehmer zieht im
  selben PR mit. Ein Schalter für „alles“ bliebe eine Einladung zur Vollabfrage.

### D3 Die Zählung als eigenes DTO mit festen Feldern je Anliegen

`InfotelefonZaehler { gesamt, offen, je_anliegen: InfotelefonAnliegenZaehler }` mit sieben
`i64`-Feldern, benannt wie die Wire-Werte (`vermisstensuche` … `sonstiges`). `aus_zeilen` baut
die Antwort mit einem vollständigen `match` über `InfotelefonAnliegen`, wie `EtbZaehlerAnzeige`.
Ein neues Anliegen bricht so den Build, und ein unbekannter String ist ein 500, kein stilles
Weglassen. `offen` zählt die Zeilen mit `status = 'offen'`. Beide Typen bekommen `ToSchema` und
einen Eintrag in `api_doc.rs`, das Frontend liest sie aus `types.generated.ts`.

*Verworfen:* eine Map `anliegen → anzahl`. Ihr fehlten Anliegen ohne Anruf, und die Spec
verlangt alle sieben.

### D4 Einzelabruf für den Deeplink

`GET …/stab/infotelefon/{aid}` ruft das vorhandene `repo::laden` (404 bei fremdem Einsatz).
`useQueryParamSelektion('anruf', …)` schaltet auf „alle“ und hebt hervor. Steht der Anruf in
keiner geladenen Seite, holt die Seite ihn einzeln und hängt ihn ans Ende der Zeitachse. Dorthin
gehört er auch, denn er ist älter als alles Geladene. Das ist dasselbe Verhalten wie
`verlinkteQuery` auf der Presseseite.

### D5 Query-Keys unter dem bestehenden Prefix, Live ohne neues Ereignis

`einsatzKeys.infotelefon(e)` bleibt der Invalidierungs-Prefix. Darunter kommen drei Sub-Keys:

- `infotelefonListe(e, sicht)` → `[K, e, 'liste', sicht]` mit `sicht: 'alle' | 'offen'`
- `infotelefonZaehler(e)` → `[K, e, 'zaehler']`
- `infotelefonAnruf(e, id)` → `[K, e, 'anruf', id]`

`EINSATZ_STREAM_EVENTS.infotelefon` bleibt `[EINSATZ_KEYS.infotelefon]` und trifft damit alle
drei. `LAGEBILD_OFFLINE` bleibt ohne den Prefix. Mutationen invalidieren weiter den Prefix.

*Verworfen:* ein zeilenweiser Abgleich nach `anruf_id` wie bei den Medienkontakten. Ein neuer
Anruf braucht ohnehin die erste Seite neu, und das ist der häufigste Fall am Bürgertelefon. Der
Sammler (`live/liveInvalidierung.ts`) bündelt einen Schwall auf einen Abruf je 300 ms. Kosten
und Abhilfe stehen unter Risks.

### D6 Protokollseite: Fenster, Zählung, Zufluss

- **Liste:** `useInfiniteQuery` auf `infotelefonListe(e, sicht)`. Die Seite ist zu Ende, wenn sie
  weniger als `ANRUFE_SEITE` (100) Anrufe trägt. Sonst ist der Cursor der letzte Anruf. Die
  Seiten werden zusammengefügt und nach Kennung entdoppelt: Ein Live-Nachladen verschiebt die
  Grenze, und ein Anruf darf nicht doppelt stehen. Das ist dasselbe Vorgehen wie bei den
  erledigten Medienkontakten. Am Ende der Liste steht „Ältere laden“, innerhalb des
  Listencontainers.
- **Segmentleiste:** Sie wählt den Key, nicht einen Client-Filter. „offene Rückrufe“ blättert
  serverseitig mit `status=offen`.
- **Zahlen:** `useQuery` auf `infotelefonZaehler(e)`, ungefiltert. Die Kennzahlen, die Meta im
  Kopf unter `md` und „Nach Anliegen“ lesen nur diese Antwort. Den `KennzahlZustand` leitet die
  Seite aus der Zählung ab, nicht aus der Liste. „Nach Anliegen“ zeigt wie heute nur Anliegen mit
  mindestens einem Anruf, in `ANLIEGEN_REIHENFOLGE`.
- **Zufluss-Schleuse:** `teileZufluss` arbeitet unverändert auf dem geladenen Fenster. Neu ist
  `erweitere(gefroren, anrufe)`: Es nimmt Kennungen in den eingefrorenen Stand auf und lässt die
  Wassermarke stehen. „Ältere laden“ ruft es mit der neuen Seite, sobald sie da ist. Sonst würde
  ein nachgetragener Anruf (alter Eingang, hohe Kennung) aus einer älteren Seite als „neuer
  Anruf“ zurückgehalten, solange der Fokus im Knopf liegt.

### D7 Medienlage und Presseseite lesen die Zählung

`MedienlageQuellen.anrufe` wird zu `Quelle<InfotelefonZaehler>`. Der Teil bildet
`{ gesamt, offeneRueckrufe: offen, jeAnliegen }` aus der Antwort und zählt nichts mehr selbst.
`medienlageQuelle.ts` lädt die Zählung über `ladeListe(qc, einsatzKeys.infotelefonZaehler(e),
…, null)`, so wie die Kontakt-Kennzahlen. `PressePage` ersetzt die Anrufliste durch dieselbe
Zählung und lädt damit keine personenbezogenen Anrufdaten mehr, nur weil die Medienlage sie
braucht.

### D8 Regeln und Anwenderdoku

- `frontend/src/stab/AGENTS.md`: Den Satz „Informationstelefon: Vollliste … (serverseitig
  LFH-862)“ ersetzt der neue Stand: Fenster, Zählung, Einzelabruf, `erweitere`, mit Verweis auf
  diese Change.
- `docs/anwender/kapitel/presse-infotelefon.md` bekommt einen Satz zu „Ältere laden“. Die
  Kennzahlen zählen weiterhin alle Anrufe. Das Bild bleibt, denn mit den Bilddaten (unter 100
  Anrufe) ändert sich die Ansicht nicht.

## Risks / Trade-offs

- **[Ein Live-Ereignis lädt alle geladenen Seiten neu]** TanStack holt bei der Invalidierung
  jede Seite der Kette erneut. → Meist ist nur die erste Seite geladen, und der Sammler bündelt
  Schwälle. Zeigt der Feldbetrieb lange Ketten, folgt der zeilenweise Abgleich (D5, verworfen)
  als eigener Schritt.
- **[Kennzahl und Liste laufen kurz auseinander]** Liste und Zählung sind zwei Abrufe. Zwischen
  ihnen kann ein Anruf eingehen. → Beide hängen am selben Ereignis, der nächste Abgleich zieht
  sie gleich. Die Spec verlangt Parität bei gleichem Stand, nicht im selben Abruf.
- **[Text-Vergleich des Cursors]** `eingang_at` vergleicht sich als Text. → Jede Eingabe läuft
  über `normalisiere_zeit` oder `zeit::jetzt`, beide liefern dasselbe UTC-Format. So arbeitet
  auch das Presse-Log.
- **[Deeplink-Zeile am Ende]** Ein einzeln geholter Anruf steht hinter dem Fenster, mit einer
  Lücke dazwischen. → Er ist hervorgehoben und wird angesprungen. „Ältere laden“ schließt die
  Lücke, und ab dann steht er an seinem Platz (Entdopplung).

## Migration Plan

Keine Datenmigration. Backend und Frontend kommen im selben PR, und das eingebettete Frontend
passt immer zum Binary. Zurück geht es per Revert des PR.
