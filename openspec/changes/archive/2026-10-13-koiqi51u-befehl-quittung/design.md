# Design

## Context

LLH-1172 hat den Verteiler an Befehl und Lagebericht gebracht
(`openspec/changes/archive/2026-10-12-kz5udbog-verteiler-vorlagendokument/design.md`). Dort steht
unter D5a schon, wie die Quittung hineinpasst:

- eine Zeile je Empfänger in `befehl_verteiler` und `lagebericht_verteiler` (Migration `0183`);
- je Fassung eigene Zeilen, weil das Fortschreiben sie kopiert (`verteiler::copy_tx` mit
  expliziter Spaltenliste);
- im Entwurf werden die Zeilen ersetzt, sobald die Fassung freigegeben ist, sind sie eingefroren.

Geladen wird der Verteiler als JSON-Unterabfrage (`verteiler::json_column`) im `select` des
Dokuments. Die Liste (`repo::liste_koepfe` → `DokumentKopf` → `BefehlKopf`) trägt ihn bisher
nicht.

Vorbild ist die Quittung des Auftrags:

- Spalten `auftrag_empfaenger.quittiert_at` und `quittiert_von_id`;
- `POST …/auftraege/{aid}/empfaenger/{empf}/quittieren`, idempotent über `COALESCE`;
- im Frontend `AuftragQuittungsstand` und `AuftragEmpfaenger` in `auftraege/AuftragTeile.tsx`,
  Empfängerfilter inline in `auftraege/AuftraegeListe.tsx`.

Eine Rücknahme gibt es dort nicht, das Quittieren schreibt nicht ins ETB, und deshalb steht vor
dem Quittieren eine Rückfrage. Die Entscheidungen vom 13.10.2026 (Kommentar an LLH-1173) legen
für den Befehl anders fest: ETB-Eintrag mit Gegeneintrag, quittierbar nur die jüngste
freigegebene Fassung, nur am Befehl, keine Geräte.

## Goals / Non-Goals

**Goals:**

- Quittieren und Zurücknehmen je Verteiler-Zeile, atomar mit dem ETB-Eintrag.
- Liste und Detail des Befehls zeigen Verteiler und Quittungsstand mit den Bausteinen des
  Auftrags, nicht mit Kopien davon.
- Ein Empfängerfilter, den beide Reiter teilen.
- Der Wortlaut der Freigabe, die Auftragsquittung und der Lagebericht bleiben aus Bediensicht
  unverändert.

**Non-Goals:**

- Quittung am Lagebericht, Quittung durch Geräte (Folgeaufgabe), Rücknahme der Auftragsquittung.
- Rücknahme außerhalb des Rückgängig-Hinweises, also ein dauerhafter Knopf „Quittung
  zurücknehmen“.
- Quittungsstand auf der Vollseite und im Ausdruck des Befehls. Die Vollseite bleibt
  Schreib-, Druck- und Deeplink-Ziel, gehandelt wird im Detail.
- Serverseitiger Empfängerfilter für Befehle.

## Decisions

### D1 Zwei Spalten an beiden Verteilertabellen

Migration `0187_verteiler_quittung.sql` fügt an `befehl_verteiler` und `lagebericht_verteiler`
per `ALTER TABLE … ADD COLUMN` diese Spalten an:

- `quittiert_at TEXT`
- `quittiert_von_id INTEGER REFERENCES benutzer(id)`

Beide sind nullable wie bei `auftrag_empfaenger`. Es gibt keinen Tabellenumbau und keine
Datenübernahme.

**Warum beide Tabellen:** `json_column` und `copy_tx` bauen ihr SQL aus der Tabellenkonstante
der Art. Hätte nur eine Tabelle die Spalten, bräuchte der Kern einen zweiten Haken oder eine
Verzweigung je Art. Am Lagebericht bleiben die Spalten leer, weil es dort keine Route gibt, die
sie schreibt.

