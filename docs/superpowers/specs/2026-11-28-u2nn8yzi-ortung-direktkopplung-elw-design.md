# Fahrzeugortung über eine Direktkopplung zweier ELW (LLH-2144)

**Status:** Entwurf, wartet auf Freigabe · **Datum:** 2026-11-28 · **Zunder:**
https://zunder.rubeen.dev/#/aufgabe/u2nn8yzi2gs9gl3bbq3e8azo · **Route:** `entwurf` (E1 Richtung
der Lieferung, E2 neue ADR neben ADR-0109, E3 `src/` und `frontend/`)

Vorgängerin: LLH-2119, `docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`
(Ortung über den Hub, ADR-0109). Dieser Entwurf baut auf ihr auf und wiederholt ihre Regeln nicht.

## Absicht

LLH-2119 schließt die Lücke Hub ↔ ELW: Das führende ELW holt im Abgleich die Positionen der
Hub-Kennungen, die es gekoppelt hat. Bei einer **Direktkopplung zweier ELW** (`art = 'vor_ort'`,
LLH-1497/LLH-1868) gibt es diesen Weg noch nicht, und die Lage ist anders:

- Eine Direktkopplung macht keine Seite zum Hub (`hub_fuer_org` zählt nur `standard`). **Beide ELW
  nehmen Einwurf an.** Ein Gerät meldet an das ELW, dessen Einwurf-Zugang es trägt.
- Führen kann **jede** der beiden Seiten (Führungswechsel gleichrangig, `Wechselregel::Gleichrangig`),
  unabhängig davon, welche den Abgleich ruft (`meldet_sich`) und welche gerufen wird
  (`wird_gemeldet`).

Die Lücke: Ein Gerät meldet an ELW B, ELW A führt den Einsatz. Am ELW B ist der Einsatz ein
Spiegel, die Position erreicht das Fahrzeug nie.

Ziel: Am führenden ELW lässt sich ein Fahrzeug an eine Kennung des Partner-ELW koppeln, und die
Position kommt im Takt des Abgleichs an, egal welche Seite ruft.

## Ziele

- Am führenden ELW zeigt der Koppeldialog neben den eigenen Kennungen (bzw. denen des Hubs) die
  Kennungen jedes direkt gekoppelten ELW, mit dem Zusatz „über <Name des Gegenübers>“.
- Gekoppelt wird wie heute, ETB-Eintrag wie heute.
- Die Position kommt im Abgleich: Ruft das führende ELW, binnen eines Abgleichs (≈ 5 s); wird es
  gerufen, einen Takt später (≈ 10 s).
- Am Fahrzeug gelten dieselben Regeln wie bei LLH-2119: Baustein, Vorrang, Drossel 15 s,
  Org-Schalter, Ende, kein Nachlauf.
- Der Spiegel am liefernden ELW sieht die Position über den bestehenden Spiegel, einen Abgleich
  nach dem Fahrzeug am Führer (wie bei LLH-2119: geliefert wird in der Transaktion, übernommen
  danach).

## Nicht-Ziele

- Ketten: Ein ELW liefert nur Positionen **aus seinem eigenen Einwurf** (`position_letzte`), nie
  eine, die es selbst über eine Kopplung bekommen hat (Hub → ELW B → ELW A gibt es nicht).
- Die Kopplung geht bei einem Führungswechsel nicht an den neuen Führer über (wie LLH-2119).
- Kein neuer Kanal, keine neue Tabelle, keine Migration.
- Am Hub ändert sich nichts. Über eine Standardkopplung bleibt es bei LLH-2119: nur die
  erreichte Seite (Hub) beantwortet, nur die meldende Seite (ELW) fragt.

## Anti-Ziele

- Eine Koordinate verlässt ein ELW für eine Kennung, die das Gegenüber nicht angefragt hat.
- Die liefernde Seite hält dauerhaft fest, welche Kennungen das Gegenüber gekoppelt hat.
- Ein Spiegel schreibt eine Position, oder ein Antrag trägt Positionen.
- Ein Protokoll trägt Kennung, Schlüssel oder Koordinaten.
- Ein ELW mit Stand LLH-2119 oder älter bricht den Abgleich wegen der neuen Nutzung.

