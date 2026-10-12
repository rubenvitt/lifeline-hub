# Design

## Context

Befehl, Lagebericht und Pressemitteilung teilen einen Kern (`src/vorlagendokument/`). Der Trait
`Dokumentart` besteht nur aus Konstanten. Den einzigen art-spezifischen Zusatz trägt heute
`ANLAGEN: Option<&AnlagenTabelle>`, den Befehl und Lagebericht belegen
(`src/vorlagendokument/anlage.rs`). Die drei Kernwege sehen so aus:

- **Laden** liefert `Dokument<A>`. Daraus entsteht die Wire-Anzeige synchron per `From`.
- **PATCH** (`routes/vorlagendokument.rs::aktualisieren`) prüft den Status, dann läuft ein
  UPDATE mit Status-Guard im Autocommit. Es gibt keine Transaktion.
- **Freigabe** und **Fortschreiben** laufen je in einer Transaktion (`write_retry!`). Die
  Freigabe hängt die Anlagen an den Wortlaut (`anlage::snapshot_abschnitt`) und schreibt das ETB
  mit `von: None, an: None`, was `etb::repo` zu „System“ macht. Das Fortschreiben kopiert
  Abschnitte und Anlagen (`anlage::kopieren_tx`).

Das Vorbild für Empfänger ist `auftrag_empfaenger` (Migration `0089`, Prüfung
`src/auftrag/eingabe.rs`, Snapshot `src/auftrag/repo.rs::snap_anzeige_fuer`, ETB-Kappung
`auftrag::kappe_an`). Im Frontend liegt die Empfängerwahl inline in `AuftragFormular.tsx`, die
Kodierung in `auftraege/auftragFormularKern.ts` (`baueEmpfaenger`, `alleEmpfaenger`). Beide
Entwurfsseiten binden ihr Formular als `Record<string, string>` an `useEntwurfVerlustschutz`.

## Goals / Non-Goals

**Goals:**

- Ein Haken im Kern, damit Befehl und Lagebericht den Verteiler über denselben Code tragen. Eine
  spätere Art braucht dann nur eine Tabelle und eine Konstante.
- Dieselben Prüfungen und Snapshot-Regeln wie beim Auftragsempfänger, ohne eine zweite Kopie
  davon.
- Byte-gleicher Wortlaut und `an` = „System“ für jedes Dokument ohne Verteiler, also für den
  ganzen Bestand und den Demo-Import.

**Non-Goals:**

- Ein eigener Endpunkt für den Verteiler und ein eigenes Live-Flag.
- Besetzungsauflösung zur Lesezeit (`aktuelle_besetzung`) am Verteiler.
- Ein Verweis auf den Katalog „Externe Stellen“: Gespeichert wird nur Text (Speicherform A aus
  LFH-1194).
- Umbau des Auftragsformulars über das Herauslösen der Empfängerwahl hinaus.

## Decisions

### D1 Eine Kindtabelle je Art, angesteuert über einen Haken `VERTEILER`

Migration `0182_dokument_verteiler.sql` legt `befehl_verteiler` und `lagebericht_verteiler` an.
Die Spalten sind dieselben:

- `id`, `einsatz_id` (FK, CASCADE), `<art>_id` (FK, CASCADE), `reihenfolge`
  (`UNIQUE(<art>_id, reihenfolge)`)
- `empfaenger_typ` CHECK `abschnitt|einheit|funktion|extern`
- `abschnitt_id` → `einsatzabschnitt` und `einheit_id` → `einsatz_einheit`, beide ON DELETE SET NULL
- `funktion` (CHECK wie `auftrag_empfaenger.funktion`), `funktion_text`, `extern_kategorie`
  (CHECK auf die vier Adressat-Kategorien), `extern_bezeichnung`
- `snap_anzeige TEXT NOT NULL`

`Dokumentart` bekommt `const VERTEILER: Option<&'static VerteilerTabelle> = None`
(`tabelle`, `dokument_spalte`). Befehl und Lagebericht belegen ihn, die Pressemitteilung nicht.
Das neue Modul `src/vorlagendokument/verteiler.rs` baut sein SQL wie `anlage.rs` aus der
Tabellenkonstante.

`einsatz_id` steht direkt an der Zeile wie bei den Anlagen-Linkern: Abfragen und Schwärzung
scopen dann ohne Join.

**Verworfen:**

- *JSON-Spalte am Dokument.* Sie bräuchte denselben Spaltensatz in allen drei Tabellen,
  weil `select<T>` generisch liest, also auch in der Pressemitteilung. Abschnitt und Einheit
  hätten keinen FK. Der Schwärzungswächter sähe nur eine ganze Spalte, nicht die Freitexte
  darin.
- *Eine gemeinsame Tabelle mit Art-Spalte.* Sie hätte keinen echten FK auf das Dokument und
  damit kein CASCADE, und der Wächter für einsatz-gescopte Tabellen könnte sie nicht ableiten.

### D2 Der Verteiler kommt mit dem Dokument, geschrieben wird er im PATCH