**Verworfen:** *Eine eigene Tabelle `befehl_verteiler_quittung`.* Sie bräuchte einen Join und
eigene Schwärzungsregeln, und sie trüge nur die zwei Spalten, die die Zeile schon tragen kann
(D5a von LLH-1172).

### D2 Lesen: Quittung im Eintrag, Quittierbarkeit am Dokument, Verteiler im Kopf

- `json_column` liest `quittiert_at` und `quittiert_von_id` mit.
  `VerteilerEintragAnzeige` bekommt beide als optionale Felder (`skip_serializing_if` wie die
  übrigen optionalen Felder). Beim Lagebericht fehlen sie damit auf dem Wire.
- `Dokument<A>` und `DokumentKopf` bekommen `is_quittierbar: bool`. Das SQL berechnet es: die
  Fassung ist freigegeben, und keine andere Fassung derselben Kette ist später freigegeben (bei
  gleicher Sekunde entscheidet die id). Die Kette bestimmt eine rekursive CTE: erst zur Wurzel
  über `vorgaenger_id`, dann den ganzen Baum hinab. Eine Prüfung nur der **direkten**
  Nachfolgerin reicht nicht: Auch eine schon überholte Fassung lässt sich fortschreiben, und deren
  Freigabe überholt alle anderen. Das hat der Review gefunden; der Test
  `nach_einer_zweiten_fortschreibung_der_alten_fassung_gilt_nur_die_zuletzt_freigegebene` hält es
  fest.
- `liste_koepfe` liest den Verteiler über dieselbe `json_column`. `DokumentKopf` bekommt
  `verteiler`, `BefehlKopf` trägt `verteiler` und `is_quittierbar`. `BefehlAnzeige` trägt
  `is_quittierbar`. `LageberichtKopf` und `LageberichtAnzeige` übernehmen keines der neuen
  Felder (Spec `dokument-verteiler`, „Die Liste der Lageberichte MUST unverändert bleiben“).
- Den Zählerstand „q/n“ rechnet der Client aus `verteiler`. Eigene Zählfelder wie beim Auftrag
  (`empfaenger_anzahl`, `quittiert_anzahl`) brauchte es nur, wenn die Liste den Verteiler nicht
  trüge. Sie trägt ihn aber für Namen und Filter ohnehin.

**Verworfen:** *Zählfelder statt Verteiler im Kopf.* Dann bräuchte die Karte für die Namen und
der Filter für die Ziele einen zweiten Abruf je Befehl.

### D3 Schreiben: ein Kernweg je Richtung, atomar mit dem ETB

`src/vorlagendokument/verteiler.rs` bekommt `quittieren_tx::<T>` und `zuruecknehmen_tx::<T>`
(`conn, einsatz_id, dokument_id, eintrag_id, benutzer_id`). Beide laufen im Handler in
`write_retry!` und machen nacheinander:

1. Das Dokument mit `laden::<T>` auf der Verbindung laden (404, wenn es fremd ist).
2. Ein Entwurf ergibt 422 „Ein Befehlsentwurf wird nicht quittiert“. Ist `is_quittierbar`
   falsch, folgt 422 „Eine neuere Fassung ist freigegeben“.
3. Die Zeile im geladenen `verteiler` suchen. Fehlt sie, folgt 404.
4. Bedingtes UPDATE:
   - Quittieren: `SET quittiert_at = ?, quittiert_von_id = ? WHERE id = ? AND quittiert_at IS NULL`.
   - Zurücknehmen: `SET quittiert_at = NULL, quittiert_von_id = NULL WHERE id = ? AND quittiert_at IS NOT NULL`.
5. Nur bei `rows_affected = 1` den ETB-Eintrag schreiben (D4).
6. Das Dokument neu laden. Zurück kommen die Anzeige und die id des ETB-Eintrags, falls einer
   entstanden ist.

