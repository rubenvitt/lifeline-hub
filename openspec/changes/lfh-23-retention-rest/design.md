# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/aufbewahrung/spec.md` und `specs/aufbewahrung-archiv/spec.md`. Hier steht nur der
Stand, der den Weg vorgibt (Stand `origin/alpha` `b8088ba3`, 24.09.2026).

- **Politik und Purge** liegen in `src/einsatz/retention.rs` (`KARENZ_TAGE = 30`,
  `berechne_retention_bis`, `karenz_abgelaufen`, alles mit injiziertem `jetzt`) und
  `src/einsatz/purge_scheduler.rs` (`tick_einmal`: Phase A Vormerkung, Phase B Schwärzung,
  Phase C Auth-Audit; Takt 600 s, gestartet in `src/main.rs`).
- **Mutationen** in `src/einsatz/repo.rs`: `abschliessen` (Frist aus Dauer, nur bei
  `retention_bis IS NULL`, mit ETB), `frist_setzen`, `faellige_soft_delete`,
  `soft_delete_einsatz`, `faellige_purge`, `schwaerze_einsatz` (Tombstone, Registry-Scrub und
  Audit in einer Transaktion). `system_audit_tx` sucht den Akteur über
  `ermittle_system_akteur` (erst `abgeschlossen_von`, dann Einsatzleitung). Findet es keinen,
  **warnt es nur und überspringt den Audit**, die Mutation läuft trotzdem.
- **Klassifikation** in `src/einsatz/schwaerzung_registry.rs` (`TABELLEN`,
  `klassifikation_von`, `scrubbe_aus_registry` mit `AssertSqlSafe` aus Registry-Konstanten),
  abgesichert durch fünf Guards.
- **Lesesperre** in `src/einsatz/berechtigung.rs::darf_lesen`: Ein Tombstone oder eine
  abgelaufene Frist an einem abgeschlossenen Einsatz sperrt **vor** jeder anderen Prüfung,
  also auch für den System-Admin. `fordere_lesezugriff` und `routes/etb.rs::fordere_lese_gates`
  bauen darauf auf. `liste_fuer` filtert mit `darf_lesen`.
- **Manuelle Frist** über `PUT /api/einsaetze/{id}/aufbewahrungsfrist`
  (`routes/einsatz.rs:157-209`): Einsatzleitung oder System-Admin, **ohne** Lesegate (damit
  eine abgelaufene Frist reaktiv verlängert werden kann), 409 bei unbestätigter Verkürzung.
  Einen Wächter gegen einen vorgemerkten oder geschwärzten Einsatz gibt es nicht. Der
  System-Admin handelt hier ohne Org-Prüfung.
- **Rollen**: `SystemRolle { Admin, Keiner }` und `OrgRolle { Fuehrungskraft, Keine }`
  (`src/auth/mod.rs`). Der Extractor `AdminUser` (`src/auth/session.rs`) lässt nur
  `system_rolle = admin` durch. Die Org-Einstellungen schreibt nur er, die Führungskraft
  liest den Admin-Bereich nur.
- **`einsatz_kontext_guard`** prüft ausschließlich Routen unter `/api/einsaetze/{id}/…`.
- **Frontend**: `EinsatzAufbewahrung.tsx` kennt nur `retention_dauer_tage` im
  Vollersatz-Formular. Nach dem Abschluss ist die Seite eingefroren
  (`EinsatzEinstellungenPage.tsx`, Hinweis „eingefroren“). `retention_bis` wird nirgends
  angezeigt, der Frist-Endpunkt nirgends gerufen. Die Verwaltung (`admin/adminNav.tsx`) hat
  mit `adminBenutzer` schon einen Sondereintrag hinter `system_rolle = admin`.
- **Scrub-Werte im Wortlaut von System-Einträgen** (Stichprobe beim Planen, nicht
  vollständig). In der Quellzeile sind diese Werte Scrub, im ETB aber Wortlaut (G_ETB):
  - `routes/einsatz_schaden.rs:249-255`: Kurzform des Schadensorts bei der Anlage
    (`einsatz_schaden.ort`).
  - `routes/einsatz_schaden.rs:563`: Übergabe-Adressat (`einsatz_schaden.uebergeben_an`).
  - `routes/einsatz_person.rs:1056` über `VerbleibArt::etb_sachverhalt`: Verbleib-Ziel
    („abtransportiert → <Klinik>“, „in Notunterkunft → …“, `person_verbleib.ziel`).
  - `routes/einsatz_uhs.rs:843-847`: Notiz beim UHS-Austritt
    (`person_uhs_belegung.notiz`).
  - `routes/einsatz_personal.rs:164/254/288`: Name ad-hoc externer Einsatzkräfte
    (`einsatz_personal.snap_name`).
  - `dokument/repo.rs:160/244`: Dokumenttitel (`einsatz_dokument.titel`, Zeile wird
    gelöscht).

  Die ETB-Schreibwege sind `crate::etb::system_audit_tx`, `etb::repo::anlegen_tx` und
  `routes::etb_system_degradiert` mit rund 70 Aufrufstellen in 24 Dateien. Durchgesehen
  wurden beim Planen nur die Routen für Personen, Tiere, Schäden, UHS, Personal,
  Bereitstellungsraum und Dokumente.

## Goals / Non-Goals

**Goals:**

