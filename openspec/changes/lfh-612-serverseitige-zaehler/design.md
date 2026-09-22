# Design

## Context

Der Neuentwurf LFH-605 zeigt drei Arten von Zahlen: die Summe im ETB-Kopf, die Bilanz je Typ und Zähler an den Modulen. Für keine davon gibt es heute eine Quelle auf dem Server.

**ETB heute.**
- Die ETB-Liste (`GET …/etb`, `src/routes/etb.rs:liste`, Abfrage in `src/etb/repo.rs:abfrage`) liefert ein bloßes Array. Standard sind 100 Einträge, höchstens 500. Die Einträge kommen über einen Cursor `before_lfd_nr`, und eine Gesamtzahl fehlt.
- Die Seite zählt deshalb über das geladene Fenster (`typBilanz`, `bilanzUmfang`, `kopfMeta` in `etb/zeitachseModell.ts`). Sie beschriftet das auch ehrlich, etwa als „100 Einträge geladen · ältere vorhanden“.

**Modulzähler heute.**
- `einsatz/useModulZaehler.ts` lädt für vier Module die volle Liste und rechnet im Browser: Meldungen `ist_offen`/`neu`, Aufträge Phase ≠ abgeschlossen und `ist_ueberfaellig`, Erinnerungen `ist_faellig && offen`, Chat `Σ ungelesen_anzahl`.
- Ob ein Zähler geladen wird, filtert `darfZaehlerLaden` im Client.
- Das Modulpanel rendert eine neutrale Mono-Zahl. Die Beschreibung trägt es als `title` und als `aria-label` des Knopfes (`ModulPanel.tsx`).

**Gegebenheiten des Backends.**
- Die Modulrechte setzt `fordere_modul_zugriff` durch. Es prüft in dieser Reihenfolge: System-Admin, nicht ausblendbar, Sichtbarkeit, dann die Rolle aus Einsatz-Override, sonst Org-Vorgabe (`src/einsatz/berechtigung.rs`).
- `src/routes/live.rs:erlaubte_module` wertet diese Regeln für alle Modul-Keys auf einmal aus. Es braucht dafür zwei Lesezugriffe.
- Im Backend gibt es keine Zonenbibliothek, und `zeitzone` ist ungeprüfter Freitext.

**Entscheidungen des Nutzers (22.09.2026).**
1. Modulzähler nur für Module mit belegter Bedeutung. Die Kommunikationsmodule behalten „offen/fällig/ungelesen“, neu kommen die Gesamtmengen von ETB, Betroffenen, Einheiten und Einsatzabschnitten dazu.
2. Die ETB-Bilanz folgt dem Filter.
3. Die vier bestehenden Zähler ziehen auf den Server um.

## Goals / Non-Goals

**Goals:**
- Exakte, filtertreue ETB-Zählung auf dem Server. Kopf, Bilanz und Liste können nicht auseinanderlaufen.
- Genau eine Abfrage für alle Modulzähler, gefiltert nach den Modulrechten des Servers.
- Die bestehenden Bedeutungen und Wortlaute der vier Kommunikationszähler bleiben unverändert.
- Live-Aktualisierung ohne neue Live-Ereignisse.

**Non-Goals:**
- Kein Zähler für Stab, Gefahrenmatrix, Lageberichte, Tiere, Schäden, Fahrzeuge, Personal, Material, BR, UHS, Lagemeldungen, Nachforderungen oder Überblick/Meldebild. Für sie gibt es keine belegte Bedeutung. Ein späteres Ticket kann sie mit einer eigenen Entscheidung ergänzen.
- Keine Tagesbilanz mit einer Tagesgrenze auf dem Server. Wer einen Tag sehen will, setzt den Zeitraumfilter.
- Keine Zähler an Sprungmarken (Entscheidungen, Patienten, Vermisste). Deren Bedeutung ist ein eigenes Thema.
- Kein Umbau der Überblicks- und Lage-Dashboard-Kennzahlen, die weiterhin aus Listen rechnen.

## Decisions

### D1 · Zwei Endpunkte statt einem

