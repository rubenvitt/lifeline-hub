# Design

## Context

Ausgangslage am 12.11.2026 (`origin/alpha` 3d74eba3), Motivation in proposal.md. Der Lösungsweg
ist am 12.11.2026 mit Ruben abgestimmt (Kommentare an LLH-1638).

- **Alter Weg** (LLH-1484): `GET /api/lagemonitor/v1/lage` (`src/routes/lagemonitor_v1.rs`) mit dem
  Extractor `LagemonitorZugriff` (`src/lagemonitor_zugang/mod.rs`), Bearer `llh_lm_…`, ohne
  Ablauf und Drosselung. Tabellen `lagemonitor_zugang` und `lagemonitor_freigabe` (Migration
  0270, Schlüssel `zugang_id`: ein Einsatz je Zugang). Die Freigabe schreibt einen System-Eintrag
  ins ETB (`etb::system_audit_tx`) und scheitert deshalb an einem Spiegel mit 409.
- **Verdichtung:** `routes::lagemonitor::verdichte` liefert die Zahlen ohne Personenbezug für den
  gekoppelten Monitor, den alten Weg und das Lagebild für Externe.
  `src/routes/lagebild_extern.rs` nutzt aus `lagemonitor_v1.rs` `baue_karte`, `karte_etag`,
  `lagemeldung`, `LageQuery`, `KARTE_AUS`, `LagemonitorUhsZahl` und `LagemonitorLagemeldung`.
- **Maschinenzugang** (LLH-1652): `MachineClient` prüft Signatur, Zustand, Drosselung,
  Wiederholung und Scope, zählt den Abruf und signiert die Antwort. `Scope::LageRead` gibt es
  schon; eine Route mit diesem Scope fehlt. Ein Zugang kennt keinen Einsatz.
- **Vorbild am Spiegel:** Das Lagebild für Externe (`routes/lagebild_extern.rs`) arbeitet auch an
  einem Spiegel: Prüfung `im_tx_aktiv`, ETB-Eintrag beim Führer direkt, am Spiegel als Antrag
  (`spiegel::antrag::etb_beantragen_tx`), Beenden auch ohne laufenden Abgleich. Seine Tabellen
  stehen in `spiegel::art::AUSGENOMMEN`.
- **Fremdsysteme kommen am Hub an** (Konzept D8, Spec `maschinenzugang`, „Ein gekoppelter ELW
  nimmt keine Fremdsysteme an“). Führt ein ELW den Einsatz, liegt er am Hub als Spiegel.
- **Freigabestufe** eines Spiegels kennt nur `alles` (`instanz::spiegel::Freigabestufe`).

## Goals / Non-Goals

**Goals:**

- Ein Lagemonitor liest ohne geteiltes Geheimnis, gedrosselt und im Abrufprotokoll.
- Die Freigabe ist so gebaut, dass weitere Lese-Scopes mit Einsatzbezug (LLH-1655) sie ohne Umbau
  mitnutzen.
- Der Fall „ELW führt, Hub hält den Spiegel“ funktioniert von Anfang an.
- Eine interne Umbenennung oder ein neues internes Feld kann die v1-Antwort nicht still ändern.

**Non-Goals:**

- `einsaetze:read`, `events:read` und ihre Routen (LLH-1655).
- Mehrere Einsätze je Zugang; vorbereitet, nicht gebaut (D2).
- Sparsamere Freigabestufen eines Spiegels.
- Der Lagebild-Link `llh_lb_` (Konzept D7) und der gekoppelte Lagemonitor der App.
- LGM-13 und LGM-14 (Projekt Lagemonitor).

## Decisions

### D1 Route `GET /api/v1/lage` in `public_api::lage`

Neues Modul `src/public_api/lage.rs` mit Handler, Schema und Aufbau der Antwort. Eingehängt in
`public_api::router()` mit `Extension(ScopeAnforderung::Scope(Scope::LageRead))`; im Dokument
`security(("machine" = ["lage:read"]))`, Tag „Lage“, `operation_id` `get_lage`. Der Handler nimmt
`MachineClient`, liest die Freigabe (D2), baut die Antwort und gibt sie über `client.antwort`
signiert zurück. Fehler laufen als `ApiError`.