- Die Lesesperre bleibt unverändert, der Archivpfad kommt **daneben** dazu. Ein Fehler im
  Archivpfad darf keine reguläre Route öffnen.
- Die Archivakte ist aus der Klassifikation **abgeleitet**, nicht handgepflegt. Deshalb
  liefert sie vor und nach der Schwärzung dasselbe.
- Jede Mutation der Aufbewahrung hat einen ETB-Eintrag. Wo keiner entstehen kann,
  unterbleibt die Mutation.
- AK 1 lässt sich ohne Codelesen prüfen: Jede Anforderung aus `aufbewahrung` ist einem Test
  zugeordnet (D10).

**Non-Goals** (je mit Folgeticket, anzulegen in Aufgabe 8.4):

- **Fristen je Datenkategorie**, z. B. Sichtung kürzer als ETB. Das braucht eine Migration
  und eine eigene Politikentscheidung.
- **Endgültige Löschung des Skeletts** (Einsatzkopf und ETB nach einer zweiten Frist). Heute
  bleibt das Skelett unbegrenzt erhalten.
- **Sofort-Schwärzung auf Antrag (Art. 17 DSGVO)** für den ganzen Einsatz oder eine einzelne
  Person, ohne Frist, Takt und Karenz.
- **Chat- und Erinnerungs-Freitexte** (LFH-290, Welle A). Diese Änderung fasst weder die
  Registry noch den Audit-Text der Schwärzung an.
- **Scrub-Werte im Wortlaut von System-Einträgen** (Schadensort, Übergabe-Adressat,
  Verbleib-Ziel, UHS-Austrittsnotiz, Name ad-hoc externer Kräfte, Dokumenttitel und was die
  vollständige Durchsicht in Aufgabe 7.2 noch findet) bleiben, wie sie sind. Sie werden
  dokumentiert und gepinnt (Präzedenz Zonen-Label, LFH-60 Welle A). Ob künftige Einträge sie
  weglassen, entscheidet ein eigenes Ticket (siehe Annahme A2).
- **Export und Druck der Archivakte** (LFH-22/LFH-71), **Anhänge im Archiv**, Lesezugriff
  der Führungskraft.
- **Erinnerungs-Scheduler in gelöschten Einsätzen** (Nebenbefund `erinnerung/repo.rs:174-189`,
  eigenes Ticket laut Entscheidungsliste).

## Decisions

### D1 — „Org-Admin“ ist der System-Admin der eigenen Organisation (Annahme A1)

Eine Rolle „Org-Admin“ gibt es nicht. Die Entscheidung wird auf den `AdminUser` abgebildet,
weil nur er die Org-Einstellungen schreibt, darunter die Vorgabe der Aufbewahrungsdauer. Für
das Archiv gilt zusätzlich `benutzer.org_id == einsatz.org_id`. Sonst antwortet das System mit
403, gleiche Semantik wie `fordere_org_zugehoerigkeit`. Das ist enger als sonst beim
System-Admin, der Einsätze serverweit lesen darf (`darf_fremdeinsatz_lesen`). Gesperrte
Akten sind aber der datensparsamste Bereich, und die Übersicht ist ohnehin nach
`benutzer.org_id` geschnitten. Ein Sprung aus ihr kann also nie in eine fremde Organisation
führen. Die **Führungskraft** ist ausgeschlossen: Sie liest den Admin-Bereich nur lesend,
und die Entscheidung nennt den Admin.

**Benannte Inkonsistenz, bewusst nicht angeglichen:** `PUT …/aufbewahrungsfrist` erlaubt dem
System-Admin weiter, serverweit ohne Org-Prüfung zu handeln. Eine Angleichung änderte
bestehendes Verhalten außerhalb des Auftrags. Sie steht als offene Frage im Bericht.

**Verworfen:** Führungskraft einschließen (nicht Teil der Entscheidung, und der Admin-Bereich
ist für sie nur lesend). Eine eigene Rolle „Org-Admin“ (Migration und neues Rechtekonzept).

### D2 — Eigener Namensraum statt Ausnahme in `darf_lesen`