`GET /api/einsaetze/{id}/etb/zaehler` hängt am Filter des ETB. `GET /api/einsaetze/{id}/modul-zaehler` gehört keinem Modul. Ein gemeinsamer Endpunkt müsste den ETB-Filter mitschleppen, und der Navigationsrahmen würde dann bei jedem Suchwort neu zählen. Die Gates sind außerdem verschieden: Der ETB-Zähler ist ein Modul-Endpunkt mit 403 bei gesperrtem Modul. Der Modulzähler ist modul-los und lässt gesperrte Module weg.

- **ETB-Zähler.** Der neue Handler `zaehler` liegt in `src/routes/etb.rs`. Er zieht dieselben Gates wie die Liste (`fordere_lesezugriff` und `fordere_modul_zugriff_laden(…, "etb")`), in der Art der Lesemarke. `routes/etb.rs` steht in `DEFERRED_MODULE`, deshalb gibt es keine neue Guard-Pflicht.
- **Modulzähler.** Er kommt in eine neue Datei `src/routes/modul_zaehler.rs`, weil er keinem Modul gehört.
  - Gate: `EinsatzLesezugriff` mit dem Marker `OhneModul`. Das ist Org-Floor plus Lesezugriff.
  - `PFAD_KEY` bekommt den Eintrag `("/api/einsaetze/{id}/modul-zaehler", None)`, analog zu `/live`, mit Kommentar: Die Modulrechte wirken hier als Filter über die Felder, nicht als Türsteher.
  - Der Guard `tests/einsatz_kontext_guard.rs` prüft das.
  - *Verworfen:* den Handler in `routes/einsatz.rs` legen. Die Datei steht zwar in DEFERRED, aber ein modul-loser Aggregat-Endpunkt ist genau der Fall, den der typisierte Extractor absichern soll.

### D2 · Gemeinsame Filterbedingung für Liste und Zählung

`src/etb/repo.rs` bekommt eine Funktion `filter_bedingung(qb, einsatz_id, filter)`. Sie schreibt den FTS-Join, `WHERE e.einsatz_id = ?` und die Filter `typ`, `von`, `bis`, `erfasser_id` in einen `QueryBuilder`.

- `abfrage` nutzt sie und hängt Cursor, `ORDER BY` und `LIMIT` an.
- `zaehle(pool, einsatz_id, &EtbZaehlFilter)` nutzt sie mit `SELECT e.typ, COUNT(*) … GROUP BY e.typ`.
- Die Filterfelder ziehen in eine eigene Struktur `EtbZaehlFilter` (`q`, `typ`, `von_zeit`, `bis_zeit`, `erfasser_id`). `EtbFilter` enthält sie und dazu Cursor und Limit. Die Zählung kann damit gar keinen Cursor bekommen.
- Das Parsen der Parameter im Handler (Typ prüfen → 400, `normalisiere_zeit`, `q` trimmen) wandert in eine gemeinsame Funktion, die beide Handler rufen. Eine zweite Kopie wäre die Stelle, an der Liste und Zählung still auseinanderlaufen.
- *Verworfen:* ein `COUNT(*) OVER ()` in der Liste. Das kostet jede Seite, liefert keine Zahlen je Typ, und bei null Treffern fehlt die Zeile, die es tragen würde.

**Der Join auf `benutzer`** in `abfrage` (für `erfasser_name`) bleibt außerhalb der gemeinsamen Bedingung. Er filtert nichts, weil `erfasser_id` ein NOT-NULL-Fremdschlüssel ist. Die Zählung braucht ihn nicht.

### D3 · Zahl je Typ aus einem vollständigen `match`

Das DTO `EtbZaehlerAnzeige { gesamt: i64, je_typ: EtbTypZaehler }` hat in `EtbTypZaehler` ein Feld je `EtbTyp`, jeweils `i64`, ohne `Option`.

Befüllt wird es über `match EtbTyp::parse(typ)` mit einem Arm je Variante. Eine neue Variante bricht damit den Build, statt still zu fehlen.

Ein Typstring aus der Datenbank, den `parse` nicht kennt, ist durch den CHECK in `0004_etb.sql` ausgeschlossen. Trifft er trotzdem ein, führt er zu einem 500 (`AppError::Internal`) und wird nicht verschluckt: Eine Zahl, die still kleiner als die Summe ist, wäre der schlimmere Fehler.