Die Prüfung in Schritt 2 und das UPDATE laufen in derselben Transaktion. Eine Freigabe von v2
mitten im Quittieren von v1 wird dadurch serialisiert (SQLite, ein Schreiber).

`routes::vorlagendokument` bekommt die Kernhandler `quittieren::<T>` und `zuruecknehmen::<T>`.
Sie prüfen mit `fordere_schreiben::<T>`: Schreibrecht, Modul „auftraege“, Einsatz aktiv. Das
sind dieselben Prüfungen, die `EinsatzSchreibzugriff<Auftraege>` beim Auftrag macht.
`fordere_im_bereich` entfällt, weil kein Gerät eine Befehlsroute erreicht (Allowlist in
`src/geraet/mod.rs`). Gemountet werden die Handler nur in `routes::befehl`:

- `POST /api/einsaetze/{id}/befehle/{bid}/verteiler/{vid}/quittieren`
- `POST /api/einsaetze/{id}/befehle/{bid}/verteiler/{vid}/zuruecknehmen`

Beide nehmen keinen Body und antworten mit 200 und `BefehlAnzeige`. Das Wort
„zuruecknehmen“ folgt den bestehenden Routen (`abloesungen/…/vollzug/zuruecknehmen`,
`betreuung/…/zuruecknehmen`).

Idempotenz wie beim Auftrag: Doppeltes Quittieren und die Rücknahme an einer offenen Zeile sind
200 ohne Wirkung. Damit bekommt der zweite von zwei gleichzeitigen Klicks keinen Fehler.

**Verworfen:**

- *409 oder 422 bei doppelter Quittung.* Die Person, die als zweite klickt, sähe einen Fehler
  zu einem Zustand, den sie ohnehin wollte.
- *`DELETE …/quittung` für die Rücknahme.* Das passt nicht zu den bestehenden Rückwegen, die
  alle `POST …/zuruecknehmen` heißen.

### D4 ETB: Systemeintrag mit dem Empfänger als `von`, ohne Titel

Der Eintrag entsteht über `etb::repo::anlegen_tx` mit dem Startwert aus den Einstellungen auf
derselben Verbindung. Er hat diese Felder:

- `typ: system`
- `von: snap_anzeige` der Zeile
- `an: None`, das ETB setzt dafür „System“
- `inhalt`:
  - Quittung: `Empfang quittiert: Einsatzbefehl v{version} (ETB {lfd_nr})`
  - Rücknahme: `Quittung zurückgenommen: Einsatzbefehl v{version} (ETB {lfd_nr})`

`lfd_nr` ist die laufende Nummer des Freigabe-Eintrags (`etb_eintrag_id` des Dokuments), gelesen
in derselben Transaktion. Den Satz baut eine Funktion in `befehl`, die `DokumentRoute` als
`const` oder Funktionszeiger reicht, damit der Kern keinen Befehlstext kennt.

**Warum ohne Titel:** Die Spec `aufbewahrung` verbietet neue Einträge in der Ausnahmeliste für
Dokumenttitel. Die Nummer des Freigabe-Eintrags verweist eindeutig auf die Fassung und überlebt die
Schwärzung. Der Anzeigename des Empfängers ist Wortlaut des Führungsmoduls (Gruppe
`Fuehrungsmodul`, wie bei der Freigabe). `tests/aufbewahrung_e2e.rs`, `AUSNAHMEN_SYSTEM_ETB`,
bekommt je Schreibweg (`update_quittung_tx`, der gemeinsame Weg beider Richtungen) Einträge für
`befehl_verteiler.snap_anzeige`, `.funktion_text` und `.extern_bezeichnung`. Kein Test bemerkt
einen fehlenden Eintrag (`src/AGENTS.md`), deshalb ist das eine eigene Aufgabe.

**Verworfen:**