`darf_lesen`, `fordere_lesezugriff` und `fordere_lese_gates` bleiben **unverändert**. Das
Archiv bekommt einen eigenen Namensraum:

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/aufbewahrung` | Übersicht der Organisation |
| GET | `/api/aufbewahrung/einsaetze/{id}` | Archivakte: Kopf, Zustand, Register |
| GET | `/api/aufbewahrung/einsaetze/{id}/etb` | Archiv-ETB (`typ`, `before_lfd_nr`, `limit`) |
| POST | `/api/aufbewahrung/einsaetze/{id}/wiederherstellen` | Wiederherstellen |

Jeder Handler nimmt `AdminUser` und für die ID `PfadParam`, Bodies kommen über `JsonBody`.
Die Org- und Zustandsprüfung liegt in einer Funktion `fordere_archivzugriff(benutzer,
einsatz)` (403 fremde Org, 409 aktiv). Ein **neuer Struktur-Guard** `tests/aufbewahrung.rs`
parst `src/app.rs` und `src/routes/aufbewahrung.rs`. Er prüft, dass jede Route unter
`/api/aufbewahrung` einen Handler mit `AdminUser` hat und dass genau eine davon kein `get` ist,
nämlich `wiederherstellen`. Der bestehende `einsatz_kontext_guard` sieht den Namensraum nicht
und muss nicht angefasst werden.

**Verworfen:** ein Flag `archiv: bool` in `darf_lesen` oder eine Admin-Ausnahme vor dem
Tombstone-Check. Damit wären **alle** regulären Routen wieder offen, auch Personen mit Namen
während der Karenz, Anhänge und Export. Die Totalsperre hinge dann an jeder einzelnen Route
statt an einer Stelle. Ebenfalls verworfen: die Routen unter `/api/einsaetze/{id}/archiv/…`.
Dann müsste `einsatz_kontext_guard` eine Ausnahme bekommen, und der Pfad suggerierte ein
Einsatzmodul mit Modul-Overrides, das es nicht gibt.

**Beleg für „bleibt gesperrt“:** Der bestehende Test
`geloescht_at_tombstone_sperrt_detail_export_stream_403` deckt nur den Tombstone ab. Neu kommt
die zweite Sperrvariante dazu (Frist abgelaufen, kein Tombstone, Admin → 403 auf Detail, ETB,
Personen, Anhänge, Live). Außerdem ein Test, der nach der Schwärzung dieselben Routen für den
Admin prüft, während das Archiv 200 liefert.

### D3 — Die Archivakte ist eine Retain-Projektion aus Registry-Konstanten

`src/aufbewahrung/projektion.rs` führt je Quelle eine Konstante:

- `KOPF` auf `einsatz`: `id, org_id, bezeichnung, stichwort, einsatzart,
  einsatznummer_intern, leitstellen_nr, begonnen_at, abgeschlossen_at,
  anzahl_betroffene_initial, retention_bis, geloescht_at, geschwaerzt_at`
- `PERSON` auf `einsatz_person`: `registrier_nr, status, aktuelle_sichtung,
  aktuelle_verbleib_art, aktueller_verbleib_status, erfasst_at, storniert_at`
- `TIER` auf `einsatz_tier`: `registrier_nr, spezies, status, abschluss_grund, erfasst_at,
  storniert_at`
- `SCHADEN` auf `einsatz_schaden`: `registrier_nr, typ, ausmass, status, abschluss_grund,
  erfasst_at, storniert_at`
- `ETB` auf `etb_eintrag`: `id, lfd_nr, typ, inhalt, von, an, meldeweg, veranlassung,
  erfasser_id, erfasser_funktion, ereigniszeit, received_at, berichtigt_eintrag_id`

Das SELECT entsteht aus diesen Konstanten, mit `AssertSqlSafe` wie bei
`scrubbe_aus_registry`. Ein Unit-Guard prüft jede Spalte über `klassifikation_von` auf
`Retain(_)`. Eine Scrub-Spalte oder ein Name, den die Registry nicht kennt, macht den Test
rot. Weil Liste und SELECT dieselbe Konstante sind, können sie nicht auseinanderlaufen.

Die Auswahl ist bewusst **kleiner als alles, was Retain ist**. Tier-Rufname und
-beschreibung (G_TIER) und die Schadenskoordinate (G_GEO) sind Retain, stehen aber nicht in
der Akte. Datensparsamkeit geht vor, und für die Rekonstruktion der ETB-Spur genügt die
Registriernummer mit Kategorie. Aus demselben Grund fehlen die Rückverweise des ETB
(`lagebericht_id`, `auftrag_id`, `befehl_id`, `meldung_id`, `nachforderung_id`), weil ihre
Ziele nicht lesbar sind.

**Einzige Ausnahme außerhalb der Registry:** `erfasser_name` kommt per JOIN aus `benutzer`.
Das ist eine Stammdatentabelle der Organisation, nicht einsatzbezogen und nicht Gegenstand
der Einsatz-Schwärzung (so auch `stammdaten_teilbaum_nie_einsatz_scoped`). Der Guard führt
sie als einzigen benannten JOIN.

**Eigene DTOs**, nicht `EtbEintragAnzeige`/`EinsatzAnzeige`/`PersonAnzeige`: Welle C
(LFH-117) hängt Anhänge an `EtbEintragAnzeige`. Das Archiv würde sie still mitliefern, und
während der Karenz existieren die Dateien noch. `ArchivEtbEintragAnzeige`,
`ArchivKopfAnzeige` und `ArchivRegisterEintragAnzeige` tragen genau die Projektion. Die
Registriernummer steht zusätzlich in Anzeigeform über die vorhandenen
`person::registrier_anzeige` („R-042“), `tier::registrier_anzeige` („T-042“) und
`schaden::registrier_anzeige` („S-042“). Die Filter- und Cursorlogik des Archiv-ETB ist eine
eigene, schmale Abfrage (`typ`, `before_lfd_nr`, `limit` mit `STANDARD_LIMIT`/`MAX_LIMIT` aus
`etb::repo`), kein Aufruf von `etb::repo::abfrage`. Dessen Rückgabetyp wächst mit Welle C.

### D4 — Aufbewahrungszustand als reine Funktion, eine Vertragskarte mehr

`retention.rs` bekommt `pub fn zustand(status, retention_bis, geloescht_at, geschwaerzt_at,
jetzt) -> Option<AufbewahrungZustand>` (`None` für aktive Einsätze) und
`pub fn karenz_ende(geloescht_at) -> Option<String>`. Die Rangfolge prüft zuerst
`geschwaerzt`, dann `schwaerzung_ausstehend` (`karenz_abgelaufen`), dann `vorgemerkt`, dann
`faellig` (`retention_abgelaufen`), dann `frist_laeuft`, zuletzt `ohne_frist`. Die Funktion
liegt neben `karenz_abgelaufen`, damit Grenze und Zustand dieselbe Zeitrechnung teilen.

`AufbewahrungZustand` ist ein Enum mit `#[serde(rename_all = "snake_case")]`, `as_str()` und
`ToSchema`. Es wird in `api_doc.rs` registriert und in `tests/enum_wire_kontrakt.rs` per
`enum_wire_as_str!` gepinnt.