`gesamt` ist die Summe der Zeilen, kein zweites `COUNT`. So gilt die Invariante „Σ je_typ = gesamt“ per Konstruktion.

### D4 · Modulzähler: Bestandsdefinitionen wiederverwenden

Der Handler berechnet mit `erlaubte_module(pool, einsatz_id, org_id, benutzer)` die erlaubten Keys. Die Funktion wandert aus `routes/live.rs` nach `src/einsatz/berechtigung.rs` und wird `pub`; `/live` ruft sie dort. Danach füllt der Handler nur die Felder erlaubter Module:

| Feld | Quelle |
|---|---|
| `etb` | `SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?` |
| `personen` | `SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ? AND storniert_at IS NULL`, dasselbe Prädikat wie `person::repo::liste` |
| `einheiten` | `SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ?` |
| `einsatzabschnitte` | `SELECT COUNT(*) FROM einsatzabschnitt WHERE einsatz_id = ?` |
| `meldungen` | `meldung::repo::liste(pool, id, None, None, jetzt)`, gezählt über `ist_offen` und `status == "neu"` |
| `auftraege` | `auftrag::repo::liste(pool, id, None, None, None, jetzt)`, gezählt über `bearbeitungsstatus ∈ {offen, in_arbeit}` und `ist_ueberfaellig` |
| `erinnerungen` | `erinnerung::repo::liste(pool, id, false, jetzt)`, gezählt über `ist_faellig && status == "offen"` |
| `chat` | `chat::repo::liste_kanaele(pool, id, benutzer.id)`, Summe von `ungelesen_anzahl` |

**Warum die Kommunikationszähler die Listen wiederverwenden.** `ist_offen`, `ist_ueberfaellig`, `ist_faellig` und `ungelesen_anzahl` rechnet der Server heute je Zeile in den Listenabfragen. Ein eigenes `COUNT` mit neu geschriebenem Prädikat wäre eine zweite Definition. Diese Listen sind je Einsatz klein (Dutzende bis wenige hundert Zeilen), und der Browser lädt sie heute ohnehin vollständig. Die Serverlast bleibt also gleich, der Netzverkehr sinkt.

**Die Aufträge bekommen eine eigene Zählfunktion.** „Offen“ ist im Frontend über `AUFTRAG_STATUS[…].phase` definiert: `offen` und `in_arbeit` sind nicht abgeschlossen, `vollzogen` und `abgenommen` schon. Auf dem Server wird das eine Funktion `fn ist_offen(AuftragBearbeitungsstatus) -> bool` mit vollständigem `match`. Ein Test hält sie gegen die Phasentabelle des Frontends fest, als Literal-Paar pro Status.

**Nebeneffekt von `liste_kanaele`.** Die Funktion legt beim ersten Aufruf den Standardkanal an (INSERT … WHERE NOT EXISTS). Diesen Nebeneffekt löst heute schon der Zähler-Aufruf des Frontends aus; er ist idempotent. Der Modulzähler übernimmt ihn unverändert. Einen Chat-Zählpfad ohne diese Anlage zu bauen hieße, das Ungelesen-Prädikat zu verdoppeln.

**DTO.**
```
ModulZaehlerAnzeige {
  etb?: MengenZaehler { gesamt },
  personen?: MengenZaehler, einheiten?: MengenZaehler, einsatzabschnitte?: MengenZaehler,
  meldungen?: MeldungsZaehler { offen, ungesehen },
  auftraege?: AuftragsZaehler { offen, ueberfaellig },
  erinnerungen?: ErinnerungsZaehler { faellig },
  chat?: ChatZaehler { ungelesen },
}
```
- Jedes Feld ist `Option<…>` mit `#[serde(skip_serializing_if = "Option::is_none")]` (LFH-265). Fehlt ein Feld, heißt das „nicht erlaubt“, und das ist auf der Leitung vom Wert 0 unterscheidbar.
- Die Feldnamen sind die Modul-Keys aus `MODUL_KEYS`. Ein Test prüft, dass jedes Feld einem gültigen Modul-Key entspricht.
- Die Zählungen laufen nacheinander. Sie sind unabhängig, aber SQLite serialisiert Lesezugriffe über einen Pool ohnehin kaum. Parallelisieren bleibt eine spätere Messfrage.