## Rahmen

- **ADR-0109** (akzeptiert, unveränderlich) bleibt für den Hub-Weg. Der neue Weg steht in einer
  **neuen, ergänzenden ADR-0112** (nächste freie Nummer auf `alpha`, vor dem Commit prüfen).
- **ADR-0039:** Nur über eine Org-Abbildung der Kopplung (`instanz_kopplung_org`, nicht widerrufen).
- **ADR-0018/0103:** Geschrieben wird nur am führenden ELW über `schreibe_position`, Quelle
  `einwurf`, nur an einem aktiven Fahrzeug eines aktiven, nicht gespiegelten Einsatzes.
- **Org-Schalter** `ortung_im_einsatz`: Über eine Direktkopplung fließen keine Stammdaten
  (`Fluss::Stammdaten` trägt `vor_ort` nicht). Der Schalter ist also je ELW ein eigener, und
  **beide** müssen an sein: das führende prüft beim Koppeln, Anfragen und Übernehmen, das
  liefernde beim Beantworten.
- **Org-Kennung im Draht:** Alle `tracking_*`-Felder nennen die Org mit ihrer Wire-Kennung, wie
  `org_wire` in `abgleich.rs` sie bildet (immer die Kennung der erreichten Seite). Dieselbe
  Kennung gilt also in beiden Paketrichtungen.
- **Protokoll:** Die Felder des `SpiegelPaket` gibt es seit LLH-2119 (`#[serde(default)]`).
  Neu ist nur, dass sie auch in der jeweils anderen Richtung belegt werden. `PROTOKOLL_SPIEGEL`
  bleibt.

## Ansätze

Am Checkpoint (28.11.2026) lag der Weg mit sechs Punkten vor; Ruben: „passt“.

1. **A: Symmetrisch im bestehenden Abgleich (gewählt).** Wer den Einwurf-Zugang hält, liefert,
   wer führt, fragt. Beide Paketrichtungen tragen Anfragen und Antworten. Gewählt, weil er den
   Weg aus `src/ortung/fern.rs` wiederverwendet, keine Migration braucht und beide Führungslagen
   abdeckt.
2. **B: Nur wenn das rufende ELW führt.** Genau der Hub-Weg, nur die Sperre auf `Standard` fällt.
   Verworfen: deckt nur die Hälfte der Fälle ab; welche Seite ruft, hängt davon ab, wer die
   Kopplung eingerichtet hat, nicht davon, wer führt.
3. **C: Eigene Zeilenart in `ortung_kopplung` für Direktkopplungen.** Verworfen: Die Fern-Zeile
   aus LLH-2119 (`instanz_kopplung_id`, `fremder_zugang_id`, `zugang_name`) hängt schon an einer
   beliebigen Instanzkopplung; die Art steht an der Kopplung.

Ebenso abgestimmt: eine gemeinsame Kandidatenliste statt Reitern je Quelle, und eine neue ADR
statt einer Änderung an ADR-0109.

## Entwurf

### Wer fragt, wer antwortet

Je Kopplung und Paketrichtung:

| Kopplung | Paket | trägt Anfragen von | trägt Antworten von |
|---|---|---|---|
| `standard` | Anfrage (ELW → Hub) | ELW | — |
| `standard` | Antwort (Hub → ELW) | — | Hub |
| `vor_ort` | Anfrage (rufendes → gerufenes ELW) | rufendem ELW | rufendem ELW, auf die Anfragen der letzten Antwort |
| `vor_ort` | Antwort (gerufenes → rufendes ELW) | gerufenem ELW | gerufenem ELW, auf die Anfragen dieses Pakets |