Frontend: Die neue Vertragskarte `aufbewahrungZustand` in `theme/statusFarben.ts` geht an
`StatusTag`. `ohne_frist`, `frist_laeuft` und `geschwaerzt` sind neutral, `faellig` und
`vorgemerkt` `achtung`, `schwaerzung_ausstehend` `alarm`. Die Wörter sind „ohne Frist“,
„Frist läuft“, „fällig“, „zur Löschung vorgemerkt“, „Schwärzung steht aus“ und „geschwärzt“.
`ALLE_MAPS` wächst **von 24 auf 25**. Das ist die im Ticket begründete Entscheidung, die
CLAUDE.md für jede weitere Karte verlangt. Die Begründung: Der Zustand trägt Handlungsdruck,
denn nur während `vorgemerkt` ist Wiederherstellen möglich. Und er erscheint an zwei Stellen
(Übersicht, Akte), die ohne gemeinsame Karte auseinanderliefen. `schwaerzung_ausstehend` ist
`alarm`, weil dort jede Rücknahme verloren ist.

### D5 — Wiederherstellen: eine Pforte mit bewachtem UPDATE

`einsatz::repo::wiederherstellen(pool, einsatz_id, admin_id, neue_frist, jetzt)` läuft in
einer Transaktion:

1. `UPDATE einsatz SET geloescht_at = NULL, retention_bis = ? WHERE id = ? AND status =
   'abgeschlossen' AND geloescht_at IS NOT NULL AND geschwaerzt_at IS NULL AND geloescht_at >
   ?`. Der letzte Parameter ist `jetzt − KARENZ_TAGE` im DB-Format. Die Grenze entspricht
   `karenz_abgelaufen` (`jetzt >= geloescht_at + 30 d` heißt abgelaufen), ein Unit-Test pinnt
   die Gleichheit an der Grenze.
2. Bei `rows_affected == 1` folgt der ETB-Eintrag mit dem Admin als Erfasser: „Löschvormerkung
   vom <geloescht_at> aufgehoben (Wiederherstellung während der Karenz). Aufbewahrungsfrist
   neu: <frist | unbegrenzt>“.
3. Bei 0 Zeilen liest die Funktion neu und ordnet ein. Schwärzungs-Tombstone oder
   abgelaufene Karenz ergeben **409**, fehlende Vormerkung **422**, ein aktiver Einsatz
   **409** (bereits durch `fordere_archivzugriff`).

**Statuscodes nach LFH-267, begründet:** 409 steht für einen **endgültigen
Lebenszyklus-Zustand**, wie das Storno. Es gibt keinen Rückweg und kein sinnvolles „erneut
versuchen“, das Frontend bietet dort nichts an. 422 steht für einen Zustand, der die Aktion
**jetzt** verbietet, obwohl ein anderer Weg existiert: Ein nicht vorgemerkter Einsatz braucht
kein Wiederherstellen, seine Frist ändert man über `PUT …/aufbewahrungsfrist`. Eine Frist in
der Vergangenheit ist 422, weil das Feld für sich gültig ist und erst der Bezug zu `jetzt`
es verbietet. Ein fehlender Schlüssel ist 400: Der Body nimmt
`retention_bis: Option<Option<String>>` mit `#[serde(default,
deserialize_with = deserialize_optional_field)]` (Muster PATCH), und „fehlt“ unterscheidet
sich von `null`. Eine unlesbare Zeit ist 400 (`normalisiere_zeit`).

**Warum die Frist Pflicht ist:** Ohne neue Frist stünde `retention_bis` weiter in der
Vergangenheit, und Phase A merkte den Einsatz im nächsten Lauf (≤ 10 min) wieder vor. Ein
getrennter Aufruf „erst wiederherstellen, dann Frist setzen“ hätte genau dieses Fenster. Der
Test „Nächster Purge-Lauf“ belegt es mit `tick_einmal` direkt nach dem Wiederherstellen.

**Nebenläufigkeit mit Phase B:** SQLite serialisiert die Schreibtransaktionen. Beide UPDATEs
sind bewacht (`geschwaerzt_at IS NULL`). Gewinnt die Schwärzung, findet das Wiederherstellen
0 Zeilen und antwortet 409. Gewinnt das Wiederherstellen, findet Phase B den Einsatz nicht
mehr (`geloescht_at IS NOT NULL` im WHERE von `schwaerze_einsatz`).

**Karenz streng statt „bis zum nächsten Lauf“:** Nach Karenz-Ende ist Wiederherstellen 409,
auch wenn der Tick noch nicht geschwärzt hat. Die Entscheidung spricht von „während der
30-Tage-Karenz“, und eine Zusage, die vom Takt des Schedulers abhängt, wäre keine.