- Ohne wirksame Freigabe: 200 mit `einsatz: null` (wie bisher; ein Monitor zeigt seinen
  Leerzustand, statt einen Fehler zu behandeln). Das Konzept nennt 404 für fehlende Freigabe bei
  Routen mit Einsatz im Pfad; hier steht kein Einsatz im Pfad.
- Org-Doppelprüfung wie bisher: Gehört der Einsatz einer anderen Org als der Zugang, 500 statt
  Daten.

Verworfen: den alten Handler unter neuem Pfad wiederverwenden. Seine Typen stehen in `api_doc.rs`,
und v1 darf keinen internen Typ tragen (`src/AGENTS.md`, „Öffentliche API v1“).

### D2 Tabelle `maschinenzugang_freigabe`: ein Einsatz je Zugang, erweiterbar

Migration `0339_maschinenzugang_freigabe.sql` (beim Bau von 0335 umnummeriert, weil `alpha` weiterlief):

```sql
CREATE TABLE maschinenzugang_freigabe (
    zugang_id       TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    freigegeben_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    freigegeben_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (zugang_id, einsatz_id)
);
CREATE UNIQUE INDEX idx_maschinenzugang_freigabe_zugang ON maschinenzugang_freigabe (zugang_id);
CREATE INDEX idx_maschinenzugang_freigabe_einsatz ON maschinenzugang_freigabe (einsatz_id);
```

„Ein Einsatz je Zugang“ (Entscheidung Ruben) trägt der eindeutige Index, nicht der
Primärschlüssel. Will LLH-1655 mehrere Einsätze je Zugang, fällt nur der Index; `GET /api/v1/lage`
bekäme dann ein optionales `?einsatz_id=`, was der Vertrag erlaubt.

Repo in `src/public_api/freigabe.rs` (Muster `lagemonitor_zugang`): `list_fuer_einsatz`,
`freigeben_tx` (Upsert auf `zugang_id`, Ergebnis `Keine`/`Neu`/`Abgeloest { vorher }`),
`beenden_tx`, `delete_fuer_einsatz_tx`, `delete_fuer_zugang_tx`, `freigegebener_einsatz`.

**Wirksam** ist eine Freigabe nur an einem aktiven, nicht gelöschten Einsatz (Join wie
`FREIGABE_AKTIV`). So endet sie auch dort, wo kein Schreibweg sie löscht: an einem Spiegel, dessen
Abschluss über die Übernahme ankommt.

**Einordnung:** `schwaerzung_registry::TABELLEN` (`Scoping::EinsatzId`, alle Spalten `retain`,
wie `lagemonitor_freigabe`) und `spiegel::art::AUSGENOMMEN` mit dem Grund „Zugänge von
Fremdsystemen hängen an einer Instanz“. Ohne Marker `-- no-transaction`: es wird keine Tabelle
umgebaut.

### D3 Welche Zugänge freigebbar sind

`Scope::has_einsatzbezug()` ist heute nur für `LageRead` wahr. `EinsaetzeRead` und
`EventsRead` kommen mit ihren Routen dazu (LLH-1655); bis dahin hätte eine Freigabe für sie keine
Wirkung, und das Paneel zeigte Schalter ohne Folge.

Freigebbar ist ein Zugang der Org des Einsatzes, nicht widerrufen, nicht abgelaufen, mit
mindestens einem solchen Scope, und nur an einer Instanz, die sich für die Org nicht bei einem
Hub meldet (dort lehnt der Extractor jeden Zugang ab). Auch ein Zugang im Zustand `wartet` (Code
noch nicht eingelöst): die Einsatzleitung kann vorab freigeben, das Paneel zeigt „wartet auf
Schlüssel“.

**Eine Freigabe von vor der Kopplung ruht** (Befund des Nachreviews, 12.11.2026). Die Spec
`maschinenzugang` lässt einen Zugang die Kopplung überleben: er wird abgewiesen, nicht
widerrufen, und gilt wieder, sobald die Kopplung endet. Die Freigabe hängt am Zugang und folgt
ihm: sie bleibt stehen und gilt nach dem Ende der Kopplung wieder. Damit das niemanden
überrascht, zeigt das Paneel am gekoppelten ELW genau die Zugänge, die diesen Einsatz schon
lesen, mit „Freigabe ruht: Instanz meldet sich bei einem Hub“ (`AnbindungFreigabe.ruht`); die
Einsatzleitung kann die Freigabe dort beenden, aber keine neue erteilen. Verworfen: die Freigabe
beim Koppeln löschen. Das träfe auch die kurze Direktkopplung vor Ort und verlangte nach jeder
Kopplung eine neue Freigabe, obwohl sich an der Entscheidung der Einsatzleitung nichts geändert
hat.