„Anfragen“ = `tracking_requests` und `tracking_candidates_wanted`, „Antworten“ =
`tracking_positions` und `tracking_candidates`. Inhalt und Grenzen wie in LLH-2119
(`TRACKING_ANFRAGEN_MAX`, `TRACKING_KANDIDATEN_MAX`, Platz bis `SPIEGEL_MAX`).

**Ablauf, wenn das rufende ELW führt:** wie beim Hub, ein Durchgang.

**Ablauf, wenn das gerufene ELW führt:**

1. Gerufenes ELW (Führer) legt in seine Antwort Anfragen für seine Fern-Kopplungen an diese
   Kopplung (`build_requests`), außerhalb der Schreibtransaktion, nach dem Commit, wie
   `answer_hub` heute. Sie bekommen nur den Restplatz bis `SPIEGEL_MAX` und werden wie in `passt`
   gekürzt; Lieferungen behalten Vorrang (meine Wahl nach der Gegenlese: der Abgleich darf nie an
   der Ortung scheitern, fehlende Anfragen kommen im nächsten Takt).
2. Rufendes ELW (Lieferant) übernimmt die Antwort und merkt sich die Anfragen im Speicher
   (**Anfragepuffer** je Kopplung, s. u.).
3. Beim nächsten Abgleich legt es die Antworten (`answer_…`) in die erste Runde seiner Anfrage.
4. Gerufenes ELW übernimmt die Positionen nach dem Commit von `handle_abgleich`
   (`apply_answer` mit dem Anfragepaket), in eigener Transaktion, danach Live-Meldung.

**Anfragepuffer** (meine Wahl, Alternative unten): prozessweit im Speicher, je Kopplung genau die
Anfragen der letzten Antwort, ohne Koordinaten. Jede neue Antwort ersetzt ihn; er verfällt nach
30 s, wird nach dem Beantworten nicht gelöscht (die nächste Antwort ersetzt ihn ohnehin). Das ist
kein dauerhafter Zustand im Sinn des Anti-Ziels: er lebt einen Takt, überlebt keinen Neustart und
wird nie gelesen außer zum Beantworten. Die Alternative, im selben Abgleich eine zusätzliche
Runde nur für die Antworten zu schicken, halbiert die Latenz, kostet aber alle 5 s einen
zusätzlichen Aufruf und fasst die Rundenlogik (`RUNDEN_MAX`) an.

### Code in `src/ortung/fern.rs`

- `answer_hub` wird zur allgemeinen Antwort (Name dem Bauenden überlassen, etwa `answer_requests`)
  und nimmt die Org-Kennung über `org_wire` statt fest über `org_kennung(eigen…)`. Er antwortet:
  - über `standard` nur als erreichte Seite (wie heute);
  - über `vor_ort` auf beiden Seiten.
- `build_requests` bildet die Org-Kennung über `org_wire` statt fest über `fremde_org_kennung`.
  Er wird gerufen:
  - als rufende Seite in Runde 0 (wie heute, jede Art);
  - als gerufene Seite nur über `vor_ort`, für die Antwort.
- `apply_answer` nimmt die Org-Kennung über `org_wire` und wird gerufen:
  - als rufende Seite mit der Antwort (wie heute);
  - als gerufene Seite mit dem Anfragepaket, nur über `vor_ort`.
- Die Positionsanfrage des Lieferanten liest weiter nur `position_letzte` mit
  `einwurf_zugang` der Org (unverändert). Damit gilt „keine Ketten“ von selbst: eine über eine
  Kopplung übernommene Position steht am Fahrzeug, nie in `position_letzte`.
- Sammelzeilen, Fehlerfreiheit nach außen und das Logverbot gelten unverändert; die Texte der
  Sammelzeilen sagen „Gegenüber“ statt „Hub“.

### Kandidaten am führenden ELW

`GET …/tracking/candidates` setzt die Liste aus Quellen zusammen:

1. **Eigene Quelle:** Hat die Org einen Hub (`hub_kopplung_fuer_org`), dessen Puffer (wie heute);
   sonst die eigene Ablage (`list_kandidaten`, wie heute).