### D6 — Frist-PUT an vorgemerkten Einsätzen: 422, an geschwärzten 409

`aufbewahrungsfrist_setzen` liest `geloescht_at` und `geschwaerzt_at` (ein schmaler Abruf
in `aufbewahrung::repo`, damit `Einsatz` und seine Test-Literale kein neues Feld brauchen).
Die Prüfung steht **vor** dem frühen Rücksprung „Frist unverändert → 200“ und vor der
Verkürzungsprüfung. Sonst beantwortete ein unveränderter PUT an einem vorgemerkten Einsatz
die Anfrage mit 200 statt 422. Geschwärzt ergibt **409**, dieselbe
Lebenszyklus-Begründung wie D5. Vorgemerkt innerhalb der Karenz ergibt **422** mit dem Text
„Einsatz ist zur Löschung vorgemerkt – erst wiederherstellen“. Ist die Karenz abgelaufen
(`schwaerzung_ausstehend`), ist auch das Wiederherstellen 409, der PUT antwortet dort
deshalb ebenfalls **409** (Nachtrag aus dem Review; eine Stelle: `aufbewahrung::frist_sperre`,
genutzt von Route und `frist_setzen`-Fallback). Die Route hat damit keine zweite 409-Bedeutung
für einen umkehrbaren Zustand (CLAUDE.md, zwei 409-Quellen). Ein Unit-Test in
`purge_scheduler.rs` pinnt dazu, dass Phase B `retention_bis` nicht liest: Ein vorgemerkter
Einsatz mit direkt in der DB verlängerter Frist wird nach der Karenz trotzdem geschwärzt.

Die bestehenden Tests `aufbewahrungsfrist_*` in `tests/einsatz.rs:1183-1318` setzen die Frist
nie nach einem Tombstone. Keiner hängt am alten Verhalten.

### D7 — Audit: Akteurskette mit Admin, sonst kein Schreiben

`ermittle_system_akteur` bekommt eine dritte Stufe: den System-Admin der Organisation des
Einsatzes mit der kleinsten ID (`ORDER BY id`, **deterministisch, nicht „erste Org“**, der
`org_scope_guard` greift nicht, weil die Org aus `einsatz.org_id` kommt). Aktive Admins
kommen vor inaktiven. `system_audit_tx` gibt ohne Akteur
`Err(AppError::Internal(…))` zurück statt `Ok(())`. Die Transaktion von
`soft_delete_einsatz` bzw. `schwaerze_einsatz` rollt damit zurück. `tick_einmal` protokolliert
den Fehler (Phase A heute `warn`, neu `error`, wie Phase B) und versucht es im nächsten Lauf
erneut. **Sichtbar ist die Blockade nur im Log** (`tracing::error!` je Lauf, mit Einsatz und
Org; Nachtrag aus dem Review): eine Blockade besteht nur, solange die Org keinen einzigen
System-Admin hat — und dann kann auch niemand die Übersicht öffnen. Legt die Org wieder einen
Admin an, löst der nächste Lauf die Blockade ohnehin auf. `faellig` in der Übersicht ist kein
Blockade-Signal, sondern zwischen zwei Läufen der normale Zustand.

Die Audit-Texte ändern sich nicht. Sie lesen sich schon als automatische Vorgänge
(„Aufbewahrungsfrist abgelaufen — Einsatz zur Löschung vorgemerkt …“), und der Text der
Schwärzung gehört Welle A.

**Verworfen:**
- **Ein eigener System-Benutzer** je Organisation. Er braucht eine Migration, einen Riegel im
  Login (Passwort, OIDC, WebAuthn), einen Filter in der Benutzerliste und einen Sonderfall
  bei der SSO-Provisionierung. Das sind vier Stellen für einen Fall, der ohne
  Datenbankeingriff kaum eintritt (`abgeschlossen_von` setzt jeder Abschluss über die API).
- **`erfasser_id` nullable machen.** Das wäre ein Rebuild von `etb_eintrag`, der Kerntabelle
  mit den meisten eingehenden Fremdschlüsseln.
- **Rückfall auf irgendeinen Benutzer der Organisation.** Dann stünde ein Mensch als
  Erfasser eines rechtsverbindlichen Eintrags, der mit der Aufbewahrung nichts zu tun hat.
- **Weiter still überspringen.** Genau das untersagt der Auftrag.

### D8 — Frontend: Sondereintrag der Verwaltung, eigene Akte, Frist-Paneel als Baustein

- **Navigation**: `adminAufbewahrung = { key: 'aufbewahrung', label: 'Aufbewahrung' }` nach
  dem Muster `adminBenutzer`, sichtbar nur bei `system_rolle = admin`. Pfad-Builder
  `adminAufbewahrungPfad()` und `adminAufbewahrungAktePfad(einsatzId)` in `admin/adminNav.tsx`,
  **nicht** in `routing/deeplinks.ts`, das nur Einsatz-Pfade trägt (Präzedenz LFH-346 · C11).
  `parseRouteId` validiert `:einsatzId`, eine ungültige ID leitet auf die Übersicht um.