`Dokument<A>` bekommt `verteiler: Vec<VerteilerEintrag>`. `laden` liest ihn mit, solange
`T::VERTEILER` gesetzt ist, sonst bleibt die Liste leer. `From` bleibt dadurch synchron.
`BefehlAnzeige` und `LageberichtAnzeige` tragen `verteiler: Vec<VerteilerEintragAnzeige>`. Die
Pressemitteilung übernimmt das Feld nicht. `PatchBody` bekommt
`verteiler: Option<Vec<EmpfaengerEingabeReq>>`. Hat die Art keinen Haken und kommt das Feld
trotzdem, antwortet der Server mit 400.

Der PATCH läuft künftig ganz in `write_retry!`: UPDATE mit Status-Guard, Verteiler löschen und
neu einfügen, dann Rücklesen. Damit ist er atomar (Spec „ganz oder gar nicht“), und eine
Freigabe dazwischen kann den Verteiler nicht mehr verändern. Der Demo-Import nutzt
`aktualisiere_tx` weiter auf seiner eigenen Transaktion.

**Verworfen:** *Eigene Route `PUT …/verteiler` wie bei den Anlagen.* Der Entwurf speichert mit
einem Klick genau einen PATCH (`entwurf/AGENTS.md`), und der Autosave kennt nur einen
Speicherweg. Zwei Aufrufe hätten zwei Fehlerzustände und ein Rennen zwischen ihnen. Anlagen
brauchen ihren Weg nur wegen des Multipart-Uploads.

### D3 Prüfung und Snapshot aus dem Auftrag wiederverwenden, mit eingeschränkter Typmenge

`auftrag::eingabe::validiere_empfaenger_liste` und `pruefe_empfaenger_zahl` werden
`pub(crate)`. Sie nehmen die erlaubten Typen als Parameter, beim Auftrag alle sechs, beim
Verteiler vier, und eine Pflicht-Angabe (beim Auftrag ja, beim Verteiler nein). Aus
`auftrag::repo` wird `snap_anzeige_fuer` `pub(crate)`. Die Grenzen bleiben dieselben Konstanten
(`EMPFAENGER_MAX`, `EXTERN_BEZEICHNUNG_MAX`, `fuehrung::TEXT_MAX`). Sie bekommen im Spiegel
eigene Namen für den Verteiler (`VERTEILER_MAX`, `VERTEILER_BEZEICHNUNG_MAX`) als Alias, damit
das Frontend nicht `AUFTRAG_*` für Befehle benutzt.

Der Snapshot entsteht bei jedem Speichern des Verteilers. Freigabe und Fortschreiben nehmen den
gespeicherten Namen. So steht im ETB genau das, was der Entwurf zuletzt angezeigt hat.

**Verworfen:**

- *Ein neues Modul `empfaenger/`, in das der Auftrag umzieht.* Das ist sauberer, verschiebt
  aber viel Auftragscode ohne Not. Wenn es eine dritte Verwendung gibt, kann der Umzug folgen.
- *Snapshot bei der Freigabe neu bilden.* Dann stünde im ETB etwas anderes als im
  freigegebenen Entwurf.

### D4 Freigabe: `an` und Abschnitt „Verteiler“, leer ändert nichts

In `freigeben_tx` werden in derselben Transaktion die Einträge gelesen. `render` bekommt nach
dem Anlagen-Abschnitt `\n## Verteiler\n- <snap>\n…`, nur wenn es Einträge gibt.
`snapshot_freigeben_tx` nimmt `an: Option<&str>` = `auftrag::kappe_an(&namen)`, bei leerer
Liste `None`. Die Reihenfolge Abschnitte, Anlagen, Verteiler folgt dem Aufbau eines
schriftlichen Befehls, bei dem Anlagen und Verteiler am Ende stehen.

### D5 Fortschreiben kopiert in derselben Transaktion

`verteiler::kopieren_tx::<T>(conn, einsatz_id, von, nach)` läuft als
`INSERT … SELECT` mit allen Spalten außer `id` und dem neuen `<art>_id`. Es wird neben
`anlage::kopieren_tx` aufgerufen.

### D6 Schwärzung und ETB-Ausnahmen

`TABELLEN` in `schwaerzung_registry.rs` bekommt beide Tabellen mit direktem Scoping über
`einsatz_id`. Behalten werden `id`, `einsatz_id`, `<art>_id`, `reihenfolge`, `empfaenger_typ`,
`abschnitt_id`, `einheit_id`, `funktion` und `extern_kategorie`. Bei `funktion_text` und
`extern_bezeichnung` wird NULL gesetzt, `snap_anzeige` bekommt den Platzhalter, alles in
`Z_EINSATZ`, wie bei `auftrag_empfaenger`. Es gibt keine `person_id`, also keinen Eintrag in
`PERSONENBEZUEGE`.