### D4 Freigabe-Routen am Einsatz, auch am Spiegel

Neue Datei `src/routes/einsatz_anbindungen.rs`, Routen in `src/app.rs` beim Einsatz-Router,
modul-los in `einsatz::modul` wie die Geräte:

| Methode und Pfad | Wirkung | Antwort |
| --- | --- | --- |
| `GET /api/einsaetze/{id}/anbindungen` | freigebbare Zugänge aus Sicht des Einsatzes | `Vec<AnbindungFreigabe>` |
| `PUT /api/einsaetze/{id}/anbindungen/{zid}/freigabe` | Zugang liest ab jetzt diesen Einsatz | Liste |
| `DELETE /api/einsaetze/{id}/anbindungen/{zid}/freigabe` | Zugang liest ihn nicht mehr | Liste |

`AnbindungFreigabe { zugang_id, name, scopes, zustand, freigegeben, anderer_einsatz,
zuletzt_genutzt_at? }` (Typ in `api_doc.rs`, generiert).

Rechte und Ablauf wie `routes/lagebild_extern.rs`, dessen Helfer dafür geteilt werden (nach
`routes/support` oder ein kleines gemeinsames Modul, nicht kopiert):

- `EinsatzLesezugriff` und `fordere_einsatzleitung()`, Einsatz aktiv (409 sonst). Kein
  `EinsatzLeitungszugriff`: der sperrt am Spiegel.
- In der Transaktion `im_tx_aktiv`, dann Zugang prüfen (D3; sonst 404), dann `freigeben_tx`.
- ETB-Eintrag: beim Führer `etb::system_audit_tx`, am Spiegel `etb_beantragen_tx` (Typ
  Entscheidung, „von“ die handelnde Person, „an“ der Name des Zugangs). Beim Umstellen bekommt
  auch der frühere Einsatz seinen Eintrag: geführt direkt, als Spiegel per Antrag. Der Antrag
  entfällt, wenn dort der Abgleich beendet ist oder die handelnde Person im früheren Einsatz
  nicht zur Führung gehört (Nachtrag beim Bau, 12.11.2026): der Führer lehnte ihn sonst ab, und
  er stünde der Person dauerhaft als abgelehnt in der Liste.
- Freigeben an einem Spiegel, dessen Abgleich beendet ist, scheitert mit 409 (kein Antrag
  möglich), wie beim Lagebild-Link: die Zahlen würden nicht mehr aktuell.
- Beenden an einem Spiegel ohne laufenden Abgleich gilt ohne Antrag (wie beim Lagebild-Link).
- Idempotent; das ETB nennt nur Wirkungen.

ETB-Texte: „Einsatz für die Anbindung „{name}“ freigegeben von {person}.“ · „Anbindung „{name}“
liest jetzt einen anderen Einsatz (umgestellt von {person}).“ · „Freigabe für die Anbindung
„{name}“ beendet von {person}.“

Verworfen: die Freigabe nur beim Führer erlauben. Dann ginge am Hub kein vom ELW geführter
Einsatz, also genau der Regelfall der Kopplung.

### D5 Ende der Freigabe

| Anlass | Wo | Wirkung |
| --- | --- | --- |
| Einsatzabschluss | `einsatz::repo::abschliessen`, an Stelle des Aufrufs für `lagemonitor_freigabe` | Zeilen des Einsatzes löschen |
| Abschluss kommt über den Spiegel | – | Freigabe unwirksam (D2), Zeile fällt mit dem Einsatz oder der nächsten Freigabe |
| Widerruf des Zugangs | `routes::anbindungen::widerrufen`, in der Transaktion | Zeile löschen, ETB |
| Entzug des letzten Scopes nach D3 | `routes::anbindungen::aendern`, in der Transaktion | Zeile löschen, ETB |
| Ablauf („gültig bis“) | `routes::anbindungen::aendern`, beim nächsten Ändern des Zugangs | Extractor antwortet 401, die Liste nach D4 blendet den Zugang aus; die Zeile fällt, bevor ein verlängertes „gültig bis“ sie wieder wirken ließe (Befund des Reviews, 12.11.2026), ETB |