- **Übersicht** (`aufbewahrung/AufbewahrungUebersicht.tsx`): Hier wird verglichen, also
  eine Tabelle über `Datensicht form="tabelle"`. Fixierte Kennung ist die Einsatznummer (nie
  die DB-ID), der Zustand erscheint als `StatusTag`, darüber eine `Segmentleiste` nach Zustand
  („alle“ plus die sechs Werte). Die Spalten Karenz-Ende und Geschwärzt am tragen Zahlbreiten,
  die Bezeichnung trägt `mindestBreite` (LFH-523). Ein Zeilenklick öffnet die Akte.
- **Akte** (`aufbewahrung/ArchivAktePage.tsx`): Seitenkopf mit Einsatznummer und
  Bezeichnung, darunter drei Paneele. „Aufbewahrung“ zeigt Zustand, Frist, Vormerkung,
  Karenz-Ende und Schwärzung als `Datenraster` und trägt die eine Primäraktion: Frist ändern
  (nicht vorgemerkt) oder Wiederherstellen (vorgemerkt, Karenz läuft). „Register“ enthält
  Personen, Tiere und Schäden als Tabellen, auf schmalen Schirmen angepasst statt in Karten
  aufgelöst. „Einsatztagebuch“ ist eine **lesende** Zeitachse aus dem Baustein
  `Zeitachseneintrag`, ohne `EtbZeitachse`, weil die Berichtigung, Folgeaufträge und
  Deeplinks mitbringt. Dazu kommen ein Typfilter und „ältere laden“ über `before_lfd_nr`. Ein
  Berichtigungsverweis steht als Text („berichtigt Nr. 7“), nicht als Link. `Markdown` im
  Inhalt nimmt `unterEbene` passend zum Paneel (`h2` → 2).
- **Wiederherstellen** ist ein `ErfassungsModal` mit zwei Feldern: neue Frist (DatePicker)
  und „unbegrenzt“ (Schalter, Vorgabe aus). Die Aktion ist umkehrbar, deshalb keine
  `danger`-Rückfrage. Ein Fehler steht im Dialog, nicht im Toast (Muster `FreigabeDialog`).
- **Frist-Paneel** (`aufbewahrung/FristPaneel.tsx`) ist ein Baustein für die Einstellungen
  **und** die Akte. Es steht in `EinsatzAufbewahrung.tsx` **über und außerhalb** des
  Vollersatz-`<Form>`, mit eigener Mutation auf `PUT …/aufbewahrungsfrist` und eigenem Recht
  `darfFristSetzen(einsatz, benutzer)` (Einsatzleitung oder System-Admin, unabhängig von
  `aktiv`). Eine Verkürzung prüft der Client vorher mit `istFristverkuerzung`, einem Spiegel
  von `ist_fristverkuerzung`. Er fragt per `<Modal>` mit `okButtonProps={{ danger: true }}`
  zurück, weil eine Verkürzung die Sperre vorverlegt, und sendet dann `bestaetigt: true`. Die
  409 des Servers bleibt Sicherheitsnetz und wird dort als Text gezeigt, nicht ausgewertet.
  „Frist aufheben“ ist umkehrbar und fragt nicht zurück. Ohne Recht steht ein `RechteHinweis`
  da, die Knöpfe bleiben gesperrt sichtbar. Der Hinweis „Einstellungen eingefroren“ und die
  Beschreibung in `EinsatzAufbewahrung.tsx` werden angepasst („… außer der
  Aufbewahrungsfrist“, der Satz zur „manuellen Frist“ verweist auf das Paneel).
- **Zeit**: `retention_bis` ist UTC ohne Zonenkennung. Umrechnung ausschließlich über
  `etb/filterZeit.ts` (`alsOrtszeit`/`alsBackendZeit`), die nach `components/zeit/` oder
  `anzeige/` gehoben wird, wenn ein zweiter Aufrufer außerhalb von `etb/` sie importiert. Der
  bestehende Test beidseits der Sommerzeitgrenzen gilt dann für beide.
- **Query-Keys**: `GLOBAL_KEYS.aufbewahrung = 'aufbewahrung'` unter Mandant/Organisation.
  Accessoren sind `aufbewahrung()` (Prefix und Übersicht), `aufbewahrungAkte(id)` =
  `['aufbewahrung', 'akte', id]` und `aufbewahrungEtb(id, typ)` = `['aufbewahrung', 'etb', id,
  typ ?? 'alle']` (Sub-Key als String-Union-Token `AufbewahrungBereich = 'akte' | 'etb'`).
  Byte-Pins in `globalKeys.test.ts` stehen als Literale. Nach Wiederherstellen oder
  Friständerung werden `globalKeys.aufbewahrung()`, `globalKeys.einsaetze()` und
  `einsatzKeys.einsatz(id)` invalidiert, dazu das ETB des Einsatzes, weil ein neuer
  System-Eintrag entsteht.

### D9 — Ende-zu-Ende-Test für AK 3

`tests/aufbewahrung_e2e.rs` läuft über den Router (`oneshot`) und ruft
`purge_scheduler::tick_einmal` mit injiziertem `jetzt`:

1. Der Admin legt einen Einsatz an und setzt `retention_dauer_tage = 1` **vor** dem Abschluss,
   weil die Einstellungen danach eingefroren sind.
2. Über die API entsteht eine Person mit Name „Erika Mustermann“, `melder_kontakt`,
   `antreff_ort` und `notiz`, mit Sichtung SK II und einem Statuswechsel. Dazu ein Tier mit
   `halter_kontakt` und `kennzeichnung` samt Statuswechsel und ein Schaden mit
   `geschaedigt_kontakt`, `ort` und `beschreibung`, übergeben an einen Adressaten und
   abgeschlossen. Außerdem ein freier ETB-Eintrag und seine Berichtigung.