- *Rücknahme als ETB-Berichtigung der Quittung.* Eine Berichtigung sagt, dass der Eintrag falsch
  war. Eine zurückgenommene Quittung war zum Zeitpunkt richtig, sie wird nur aufgehoben.
  Außerdem ist `berichtigung` ein Typ, den Personen erfassen.
- *`befehl_id` am Quittungseintrag setzen.* Die Spalte steht heute für „Snapshot dieses Befehls“
  (Rücksprung, Lagevortrag-Übernahme). Ein zweiter Eintrag mit demselben Verweis würde diese
  Leser verwirren.

### D5 Live

Der Kopf trägt jetzt den Verteiler. Ein Entwurfs-PATCH mit Verteiler meldet deshalb den Befehl
ohne `nur_inhalt`, sonst behielte die Liste anderer Tabs alte Namen und der Empfängerfilter
träfe falsch.

Nach dem Commit einer Quittung gehen zwei Ereignisse:

- `sse::<T>` (Objekt `befehl_id`, **ohne** `nur_inhalt`), weil sich der Kopf in der Liste ändert;
- bei geschriebenem ETB-Eintrag zusätzlich `state.live.publiziere(einsatz_id, etb_id)`, wie bei
  der Freigabe.

Im Frontend reicht der vorhandene Sammler: `befehl` mit id invalidiert Liste und Detail.

### D6 Fortschreiben, Schwärzung

- `copy_tx` bleibt bei seiner expliziten Spaltenliste. Die Quittung wird dadurch nicht kopiert.
  Ein Test hält das fest (Spec `dokument-verteiler`, „Quittung bleibt an der alten Fassung“).
- Schwärzung: Beide Tabellen behalten `quittiert_at` (`G_ZEIT`) und `quittiert_von_id`
  (`G_FK`) wie `auftrag_empfaenger`. Wächter: `jede_einsatz_scoped_spalte_ist_klassifiziert`.

### D7 Frontend: gemeinsame Bausteine statt Kopien

- **`Quittungsstand`**: Aus `AuftragQuittungsstand` wird `Quittungsstand({ anzahl, quittiert })`.
  Auftragskarte, Auftragsdetail, Befehlskarte und Befehlsdetail nutzen ihn.
- **`EmpfaengerQuittung`** (`auftraege/EmpfaengerQuittung.tsx`): der Körper von
  `AuftragEmpfaenger` mit Chips, Grenze, Zeile „Quittung offen:“, Knöpfen und `ZeilenFehler`,
  aber über neutrale Zeilen `{ id, name, quittiertAt }`. Der Unterschied liegt in einer Prop
  `rueckfrage?: { title; okText }`:
  - Der Auftrag reicht seine heutige Rückfrage („Empfang/Kenntnis quittieren?“), weil er keinen
    Rückweg hat.
  - Der Befehl reicht keine und quittiert mit einem Klick (LFH-343).

  `AuftragEmpfaenger` bleibt als dünne Hülle und behält seine Props (`darfQuittierenFuer`,
  aufgehoben). Seine Tests laufen unverändert.
- **`EmpfaengerFilter`** (`auftraege/EmpfaengerFilter.tsx`): Er bekommt Abschnitte und Einheiten
  als Props und liefert `abschnitt:<id>` bzw. `einheit:<id>`. Die Optionsgruppen ziehen aus
  `AuftraegeListe.tsx` hierher. Dazu kommt `trifftEmpfaenger(eintraege, filter)` für die
  Prüfung im Client.
- **`BefehlListe`**: hält den Filter, lädt Abschnitte und Einheiten über die vorhandenen Keys
  und filtert nach der Suche im Client. Die Liste ist ungeblättert und wird schon heute im
  Client durchsucht. Die Zahlen der Segmente zählen das Gefundene, der Bereichskopf den Bestand,
  wie bei der Suche.
- **`BefehlListenKarte`**: Unter dem Titel stehen die Namen des Verteilers, bei freigegebenen
  Befehlen davor der `Quittungsstand`. Ohne Verteiler gibt es keine Zeile.