Beim Widerruf und beim Entzug schreibt der Admin, nicht die Einsatzleitung. Führt die Instanz den
Einsatz, entsteht ein System-Eintrag im ETB („Anbindung „{name}“ widerrufen von {person}; der
Einsatz wird dort nicht mehr gelesen.“ bzw. „… darf keine Lage mehr lesen …“). Liegt er als
Spiegel vor, entsteht kein Antrag: ein Admin ohne Rolle im Einsatz ist kein Absender, den der
Führer annähme. Der Vorgang steht dann allein in der Admin-Spur.

### D6 v1-Schema und Wire-Namen

Eigene Typen in `public_api::lage`, aufgenommen in das Dokument über den Handler. Zeitpunkte UTC
`JJJJ-MM-TT hh:mm:ss`.

```
LageResponse   { stand_at, einsatz: LageEinsatz | null, karte?, karte_etag? }
LageEinsatz    { id, bezeichnung, stichwort?, einsatzart, begonnen_at, betroffene, kraefte,
                 uhs[], sofortmeldungen_offen, lagemeldung: LageLagemeldung | null,
                 sanitaetsdienst?, spiegel? }
LageBetroffene { gesamt, patienten, sk1, sk2, sk3, sk4, tot, unverletzt, ohne, vermisst,
                 abgeschlossen }
LageKraefte    { einheiten, personal, staerke: { fuehrer, unterfuehrer, mannschaft } }
LageUhs        { id, bezeichnung, kind, state, belegt, plaetze, kraefte }
LageLagemeldung    { text, freigegeben_at }
LageSanitaetsdienst { kontakte, kontakte_letzte_stunde, in_versorgung, transporte }
LageSpiegel    { letzter_abgleich_at | null, abgleich_beendet }
```

Gegenüber `LagemonitorLage` (Entscheidung Ruben, „Englisch wie D9“):

| Alt | Neu | Grund |
| --- | --- | --- |
| `api_version` | entfällt | die Version steht im Pfad |
| `stand_at` | bleibt | die Oberfläche zeigt „Stand“ |
| `uhs[].typ` | `uhs[].kind` | D9 nennt `kind` |
| `uhs[].status` | `uhs[].state` | D9 nennt `state` |
| `?karte=aus` | `?karte=none` | Abfragewerte englisch |
| – | `einsatz.id` | Ereignisse (LLH-1655) nennen `einsatz_id` |
| – | `einsatz.spiegel` | D8 |

**Enums:** `einsatzart`, `uhs[].kind`, `uhs[].state` und die Zonenart der Karte sind eigene
Wire-Enums in `public_api::lage` mit erschöpfendem `From` aus dem internen Enum. Ein neuer
interner Wert bricht dann den Build, statt still in v1 zu erscheinen; wer ihn aufnimmt,
entscheidet das. Die Werte bleiben deutsch (Fachbegriffe) und stehen in
`tests/enum_wire_kontrakt.rs`.

### D7 Karte: getypte Features statt durchgereichtem JSON

`baue_karte` baut heute per `json!` und reicht `typ` als Eigenschaft durch. Für v1 würde ein
nachträgliches Umbenennen im JSON jede künftige interne Eigenschaft mitnehmen, auch eine mit
Freitext. Deshalb:

- `routes::lagemonitor` bekommt eine getypte Zwischenform `KartenFeature` (Einsatzort, Zone,
  Abschnitt, Uhs, Zeichen, je mit Geometrie) und `load_karten_features(pool, kopf, verdichtet)`.
- Das Lagebild für Externe serialisiert daraus wie bisher (`build_karte`, Bytes und damit
  `karte_etag` unverändert; ein Test hält das fest).