3. Der Einsatz wird abgeschlossen, dann liest der Test `retention_bis`.
4. `tick_einmal(retention_bis + 1 s)` merkt vor. Jetzt prüft der Test die Archivakte und das
   Archiv-ETB **während der Karenz**.
5. `tick_einmal(geloescht_at + 30 d)` schwärzt, danach folgen dieselben Prüfungen noch einmal.

Die Prüfungen:
- `PRAGMA foreign_key_check` ist leer.
- Alle ETB-Einträge sind vorhanden, `lfd_nr` ist lückenlos, und `berichtigt_eintrag_id`
  zeigt auf den richtigen Eintrag.
- Kein System-Eintrag enthält einen der gepflanzten Werte aus Personennamen, Kontakten,
  Notizen, Halterkontakt oder Kennzeichnung.
- Die Personen-, Tier- und Schadenszeilen tragen diese Werte nach der Schwärzung nicht mehr,
  `registrier_nr` ist unverändert.
- Beide Archiv-Antworten enthalten im **vollen Antworttext** keinen gepflanzten Wert, und zwar
  vor und nach der Schwärzung. Die Felder sind vorher und nachher identisch.
- Das Archiv-ETB mit Typ System enthält die Einträge zu Frist, Vormerkung und Schwärzung.
- Die regulären Routen liefern dem Admin 403.

**Ausnahmeliste (Annahme A2):** Aufgabe 7.2 geht zuerst alle ETB-Schreibwege durch
(`system_audit_tx`, `etb::repo::anlegen_tx`, `etb_system_degradiert`, rund 70 Aufrufstellen)
und hält jede Stelle fest, die einen Scrub-Wert in den Wortlaut übernimmt. Das ergibt die
Konstante `AUSNAHMEN_SYSTEM_ETB` im Test (Quelle, Scrub-Spalte, Begründung). Die Stichprobe
aus Context ist der Startbestand. Der Test pflanzt für jede Ausnahme, die sein Ablauf
berührt, einen eigenen Wert. Er erwartet ihn genau im zugehörigen System-Eintrag und nirgends
sonst. Aus der Archiv-Antwort-Prüfung nimmt er diese Werte nur für das ETB heraus, nicht für
Kopf und Register. Ausnahmen, die der Ablauf nicht berührt (etwa Dokumenttitel oder
Personal), stehen mit Fundstelle in der Liste und im Kommentar des Folgetickets.

### D10 — AK 1: Anforderung → Beleg

| Anforderung (`aufbewahrung`) | Belege heute (Bestand) | neu in diesem Change |
|---|---|---|
| Datenkategorien über zentrale Klassifikation | `schwaerzung_registry::tests::jede_einsatz_scoped_spalte_ist_klassifiziert`, `keine_toten_registry_eintraege`, `entdeckte_tabellen_gleich_registry_tabellen`, `stammdaten_teilbaum_nie_einsatz_scoped`, `zeile_loeschen_ist_kohaerent` | – |
| Frist aus Dauer beim Abschluss | `repo::tests::abschliessen_befuellt_retention_bis_aus_dauer_und_schreibt_audit`, `abschliessen_ohne_dauer_setzt_keine_frist`, `abschliessen_org_default_befuellt_retention_bis`, `abschliessen_einsatz_dauer_schlaegt_org_default`, `abschliessen_ueberschreibt_manuelle_frist_nicht`; `retention::tests::berechne_retention_bis_addiert_tage` | – |
| Manuelle Frist | `tests/einsatz.rs`: `aufbewahrungsfrist_verkuerzung_ohne_bestaetigung_ist_409`, `aufbewahrungsfrist_mit_bestaetigung_setzt_wert`, `aufbewahrungsfrist_nicht_admin_einsatzleitung_darf_setzen`, `aufbewahrungsfrist_fremder_ohne_rolle_ist_403`, `aufbewahrungsfrist_verlaengern_und_aufheben_ohne_bestaetigung`; `repo::tests::frist_setzen_speichert_und_schreibt_etb_audit`, `frist_setzen_none_hebt_frist_auf`; `berechtigung::tests::ist_fristverkuerzung_*` | 422 vorgemerkt, 409 geschwärzt (Aufgabe 3.2) |
| Lesesperre nach Fristablauf | `berechtigung::tests::darf_lesen_abgelaufene_frist_sperrt_*`, `darf_lesen_tombstone_sperrt_*`, `darf_lesen_abgelaufene_frist_greift_nicht_auf_aktive`; `tests/einsatz.rs`: `aufbewahrungsfrist_greift_erst_nach_abschluss_und_sperrt_dann_alle`, `abgelaufene_frist_sperrt_auch_personen_export`, `geloescht_at_tombstone_sperrt_detail_export_stream_403` | Frist-Variante für Admin auf allen Routen (Aufgabe 2.6) |
| Löschvormerkung | `purge_scheduler::tests::phase_a_soft_loescht_nur_abgelaufene_und_ist_idempotent`, `aktiver_einsatz_wird_nie_soft_geloescht`; `repo::tests::faellige_soft_delete_nur_abgeschlossen_abgelaufen_offen` | – |
| Karenz 30 Tage | `retention::tests::karenz_abgelaufen_grenzen`, `karenz_abgelaufen_ohne_oder_unparsebar_ist_false`; `purge_scheduler::tests::soft_geloescht_vor_karenz_wird_nicht_geschwaerzt` | „Frist ändert die Karenz nicht“ (Aufgabe 3.3) |
| Unwiderrufliche Schwärzung | `purge_scheduler::tests::phase_b_schwaerzt_alle_pii_inkl_stornierte_und_haelt_skelett`, `phase_b_schwaerzt_neue_luecken_und_haelt_fuehrungsdoku`, `schwaerzung_betreuung_ersetzt_bezeichnungen_und_haelt_mengen`, `schwaerzung_verpflegung_leert_ort_und_bemerkung_und_haelt_mengen` | FK-Prüfung und Ende-zu-Ende (Aufgabe 7) |
| Auslöser | `purge_scheduler::tests::*` (Phasen), Abschluss- und Frist-Tests oben | Wiederherstellen (Aufgabe 4) |
| Lückenloser Audit | Audit-Assertions in den Phase-A/B-Tests | Ersatzakteur und „kein Akteur“ (Aufgabe 1) |
| Pseudonyme Spur | `tests/einsatz_person.rs::anlegen_schreibt_pseudonymen_etb_eintrag_ohne_identitaet`, `tests/einsatz_tier.rs::anlegen_etb_pseudonym_ohne_rufname_und_halter`, `tests/einsatz_uhs.rs::etb_text_enthaelt_nur_pseudonym_keinen_namen` | Ende-zu-Ende mit Ausnahme-Pin (Aufgabe 7) |