2. **Je aktive Direktkopplung** mit nicht widerrufener Abbildung dieser Org: deren Puffer
   (`cached_candidates`), mit Wunsch und `takt::wecken`, wenn er nicht frisch ist — dieselbe
   Logik wie heute beim Hub (`PUFFER_FRISCH` 10 s, `PUFFER_VERFALL` 60 s).

`pending` ist wahr, solange eine Fernquelle nicht frisch ist. Einträge, die schon da sind, zeigt
die Liste trotzdem, und sie sind wählbar.

**Partner, der nicht antwortet** (Gegenlese; meine Wahl): Ein Partner mit Stand LLH-2119 oder
älter beantwortet Wünsche nie. Statt einer neuen Protokollversion wird das je Quelle
hingenommen:
- Ein Lieferant mit neuem Stand antwortet auf **jeden** Wunsch einer abgebildeten Org mit einem
  Eintrag, auch leer oder mit `tracking_enabled = false`. So ist „antwortet nicht“ eindeutig ein
  älterer oder unerreichbarer Partner.
- Die Antwort nennt je Fernquelle, ob sie aussteht (`pending_sources: Vec<i64>` mit den
  `via_coupling_id`, zusätzlich zu `pending`). Der Dialog zeigt nach 15 s „<Name> antwortet gerade
  nicht“ nur für diese Quelle; die übrigen Kennungen bleiben wählbar.
- Ein dauerhaft stummer Partner kostet also bei jedem Öffnen eine Ladezeile, sperrt aber nichts.
  Wird das lästig, kommt eine Protokollversion als Folgeaufgabe.

`TrackingCandidate` bekommt zwei Felder dazu (additiv, englisch wie der Typ):

- `via: Option<String>` — Name des Gegenübers (`gegenueber_name`), bei eigener Ablage `null`.
- `via_coupling_id: Option<i64>` — die Instanzkopplung, bei eigener Ablage `null`.

`via_hub` bleibt (wahr bei der Hub-Quelle), damit nichts bricht; der Dialog liest künftig `via`.
`coupled` bestimmt das führende ELW aus seinen Fern-Zeilen dieser Kopplung (wie heute beim Hub).
`tracking_enabled` ist künftig nur der **eigene** Schalter (er sperrt den Dialog wie heute).
Der Schalter einer Fernquelle, Hub wie Partner-ELW, blendet nur deren Einträge aus (meine Wahl
nach der Gegenlese, gleiche Regel für alle Quellen). Heute sperrt ein ausgeschalteter Hub den
ganzen Dialog; mit nur einer Quelle sieht das für den Bediener fast gleich aus („keine
Kennungen“), mit Partnern blieben sonst deren Kennungen grundlos gesperrt.

Wird das führende ELW gerufen, nützt `takt::wecken` nichts; der Wunsch geht mit der nächsten
Antwort hinaus, die Liste kommt einen Takt später (≤ 10 s bei aktivem Einsatz, unter den 15 s
Geduld des Dialogs).

### Koppeln und Trennen

`PUT …/tracking` bekommt `via_coupling_id: Option<i64>` im Body (`TrackingRequest`).

- `null`: wie heute (Hub, wenn die Org einen hat, sonst lokal).
- gesetzt: Die Kopplung muss aktiv sein, die Org über sie abgebildet sein, und sie muss entweder
  der Hub der Org (`standard`) oder eine Direktkopplung (`vor_ort`) sein, sonst 422. Die Kennung
  muss im Puffer dieser Kopplung stehen, sonst 422 „Kennung nicht mehr verfügbar“. Dann
  `create_hub_kopplung_tx` (im Bau umbenennen: `create_fern_kopplung_tx`) mit dieser Kopplung.
- Alle übrigen Prüfungen, ETB-Text und Takt-Wecken wie bei LLH-2119.

`DELETE`, Entlassen, Stornieren, Ablehnen, Abschluss und Führungsabgabe arbeiten schon auf der
Zeile, egal welcher Art: nichts zu tun.