- v1 serialisiert in `LageKarte { type, features[] }` mit
  `LageKarteFeature { type, geometry, properties }` und
  `LageKarteProperties { kind, id?, subkind?, bezeichnung?, kurzbezeichnung?, belegt?, plaetze?,
  zeichen_spec? }`.

| `kind` | Eigenschaften |
| --- | --- |
| `einsatzort` | – |
| `zone` | `id`, `subkind` (Zonenart: `gefahrengebiet`, `absperrbereich`, `absperrgrenze`, `sperrgebiet`) |
| `abschnitt` | `id`, `bezeichnung`, `kurzbezeichnung?` |
| `uhs` | `id`, `bezeichnung`, `subkind` (wie `uhs[].kind`), `belegt`, `plaetze` |
| `zeichen` | `id`, `zeichen_spec` |

`kind` ist schon die Art des Features; die frühere Eigenschaft `typ` heißt deshalb `subkind`.
`geometry` bleibt ein freies GeoJSON-Objekt. `karte_etag` sind die ersten 16 Hex-Zeichen des
SHA-256 der v1-Serialisierung.

### D8 Gespiegelter Einsatz in der Antwort

Am Spiegel rechnet `verdichte` auf den gespiegelten Zeilen, `stand_at` ist aber nur die Zeit der
Berechnung. Damit ein Monitor veraltete Zahlen kennzeichnen kann, trägt `einsatz.spiegel`
`letzter_abgleich_at` und `abgleich_beendet` (aus `einsatz.spiegel_abgleich_at` und
`spiegel_beendet_at`, wie `LagebildQuelle`). Führt die Instanz selbst, fehlt der Block.

Liefert die Freigabestufe eines Spiegels nicht alle Kategorien, aus denen die Lage stammt
(`lagebild_extern::FELD_QUELLEN`), gilt der Einsatz für die Route als nicht lesbar: `einsatz:
null`. Heute gibt es nur `alles`; die Prüfung steht trotzdem im Handler, damit eine spätere
Stufe keine halbe Lage ausliefert. Felder einzeln wegzulassen wie beim Lagebild-Link scheidet
aus: v1 kann Pflichtfelder nicht nachträglich optional machen.

### D9 Der alte Weg fällt ganz weg

Entscheidung Ruben vom 12.11.2026, abweichend von Konzept D6. Entfernt werden:

- Backend: `src/lagemonitor_zugang/`, `src/routes/lagemonitor_zugang.rs`,
  `src/routes/lagemonitor_v1.rs`, ihre Routen in `src/app.rs`, der Eintrag in
  `src/einsatz/modul.rs`, die Typen in `src/api_doc.rs`, `BEZEICHNUNG_MAX` samt Spiegel in
  `tests/eingabegrenzen_spiegel.rs`, `tests/lagemonitor_v1.rs`.
- Geteiltes zieht um: `karte_etag`, `lagemeldung`, `LageQuery`, `KARTE_AUS`, `LagemonitorUhsZahl`,
  `LagemonitorLagemeldung` und der Kartenbau nach `src/routes/lagemonitor.rs`. Die Umbenennung
  `baue_karte` → `build_karte` kommt als eigener `refactor`-Commit (Bezeichner-Sprache).
- Migration `0340_lagemonitor_zugang_entfernen.sql`: `DROP TABLE lagemonitor_freigabe; DROP TABLE lagemonitor_zugang;` (Kind zuerst,
  ohne Marker). 0269 und 0270 bleiben unangetastet. Die Einträge in `schwaerzung_registry` und
  `spiegel::art` entfallen.
- Admin-Spur: Die Aktionen `lesezugang_angelegt` und `lesezugang_widerrufen` bleiben im Enum, im
  CHECK und in den Texten des Zugangsprotokolls, damit alte Einträge lesbar sind. Geschrieben
  werden sie nicht mehr.
- Frontend: `pages/einstellungen/LagemonitorZugaenge.tsx`, `EinsatzLagemonitore.tsx`,
  `api/lagemonitorZugaenge.ts`, Eintrag `lagemonitore` in `admin/adminNav.tsx`, beide Query-Keys,
  `LAGEMONITOR_BEZEICHNUNG_MAX`, die Barrel-Exporte, ihre Tests.