`AUSNAHMEN_SYSTEM_ETB` in `tests/aufbewahrung_e2e.rs` bekommt für `freigeben_tx` je Art
`<art>_verteiler.snap_anzeige`, `.funktion_text` und `.extern_bezeichnung`. Kein Test bemerkt
einen fehlenden Eintrag (`src/AGENTS.md`), deshalb steht diese Arbeit ausdrücklich in den
Aufgaben.

### D7 Frontend: `EmpfaengerWahl` plus `ExterneEmpfaenger`

**`fuehrung/EmpfaengerWahl.tsx`** ist ein kontrollierter Tags-Select für `Form.Item`
(`value`/`onChange: string[]`). Er bekommt Abschnitte, Einheiten und die Funktionsvorschläge als
Props, hält seinen Such-State selbst und baut die drei Optionsgruppen.

- Die Kodierung (`abschnitt:<id>`, `einheit:<id>`, `funktion:…`, Freitext) und `baueEmpfaenger`
  ziehen aus `auftragFormularKern.ts` in `fuehrung/empfaengerKern.ts` um.
- `AuftragFormular` nutzt die Komponente und bleibt aus Bediensicht gleich. Seine Tests laufen
  unverändert.
- Für den umgekehrten Weg von gespeicherten Einträgen zu Tags gibt es `empfaengerTagsAus(...)`
  (Muster `auftragBerichtigungKern.vorbelegungAus`).

**`fuehrung/ExterneEmpfaenger.tsx`** ist eine Zeilenliste aus Kategorie-Select und
Bezeichnungsfeld mit Vorschlägen aus `externeStellenVorschlaege`, dazu „Externe Stelle
hinzufügen“ und Entfernen je Zeile. Der Auftrag behält sein Paar aus Richtung und einer
externen Stelle. Ein Verteiler braucht mehrere externe Stellen, deshalb eine eigene Liste
statt Tags. Die Zeile, die zur Laufzeit an der Kategorie hängt, ist mit Tags nicht sauber
darzustellen.

**Entwurfsseiten:** Das Formular bekommt das Feld `verteiler` mit dem Wert
`{ intern: string[]; extern: { kategorie; bezeichnung }[] }` (`befehl-no-print`). Der
Formulartyp wird von `Record<string, string>` auf einen benannten Typ erweitert. Ein
Wächtertest stellt sicher, dass keine Vorlage einen Abschnittsschlüssel `verteiler` trägt.

- `werteAus` und `speichern` bilden den Verteiler hin und zurück ab.
- Der Druckkopf liest `Form.useWatch('verteiler')` wie den Titel (LFH-731). Die Anzeigenamen der
  ungespeicherten Tags kommen aus den geladenen Optionen.
- Abschnitte und Einheiten lädt die Seite über `einsatzKeys.abschnitte`/`einheiten`.
- Im freigegebenen Zweig und in `BefehlLesefassung`/`BefehlDetail` steht ein `Datenfeld`
  „Verteiler“ mit den `snap_anzeige`.

**Verworfen:** *Externe Stellen als Freitext-Tags.* Dabei ginge die Kategorie verloren, die
Server und Schwärzung brauchen.

## Risks / Trade-offs

- **Blur-Autosave im Tags-Select:** Getippter Text würde beim Blur zum Freitext-Tag und sofort
  gespeichert. → Die Komponente leert die Suche beim Blur, ohne einen Tag zu übernehmen (Muster
  `EinWertAuswahl`, `requestAnimationFrame`). Ein Test deckt das ab.
- **Der PATCH wechselt von Autocommit auf `write_retry!`:** Unter Last kann das Speichern bei
  belegter Sperre wiederholt werden. → Das ist gewollt, die Schreibwege des Kerns
  (Freigabe, Fortschreiben) laufen schon so. Der Repo-Test für das Rennen „PATCH nach Freigabe →
  404“ bleibt.
- **Wortlaut-Tests:** Der byte-genaue Snapshot-Test (`tests/befehl.rs`) muss ohne Verteiler grün
  bleiben. → Ein eigener Test belegt den Wortlaut mit Verteiler, der alte bleibt unverändert.
- **Formtyp-Umbau auf zwei Seiten:** `Einstiegsfokus` und die Abschnittsschleifen lesen nur
  Abschnittsschlüssel. → Die Abschnitte bleiben Feldnamen der obersten Ebene, `verteiler` kommt
  daneben, abgesichert durch den Wächtertest gegen eine Namenskollision.
- **Labels ungespeicherter Tags im Druckkopf:** Sind Optionen noch nicht geladen, fehlte das
  Label. → Fallback ist der gespeicherte `snap_anzeige` desselben Werts, dann der Tag-Text.

## Migration Plan

Die Migration `0182` ist rein additiv: zwei neue Tabellen, keine Datenübernahme. Bestand und
Demo-Daten haben einen leeren Verteiler. Ein Rollback des Codes lässt die Tabellen unbenutzt
stehen. Vor dem Push zeigt `scripts/check-migrationen.sh` gegen `origin/alpha`, ob `0182` noch
frei ist.