**Rückgängig nach Entlassen** (`disposition_repo.rs`, heute `hub_kopplung_fuer_org`): Die
Wiederherstellung prüft dieselbe Regel wie `PUT` mit `via_coupling_id`: die gespeicherte
`instanz_kopplung_id` ist aktiv, die Org ist über sie abgebildet, und sie ist der Hub der Org
(`standard`, `meldet_sich`) oder eine Direktkopplung (`vor_ort`). Eine gemeinsame Hilfsfunktion
trägt die Regel für beide Stellen. Ohne Pufferprüfung, wie bei LLH-2119.

**Benennung:** „Hub-Kopplung“ heißt im Code, wo er angefasst wird, „Fern-Kopplung“
(`KopplungZugang::Hub` → `Fern`, Kommentare). Die Umbenennung kommt als eigener
`refactor`-Commit (AGENTS.md, „Bestand beim Anfassen“).

### Oberfläche

- **Koppeldialog** (`frontend/src/kraefte/OrtungKoppelnDialog.tsx`):
  - Zusatz „ · über <via>“ statt „ · über den Hub“. Beim Hub steht damit dessen Name da (meine
    Wahl, einheitlich und genauer).
  - Auswahlwert enthält `via_coupling_id`, damit gleiche Zugangs-IDs zweier Quellen nicht
    zusammenfallen; `PUT` schickt `via_coupling_id` mit.
  - Ladezeile „Kennungen werden von den gekoppelten Instanzen geholt …“, Zeitüberschreitung
    „Eine gekoppelte Instanz antwortet gerade nicht. Später erneut versuchen.“ Beim reinen
    Hub-Fall bleiben die heutigen Sätze mit „Hub“ (meine Wahl: der Text nennt, was der Bediener
    kennt; Bauender darf vereinheitlichen).
- **Fahrzeugzeile am Spiegel:** keine Änderung; die Marke „Ortung“ am Spiegel aus LLH-2119 gilt
  auch hier.
- Query-Keys unverändert (Kandidaten in `NICHT_LIVE_KEYS`, `refetchInterval` nur im offenen Dialog).
- Typen neu erzeugen (`scripts/check-typ-codegen.sh`).

### Doku

- **ADR-0112** „Über eine Direktkopplung liefert das ELW mit dem Einwurf-Zugang Positionen nur für
  Kennungen, die das führende ELW gekoppelt hat“ (ergänzt ADR-0109, kein `ersetzt`). Regeln:
  - Anfragen und Antworten in beiden Paketrichtungen nur über `vor_ort`; über `standard` bleibt
    ADR-0109.
  - nur auf Anfrage, nur über eine abgebildete Org, nur gültiger Zugang mit `positionen:write`;
  - Org-Schalter auf beiden Seiten;
  - Kandidaten ohne Koordinaten;
  - geliefert wird nur aus `position_letzte` (eigener Einwurf), keine Weitergabe übernommener
    Positionen;
  - die Anfragen des Gegenübers liegen höchstens einen Takt im Speicher (≤ 30 s), nie in der
    Datenbank;
  - geschrieben wird nur am Führer über `schreibe_position`, kein Nachlauf;
  - kein Protokoll mit Kennung, Schlüssel oder Koordinaten.
  - Prüfung per `verlange`/`verbiete`: etwa `position_letzte` in `fern.rs` als einzige
    Positionsquelle, weiter `verbiete 'INSERT INTO|CREATE TABLE'` und das Logverbot aus ADR-0109.
- **Architektur:** Kapitel 6 Ablauf „Ortung über den Hub“ um die Direktkopplung ergänzen; Kapitel 8
  Datenschutz: Koordinaten verlassen ein ELW zum direkt gekoppelten führenden ELW.
  Mitänderungsregel nach `docs/architektur/AGENTS.md`.
- **Anwender:** `fahrzeuge.md` (Ortung über ein direkt gekoppeltes ELW koppeln) und
  `anbindungen.md` (Direktkopplung: beide Schalter, DSFA-Empfänger „führendes ELW“). Bilder nach
  `docs/anwender/AGENTS.md`.