Ein Aufruf des alten Pfads ergibt 404. Kein `Deprecation`-Kopf, kein Hinweis im Admin-Bereich:
es gibt keine Stelle mehr, an der er stünde.

### D10 Oberfläche

- **Paneel „Anbindungen“** auf der Seite „Geräte“ (`EinsatzAnbindungen.tsx`), an der Stelle des
  Paneels „Externe Lagemonitore“. Je Zugang Name, darunter Rechte (`RechteText`) und Zustand:
  „liest diesen Einsatz“ · „liest einen anderen Einsatz“ · „nicht freigegeben“, dazu „wartet auf
  Schlüssel“ und „zuletzt …“. Schalter mit `aria-label` „Anbindung {name} liest diesen Einsatz“.
  Ohne freigebbaren Zugang bleibt das Paneel weg; ein Ladefehler ist sichtbar. Fehlt nach einem
  abgelehnten Umschalten die Zeile (widerrufen, abgelaufen), steht der Grund als schließbarer
  Hinweis im Paneel, auch wenn es sonst leer wäre (Befund des Nachreviews, 12.11.2026).
- **Schaltbar**, wenn `leitung && istAktiv` und die Instanz den Einsatz führt oder als Spiegel
  hält (dieselbe Bedingung wie `darfLagebild`).
- **Query-Key** `einsatzKeys.anbindungen` in `NICHT_LIVE_KEYS` (wie `geraete`): die eigene
  Änderung setzt die Antwort, ein Abruf des Fremdsystems ist kein Ereignis. Weil Umstellen,
  Widerruf und Rechteentzug den Stand von außen ändern, fragt das Paneel alle 30 s nach und
  nach jedem gescheiterten Umschalten. Ohne Verbindung sind die Schalter gesperrt, die Mutation
  läuft mit `networkMode: 'always'` (Befunde des Reviews, 12.11.2026). Das Umschalten bricht
  einen laufenden Abruf ab, sonst überschriebe dessen ältere Antwort den neuen Stand.
- **Seite „Anbindungen“:** `AnbindungAnzeige` bekommt `einsatz_id?` und `einsatz_bezeichnung?`.
  Liste und Ansicht zeigen bei Zugängen nach D3 „liest {Einsatz}“ oder „kein Einsatz
  freigegeben“ (`einsatz_freigebbar`). An widerrufenen und abgelaufenen Zugängen und an einer
  Instanz, die sich für die Org bei einem Hub meldet, steht nichts davon: dort liest kein Zugang.
- Kein Entwurf über das Design System: ein Paneel nach vorhandenem Muster und eine Zeile mehr,
  keine neue Seite und kein neuer Baustein (`frontend/AGENTS.md`).

### D11 Referenz-Client und Kommando

`crates/lifeline-machine-client`: `http::lage(client, cred, karte: Option<&str>, now)` ruft
`GET /api/v1/lage` (mit `?karte=`) signiert auf, prüft die Antwortsignatur und liefert den Body.
`htu` trägt den Pfad mit Abfrage. Das Binary bekommt `lifeline-hub zugang lage` neben
`zugang me`: der kürzeste Weg, eine Anbindung samt Freigabe zu prüfen. TypeScript-Modul und
Python-Beispiel bleiben beim Verfahren; sie brauchen keinen eigenen Abruf.

### D12 ADR-0034 und ADR-0022

- **ADR-0034** „Ein Maschinenzugang liest einsatzbezogen nur, was die Einsatzleitung für ihn
  freigegeben hat“, `gilt_fuer` `src/public_api/**`, `src/routes/einsatz_anbindungen.rs`. Regeln:
  eine v1-Route mit Lese-Scope mit Einsatzbezug bestimmt ihren Einsatz allein über
  `public_api::freigabe`; die Freigabe gilt an der Instanz des Zugangs, wird nicht gespiegelt und
  geht auch am Spiegel; wirksam nur am aktiven Einsatz; kein Lesezugang für Fremdsysteme per
  Bearer-Schlüssel außerhalb von `/api/v1/`. Status `akzeptiert`: die Freigabe dieser Change durch
  Ruben ist die Annahme.
- **ADR-0022** ist akzeptiert und bleibt im Wortlaut. Aus `gilt_fuer` fallen die beiden Pfade,
  die es nicht mehr gibt (erlaubter Pfadnachzug, `docs/architektur/AGENTS.md`).