### D5 · Frontend: `useModulZaehler` liest eine Quelle

- `ModulZaehlerQuelle` bekommt die Werte `'etb' | 'personen' | 'einheiten' | 'einsatzabschnitte'` dazu. Die Registry setzt `zaehlerQuelle` an den vier Modulen.
- Der Hook ruft eine Query `einsatzKeys.modulZaehler(einsatzId)` = `['modul-zaehler', einsatzId]` und bildet die Antwort über reine Funktionen auf `ModulZaehlerMap` ab.
- Die Wortlaute der vier bestehenden Beschreibungen bleiben byte-gleich. Die bisherigen `berechne*Zaehler`-Funktionen werden zu Abbildungen von den Serverfeldern auf `{wert, beschreibung}`.
- **Die Tests werden bewusst ersetzt, nicht gelöscht.** Die Paare „Wortlaut bei 1“ und „Wortlaut bei n“ bleiben mit den neuen Eingaben erhalten.
- Neue Beschreibungen:
  - „412 Einträge im Einsatztagebuch“
  - „248 Betroffene“ (bei 1 „1 Betroffene Person“)
  - „31 Einheiten“
  - „4 Einsatzabschnitte“
- `darfZaehlerLaden` entfällt als Ladebedingung. Der Server filtert, und ein fehlendes Feld ergibt `undefined`.
  - Die Query läuft, sobald die Einsatz-ID gültig ist.
  - Die Anzeige bleibt trotzdem an `istModulSichtbar`/`istModulGesperrt` gebunden. Ein Modul, das der Rahmen nicht zeigt, zeigt auch keinen Zähler.
  - *Grund:* Die Rechte im Client kennen die Org-Vorgaben nicht (siehe Scope). Die Wahrheit des Servers ist strenger und richtiger.

### D6 · Frontend: ETB-Kopf und Bilanz

- `api/etb.ts` bekommt `ladeEtbZaehler(einsatzId, filter)`. Die Filterabbildung auf Query-Parameter teilt es mit `listeEtb`, wieder eine Quelle.
- Der Query-Key ist `einsatzKeys.etbZaehler(einsatzId, filter)` = `['etb', id, 'zaehler', filter]`. Er steht unter dem Präfix `etb` und wird deshalb durch das Ereignis `Etb` (das `etb` invalidiert) ohne eigenen Eintrag mit invalidiert, wie `etbLesemarke`.
- `kopfMeta` nimmt `gesamt: number | undefined` und `filterAktiv`. Das ergibt „n Einträge“ bzw. „n Treffer“; bei `undefined` wird kein Meta gesetzt.
- `typBilanz` nimmt das `je_typ`-Objekt statt der geladenen Einträge. Die Reihenfolge `BILANZ_TYPEN` bleibt, `system` erscheint nur bei einem Wert größer 0.
- `bilanzUmfang` entfällt, und `EtbBilanz` bekommt `zaehler` und `filterAktiv`.
  - Der Titel lautet „Bilanz“ bzw. „Bilanz im Filter“.
  - Die Balken nutzen `max = gesamt`, die Beschriftung „Meldungen: 218 von 412 Einträgen“ bzw. „… von 7 Treffern“.
  - Bei ladender oder fehlerhafter Zählung erscheint der bestehende Hinweis „Zählung folgt …“ (`unbestimmt`); im Fehlerfall: „Zählung nicht verfügbar.“
- Der Dateikommentar „WARUM ‚BILANZ‘ …“ wird umgeschrieben. Die Begründung gilt nicht mehr, die Entscheidung „kein ‚Tages-‘“ bleibt aber richtig.
- Berichtigungen und Puffer bleiben unverändert. Sie arbeiten weiter über die geladenen Einträge und sind entsprechend beschriftet.

### D7 · Live-Aktualisierung