- Spec LLH-2119, „Offen für später“: Verweis auf diese Spec.

### Tests (Akzeptanzkriterien)

- **Zwei ELW mit `vor_ort`-Kopplung**, Muster der Spiegeltests von LLH-2119:
  - Rufendes ELW führt, gerufenes hält Zugang und Position: nach einem Abgleich steht die Position
    am Fahrzeug des Führers (Quelle `einwurf`), nach zwei am Spiegel.
  - Gerufenes ELW führt, rufendes hält Zugang und Position: nach zwei Abgleichen am Fahrzeug des
    Führers, nach einem noch nicht; nach drei am Spiegel.
- Kandidaten in beiden Lagen: Wunsch → Liste im Puffer, ohne Koordinaten; `via` und
  `via_coupling_id` gesetzt; eigene Ablage zusätzlich in der Liste.
- Geliefert wird nichts für: nicht angefragte Kennung, nicht abgebildete Org, widerrufenen oder
  abgelaufenen Zugang, Zugang ohne `positionen:write`, ausgeschalteten Schalter am Lieferanten,
  ausgeschalteten Schalter am Führer (dann fragt er nicht).
- **Keine Kette:** ELW B hat eine Position über eine Kopplung übernommen (nicht aus eigenem
  Einwurf); ELW A fragt dieselbe Kennung an und bekommt nichts.
- Über `standard` bleibt alles wie LLH-2119: der Hub legt keine Anfragen in die Antwort, das ELW
  beantwortet keine.
- Ein Lieferant mit neuem Stand antwortet auf jeden Wunsch einer abgebildeten Org mit einem
  Eintrag; ein stummer Partner steht in `pending_sources`, die übrigen Quellen sind wählbar.
- Ausgeschalteter Schalter einer Fernquelle blendet nur deren Einträge aus.
- Anfragen des gerufenen Führers in einer fast vollen Antwort werden gekürzt, der Abgleich läuft.
- Anfragepuffer verfällt: Anfragen älter als 30 s werden nicht beantwortet.
- Ein Partner mit Stand LLH-2119 (Felder da, Gegenrichtung ungenutzt): Abgleich läuft, nichts
  kommt an.
- `PUT` mit `via_coupling_id` einer fremden, nicht aktiven oder nicht abgebildeten Kopplung: 422;
  Kennung nicht im Puffer: 422; doppelt: 409.
- Rückgängig nach Entlassen stellt eine Fern-Kopplung über `vor_ort` wieder her, nicht aber über
  eine Standardkopplung, an der diese Instanz der Hub ist.
- Führungsabgabe am führenden ELW beendet die Fern-Kopplung ohne ETB-Eintrag (bestehender Test,
  mit `vor_ort` parametrisieren, wo billig).
- Frontend: Dialog zeigt „über <Name>“, schickt `via_coupling_id`, Lade- und Zeitüberschreitungstext.

## Nach der Gegenlese

Ein Gegenleser hat den Entwurf als Bauender gegen den Code gelesen. Seine Punkte sind oben
eingearbeitet und als „meine Wahl“ markiert: Umgang mit einem stummen Partner, Schalter je
Quelle, gekürzte Anfragen, Rücknahme mit der Regel von `PUT`, Zählung der Abgleiche am Spiegel.

## Dem Bauenden überlassen

- Namen von Funktionen und Hilfen, solange Wire-Felder englisch und additiv bleiben.
- Ob der Anfragepuffer neben dem Kandidatenpuffer in `fern.rs` wohnt.
- Wo genau in `abgleich_einmal` die Antworten des rufenden ELW gebaut werden, solange sie in
  Runde 0 stehen und gegen den Platz bis `SPIEGEL_MAX` gerechnet werden.

## Offen für später

- Ketten über mehr als eine Kopplung, falls ein Verbund Hub → ELW → ELW im Betrieb auftaucht.
- Kopplung bei Führungswechsel an den neuen Führer übergeben (wie bei LLH-2119 offen).