### D13 Doku

- `docs/api/maschinenzugang.md`: Abschnitt „Lage lesen“ mit Freigabe, Beispielantwort,
  `?karte=`, Tabelle der Kartenarten.
- `src/public_api/description.md`: ein Satz zur Freigabe bei Lese-Scopes mit Einsatzbezug.
- Anwenderkapitel `externe-lagemonitore.md` neu gefasst (Anbindung anlegen, Code einlösen,
  Einsatz freigeben; `quellen` auf die neuen Pfade), `anbindungen.md` (Freigabe, gelesener
  Einsatz), Verweise in `verwaltung.md`, `zugangsprotokoll.md`, `lagebild-extern.md`,
  `README.md`. Bilder gibt es zu diesen Kapiteln nicht.
- arc42: Kapitel 5 (Zeile `src/lagemonitor_zugang` entfällt, `public_api` ergänzt), Kapitel 11
  (R33 nennt nur noch die Instanzrouten).
- Konzept `docs/konzepte/2026-11-11-oeffentliche-api.md`: datierter Nachtrag an D6.
- `CHANGELOG.md` schreibt der Release-Lauf.

## Risks / Trade-offs

- [Bestehende `llh_lm_`-Schlüssel gelten nach dem Update nicht mehr, ohne Vorwarnung.] → Bewusst
  entschieden; die Gegenseite ist nicht gebaut. PR-Beschreibung und Commit nennen den Bruch, damit
  er unter „Wichtige Änderungen“ der Versionshinweise landet.
- [Migration 0340 löscht Daten und ist nicht umkehrbar.] → Die Tabellen tragen nur Hashes und
  Freigaben; ein Rückweg auf den alten Stand bräuchte neue Schlüssel ohnehin.
- [Der Umzug des Kartenbaus ändert still die Karte des Lagebild-Links.] → Test: `build_karte`
  liefert für einen festen Einsatz dieselben Bytes wie zuvor; `tests/lagebild_extern.rs` bleibt
  unverändert grün.
- [Am Spiegel sind die Zahlen so alt wie der letzte Abgleich.] → `einsatz.spiegel` (D8); die Doku
  sagt dem Client, es anzuzeigen.
- [Ein Widerruf am Spiegel steht nicht im ETB des Einsatzes.] → Admin-Spur trägt ihn (D5); im
  Anwenderkapitel benannt.
- [`subkind` in der Karte neben `kind` in der UHS-Liste ist uneinheitlich.] → Beide sind lokal
  eindeutig; die Tabelle in D7 kommt in die API-Doku.
- [Zwei Scope-Listen laufen auseinander: `has_einsatzbezug` und die Routen.] → Test über
  das Dokument (`routen_mit_einsatzbezug_lesen_nur_ueber_die_freigabe` in
  `tests/public_api_lage.rs`): jede Route, deren Scope `has_einsatzbezug()` trägt, steht in
  seiner Liste und liest ohne Freigabe keinen Einsatz, und kein Scope trägt Einsatzbezug ohne
  Route. Das Frontend führt keine eigene Liste: der Server nennt je Anbindung
  `einsatz_freigebbar`.
- [Eine gespeicherte Geometrie trägt Zusatzschlüssel mit Freitext.] → v1 führt jede Geometrie
  auf `type` und `coordinates` zurück (`public_api::lage::geometry`).

## Migration Plan

1. Migrationen 0339 und 0340 laufen beim Start. Vorher `scripts/check-migrationen.sh` gegen
   `origin/alpha`.
2. Nach dem Update: unter „Anbindungen“ je Monitor einen Zugang mit „Lage lesen“ anlegen, Code am
   Monitor einlösen, Einsatz auf der Seite „Geräte“ freigeben.
3. Ein Rückschritt auf die Vorversion braucht eine Datensicherung von vor dem Update (sqlx kennt
   keine Abwärtsmigration).

## Open Questions

Keine mehr. Beim Bau entschieden (12.11.2026): `lifeline-hub zugang lage` lässt die Karte ohne
`--karte` weg (`?karte=none`); am Terminal zählen Einsatz und Zahlen, die Route ändert sich
dadurch nicht.