- `einsatzKeys.modulZaehler` bekommt in `EINSATZ_STREAM_EVENTS` einen Eintrag bei jedem Ereignis, dessen Modul gezählt wird: nach heutigem Stand `etb`, `person`, `einheit`, `abschnitt`, `meldung`, `auftrag`, `befehl`, `erinnerung` und `chat`. Das Frontend kennt kein eigenes Ereignis `sofortmeldung`; die Meldungsliste hängt an `meldung`.
- **Vollständigkeit ist ein Test, keine Liste.** Für jedes Ereignis in `EINSATZ_STREAM_EVENTS`, das den Listen-Key eines gezählten Moduls invalidiert (`etb`, `personen`, `einheiten`, `einsatzabschnitte`, `meldungen`, `auftraege`, `erinnerungen`, `chatKanaele`), MUST es auch `modulZaehler` invalidieren.
  - Die Menge der gezählten Listen-Keys stammt aus derselben Tabelle wie die Abbildung im Hook.
  - Eine Mutationsprobe belegt den Test: Einen Eintrag entfernen muss ihn rot färben.
- Der Präfix `modul-zaehler` kommt in `EINSATZ_KEYS`. Der Guard `queryKeys.guard.test.ts` verlangt die Einordnung, und sie ist live.
- **Chat gelesen.** Die Stellen in `ChatPage.tsx`, die nach dem Markieren als gelesen `chatKanaele` invalidieren (Zeilen 188 und 293), invalidieren auch `modulZaehler`. Das Lesen erzeugt kein Live-Ereignis, weil es benutzereigen ist.
- **Befehl** zählt nicht: Der Zähler „Aufträge“ zählt Aufträge, und `befehl` invalidiert `auftraege`. Nach der Testregel oben bekommt `befehl` daher trotzdem `modulZaehler`. Das ist eine unnötige, aber harmlose Neuberechnung, und die Regel bleibt ohne Ausnahme.

## Risks / Trade-offs

- **[Rechte-Snapshot.]** Der Modulzähler wertet die Rechte bei jedem Aufruf neu aus. Für Overrides gibt es kein Live-Ereignis. Wird ein Modul ausgeblendet, verschwindet sein Zähler deshalb erst beim nächsten Neuladen der Query. → Das Verhalten entspricht dem der Navigation selbst. Die Überrechnung für ein neu erlaubtes Modul kommt spätestens mit dem nächsten gezählten Ereignis.
- **[Last bei Erfassungsspitzen.]** Jedes gezählte Ereignis löst die Neuberechnung aller acht Zähler aus, darunter vier Listenabfragen. → TanStack fasst Invalidierungen zusammen; die Query ist nur im Rahmen aktiv, einmal je Tab. Wird es messbar teuer, lässt sich eine eigene COUNT-Abfrage je Kommunikationsmodul nachziehen, gegen denselben Paritätstest.
- **[Der GET des Chat-Zählers schreibt.]** Das INSERT des Standardkanals ist ein vorhandener Nebeneffekt, idempotent und bereits heute vom Zähler ausgelöst. → Er wird dokumentiert und nicht verändert.
- **[Filter mit `q` ohne verwertbare Zeichen.]** `fts_query` liefert bei einer Eingabe nur aus Sonderzeichen einen leeren String, und dann entfällt der Filter. Die Zählung verhält sich über die gemeinsame Bedingung identisch. → Ein Test mit `q=*` hält fest, dass Liste und Zählung gleich bleiben.
- **[Anzeige während des Ladens.]** Kopf und Bilanz sind kurz leer, bis die Zählung eintrifft. → Das ist gewollt: keine Scheinzahl aus dem geladenen Fenster.

## Migration Plan

Keine Datenmigration. Die Endpunkte sind additiv. Das Frontend stellt in einem Commit um, ein Rückbau ist per Revert möglich. Nach der Backend-Änderung laufen `scripts/check-typ-codegen.sh` und das Gate `./scripts/check-all.sh`.

## Open Questions

Keine offene Frage blockiert. Nachzüge für eine spätere Entscheidung, außerhalb dieses Changes:
- Zähler für die übrigen Module (siehe Non-Goals).
- Zähler an den Sprungmarken.