- **`BefehlDetail`**: Die Zeile `Descriptions` „Verteiler“ weicht einem Block mit `Augenbraue`
  „Verteiler“ und `EmpfaengerQuittung`.
  - Bei einem Entwurf erscheinen nur die Namen, ohne Quittungsstand.
  - Quittieren läuft über eine Mutation (`api/befehle.ts`: `quittiereBefehlEmpfang`,
    `nimmBefehlQuittungZurueck`). Erfolg zeigt `zeigeRueckgaengig(message, 'Empfang quittiert', …)`,
    und dessen Rückweg ruft die Rücknahme. Die Antwort setzt das Detail per `setQueryData`, die
    Liste wird invalidiert.
  - Fehler werden je Zeile über `useZeilenFehler` am Block angezeigt (LFH-1077).
  - Knopf nur bei `darfSchreiben && is_quittierbar`.
- Die Vollseite (`BefehlDetailPage`) bleibt unverändert.

### D8 Doku

`docs/anwender/kapitel/auftraege-befehle.md`:

- Überblick: Der Befehl kennt jetzt eine Quittung.
- Abschnitt „Einen Einsatzbefehl lesen“: Verteiler und Quittung im Detail.
- Neuer Abschnitt „Den Empfang eines Befehls quittieren“ mit Rückgängig und der Regel zur
  Fassung.
- Hintergrund: Der Satz „nur der Auftrag kennt Empfänger, Quittung und Vollzug“ wird
  korrigiert, dazu kommt der ETB-Wortlaut.
- Filter: Der Empfängerfilter steht in beiden Reitern.

Das Bild `befehl-detail.png` (hell und dunkel) wird per `pnpm doku:bilder --grep
auftraege-befehle` neu erzeugt, mit einem Befehl mit Verteiler und einer Quittung im Bildlauf.

## Risks / Trade-offs

- **Liste trägt mehr Daten:** Jeder Befehlskopf trägt seinen Verteiler (höchstens 50 Zeilen).
  Ein Einsatz hat wenige Dutzend Befehle, das bleibt klein. → Hingenommen. Lageberichte lesen den
  Verteiler im Kopf zwar mit, geben ihn aber nicht aus. Wird das messbar, kommt ein Haken.
- **Rückgängig nach Ablauf des Fensters:** Nach 6 s gibt es keinen Weg zurück in der Oberfläche,
  obwohl der Server ihn hätte. → Bewusst, wie bei „Bearbeitung beginnen“. Ein dauerhafter
  Rückweg ist ein Non-Goal und bei Bedarf eine eigene Aufgabe.
- **Zwei ETB-Einträge für eine Fehlbedienung:** Quittung plus Rücknahme stehen beide im ETB. →
  Gewollt (Entscheidung 1): Das ETB ist fortlaufend, jede Bewegung ist belegt.
- **Umbau von `AuftragEmpfaenger`:** Das Herauslösen kann das Verhalten des Auftrags verschieben.
  → Die Auftragstests (`AuftragTeile`, `AuftraegeListe`, `GeraetAbschnitt`) und die e2e-Specs
  zum Quittieren bleiben unverändert grün. Ein Wächter auf den Wortlaut der Rückfrage bleibt.
- **Wire-Änderung `BefehlKopf`:** Zwei neue Pflichtfelder für alte Clients. Das Frontend ist
  eingebettet und wird mit dem Server ausgeliefert. → Kein Übergangsweg nötig.

## Migration Plan

`0187` (nach dem Merge mit alpha umgelegt von 0186) ist rein additiv (zwei nullable Spalten je Tabelle). Bestand und Demo-Daten sind danach
unquittiert. Ein Rollback des Codes lässt die Spalten unbenutzt. Vor dem Push wird mit
`scripts/check-migrationen.sh` gegen `origin/alpha` geprüft, ob `0187` noch frei ist.