Der LFH-135-Plan unter `docs/superpowers/plans/` bleibt unangetastet (eingefrorenes Archiv).
Seine offenen Checkboxen werden nicht abgehakt, diese Tabelle ersetzt sie als Nachweis.

## Risks / Trade-offs

- [Die Projektion driftet, wenn jemand dem DTO ein Feld gibt, ohne die Konstante zu ändern] →
  Das SELECT entsteht aus der Konstante, ein Feld ohne Spalte scheitert an `sqlx::FromRow`.
  Der Retain-Guard prüft die Konstante. Der Ende-zu-Ende-Test sucht zusätzlich die
  gepflanzten Werte im vollen Antworttext.
- [Welle C bringt `etb_eintrag_anhang`] → Das Archiv-ETB hat ein eigenes DTO. Die neue
  Join-Tabelle muss ohnehin in die Registry (Guard), taucht aber in keiner Archiv-Konstante
  auf.
- [Das ETB im Wortlaut kann Namen enthalten, die Menschen eingetippt haben] → Das ist die
  bestehende Entscheidung G_ETB (rechtsverbindliche Dokumentation). Die Akte zeigt es dem
  Admin so, wie es jede Einsatzleitung vor der Sperre sah. Die Oberfläche sagt das im
  Paneelkopf („ETB im Wortlaut, gesetzliches Aufbewahrungsskelett“).
- [Ein Admin stellt massenhaft wieder her und umgeht so die Löschpflicht] → Jede
  Wiederherstellung trägt einen ETB-Eintrag mit Namen, und die neue Frist ist Pflicht. Eine
  inhaltliche Grenze (etwa eine Höchstfrist) ist nicht Teil der Entscheidung.
- [Fail-closed beim Audit hält eine Löschung auf] → Tritt nur ohne jeden Admin in der
  Organisation ein. Dann meldet nur das Log einen Fehler je Lauf (mit Einsatz und Org); eine
  Übersicht, die es zeigen könnte, kann in dieser Org niemand öffnen.
- [Takt und Zeitzone] → `retention_bis` bleibt UTC. Die Oberfläche rechnet nur über
  `filterZeit`, und die Sommerzeit-Tests gelten für beide Richtungen.
- [Zweiter Admin-Namensraum neben `/api/org-*`] → bewusst, weil der Namensraum das
  Rechte- und Nur-Lese-Argument trägt (D2). Der eigene Guard macht ihn prüfbar.

## Migration Plan

Keine Migration: `retention_bis`, `geloescht_at` und `geschwaerzt_at` existieren
(`0003`/LFH-130/LFH-135). Die Auslieferung ist reiner Code. Rückweg ist ein Revert. Daten, die
nach dem Deploy wiederhergestellt wurden, bleiben mit ihrer neuen Frist gültig und brauchen
keinen Rückbau. Sollte sich beim Umsetzen doch eine Migration als nötig erweisen, gilt
LFH-658: nächste freie Nummer über `scripts/check-migrationen.sh` nach `git fetch`.

## Open Questions

Keine. Der Auftraggeber hat beide Annahmen am 25.09.2026 bestätigt:
- **A1 (D1):** „Org-Admin“ ist der System-Admin der eigenen Organisation. Die Führungskraft
  bekommt 403, eine fremde Organisation ebenfalls 403.
- **A2 (D9):** Scrub-Werte, die im Wortlaut von System-ETB-Einträgen stehen, bleiben dort
  (ETB-Politik, Präzedenz LFH-632/E9 und LFH-283). Sie werden nach vollständiger Durchsicht
  aller ETB-Schreibwege als Ausnahmeliste gepinnt. Eine Änderung des Wortlauts ist ein eigenes
  Ticket.
