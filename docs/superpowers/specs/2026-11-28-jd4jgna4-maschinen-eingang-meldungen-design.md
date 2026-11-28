# Maschinen-Eingang für Meldungen — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/jd4jgna48kqghdvwl9yz5lev (LLH-2112, Folge aus
LLH-1201) · Stand 28.11.2026 · Route `entwurf` (E2 neuer Scope und neues Merkmal, E3 Backend und
Frontend)

## Absicht

Adapter liefern Kurztexte, deren Absender nicht nachgewiesen ist: zuerst die Mesh-Brücke
(LLH-2113), später das Postfach (LLH-1195) und Pager. Heute erfassen nur Menschen Meldungen. Ein
signierter Maschinenzugang (ADR-0034) soll einen solchen Text abgeben können. Er wird ein
**Vorschlag** im Meldungseingang des Einsatzes, gekennzeichnet „unverifiziert“, mit seiner
Herkunft. Ein Mensch übernimmt ihn als Meldung oder verwirft ihn. Erst die Übernahme macht daraus
eine Meldung, und erst die Meldung kann ins ETB (G1 „Ein Mensch entscheidet“, Konzept
`docs/konzepte/2026-11-10-schnittstellen-ausbau.md`).

Der Eingang ist neutral (G4): Er kennt „Adapter“, „Kennung des Absenders“, „signiert“, aber
nichts von Meshtastic. Was ein Adapter darüber hinaus weiß, bleibt in der Brücke.

## Ziele

- Ein Maschinenzugang mit Scope `meldungen:write` legt per `POST /api/v1/report-suggestions`
  einen Vorschlag im Einsatz an, den die Einsatzleitung für ihn freigegeben hat.
- Der Vorschlag erscheint im Meldungseingang als „unverifiziert“ mit Adapter, Kennung und Name
  des Absenders und ob die Quelle ihn signiert hat.
- Übernehmen öffnet das bekannte Meldungsformular, vorbelegt; Speichern legt die Meldung auf dem
  normalen Weg an (gleiche Prüfungen, gleiche Auto-ETB-Regel). Verwerfen entfernt den Vorschlag.
- Die übernommene Meldung trägt ihre Herkunft dauerhaft sichtbar („aus Maschinen-Eingang,
  unverifiziert übernommen“).
- Offene Vorschläge zählen im Modulzähler „Meldungen“ mit und kommen live an.

## Nicht-Ziele

- Keine Mesh-Brücke, kein Meshtastic-Wissen im Server (LLH-2113).
- Kein Ausgang an Mesh (LLH-2114) und keine Rückmeldung an die Quelle, was aus dem Vorschlag
  wurde.
- Keine Positionen (laufen über `positionen:write`).
- Keine Alarmübernahme (LLH-1192). Die Alarmmeldungen bleiben, wie sie sind.
- Kein Lesen von Vorschlägen über `/api/v1` und kein Ausgangsereignis für sie.
- Kein neuer Meldeweg.
- Keine Ansicht für gekoppelte Geräte.

## Anti-Ziele

- Ein Text einer Maschine steht ohne menschliche Entscheidung im ETB oder als Meldung im
  Eingang. Das wäre der Bruch von G1, auch wenn alles andere funktioniert.
- Eine übernommene Meldung sieht aus wie eine von Hand erfasste, die Herkunft ist verloren.
- Die Maschine bestimmt selbst, in welchen Einsatz ihr Text geht.

## Rahmen

- Signierte Anfragen nach ADR-0034/ADR-0096, Extractor und Drossel wie die anderen Routen unter
  `/api/v1/` (`src/AGENTS.md`, „Öffentliche API v1“). Body-Grenze 64 KiB.
- Neue Scope-Werte nur über `wire_enum!` und `tests/enum_wire_kontrakt.rs` (ADR-0006). Wire-Wert
  deutsch nach LFH-1312: `meldungen:write`.
- Feste Routensegmente englisch nach Glossar (ADR-0097, `scripts/api-routen-woerter.tsv`,
  Wächter `scripts/check-api-routen.sh`).
- Zeiten in UTC als `zeit::FORMAT` (ADR-0012).
- `openspec/` ist eingefroren: Die Spezifikationen `maschinenzugang` und `meldungseingang` werden
  nicht nachgezogen. Die neuen verbindlichen Regeln trägt die neue ADR (unten) und ein kurzer
  Abschnitt in `src/AGENTS.md`.
- Am Spiegel antworten die Schutz-Trigger auf Schreiben mit 409 (ADR-0018, LLH-1641).
- Migration: nächste freie Nummer auf `alpha` (Stand 28.11.: 0392), `migrations/AGENTS.md`.

## Ansätze (am 28.11.2026 abgestimmt)

Zu jedem Punkt standen Empfehlung (a) und Alternative zur Wahl; Ruben hat alle Empfehlungen
angenommen („passt“).

1. **Zuordnung zum Einsatz.**
   - Gewählt (a): über die **Freigabe der Einsatzleitung**, wie bei den Lese-Scopes mit
     Einsatzbezug. Je Zugang höchstens ein Einsatz. Damit ist „mehrere laufen“ gelöst, und ein
     Mensch entscheidet, wo hinein.
   - Verworfen (b): ein org-weiter Vorschlag ohne Einsatz, bei dem ein Mensch den Einsatz bei
     der Übernahme wählt. Der Grund: ein Ort mehr, an dem man nachsehen muss, und ein
     Meldungseingang ohne Einsatz, den es heute nicht gibt.
   - Ausgeschlossen: die `einsatz_id` aus der Anfrage, das verbietet ADR-0035.
2. **Ablage.**
   - Gewählt (a): eine **eigene Tabelle `meldung_vorschlag`**. Eine Meldung braucht eine
     erfassende Person (`meldung.erfasst_von_id NOT NULL`), Ereigniszeit und Meldeweg, und sie
     hängt an ETB und Auto-Frist. Ein Vorschlag hat nichts davon, solange kein Mensch ihn
     angesehen hat.
   - Verworfen (b): eine Meldung mit neuem Status `vorschlag`. Der Grund: Jeder Leser von
     `meldung` (Zähler, Lage, Druck, Spiegel, Geräte) müsste den Status ausfiltern, und ein
     vergessener Filter bricht G1.
3. **ETB.**
   - Gewählt (a): Die Übernahme legt die Meldung auf dem **normalen Weg** an, mit derselben
     Auto-ETB-Regel (`effektiv_auto_etb_aktiv`) wie eine von Hand erfasste. Vorher steht nie
     etwas im ETB.
   - Verworfen (b): ein erzwungener ETB-Eintrag bei der Übernahme. Der Grund: Eine übernommene
     Meldung würde sich anders verhalten als jede andere.
4. **Meldeweg.**
   - Gewählt (a): Der Mensch wählt ihn im Formular, vorbelegt ist `funk`. Kein neuer Wert; die
     Herkunft trägt die Meldung ohnehin.
   - Verworfen (b): ein neuer Wert `digital`/`mesh`. Der Grund: Er berührt das ETB-Enum, den
     Druck und das Frontend für eine Auskunft, die die Herkunft schon gibt.
5. **Fristen.**
   - Gewählt (a): **wie E5.** Ein offener Vorschlag läuft nach 12 h ab, ebenso, sobald der
     Einsatz nicht mehr aktiv ist. Verworfene, abgelaufene und übernommene Vorschläge werden
     nach 7 Tagen gelöscht. Bei der Übernahme wird der Text sofort geleert, denn die Meldung
     trägt ihn.
   - Verworfen (b): keine Ablauffrist. Der Grund: Ein Kurztext von vor einem halben Tag
     verstopft den Eingang und ist fachlich überholt.
6. **Schnittstelle.** Scope `meldungen:write`, Route `POST /api/v1/report-suggestions` mit 201
   für einen neuen und 200 für einen doppelten Vorschlag. Innen Routen unter
   `/api/incidents/{id}/report-suggestions`. Neues Glossarwort `report-suggestions` =
   Meldungsvorschläge, nach dem Muster von `keyword-suggestions`.
7. **Zähler.**
   - Gewählt (a): Offene Vorschläge zählen im Modulzähler „Meldungen“ mit. Live-Update über das
     vorhandene Ereignis `meldung`.
   - Verworfen (b): nur auf der Seite. Der Grund: Ein unverifizierter Notruf darf nicht
     übersehen werden, weil niemand die Seite offen hat.

## Entwurf

### Entscheidung: neue ADR ersetzt ADR-0035

ADR-0035 spricht nur von **Lese**-Scopes mit Einsatzbezug, und akzeptierte ADRs ändern sich nicht
(`docs/architektur/AGENTS.md`). Eine **neue ADR** (nächste freie Nummer, Stand 28.11.: ADR-0112)
mit `ersetzt: ADR-0035` übernimmt alle Regeln von ADR-0035, verallgemeinert auf „Scope mit
Einsatzbezug, lesend oder schreibend“, und ergänzt:

- MUST: Eine Schreibroute unter `/api/v1/` mit Einsatzbezug bestimmt ihren Einsatz allein über
  `public_api::freigabe`; ohne wirksame Freigabe lehnt sie ab und legt nichts an.
- MUST: Ein Maschinenzugang legt keine Meldung und keinen ETB-Eintrag an. Was er an Text liefert,
  ist ein Vorschlag; erst ein Mensch macht daraus eine Meldung (G1).
- MUST: Die Freigabe endet mit dem Entzug seines letzten Scopes mit Einsatzbezug (statt „Lese-
  Scopes“).

ADR-0035 bekommt `status: ersetzt` und `ersetzt_durch`. Die Prüfung der neuen ADR übernimmt die
alte und ergänzt etwa `verlange 'Scope::MeldungenWrite' src/public_api/scope.rs` (im Block von
`has_einsatzbezug`). Titel als Vorschlag: „Ein Maschinenzugang liest und schreibt einsatzbezogen
nur im Einsatz, den die Einsatzleitung für ihn freigegeben hat“.

### Scope und Freigabe

- `Scope::MeldungenWrite => "meldungen:write"` am Ende der Liste in `src/public_api/scope.rs`.
- `has_einsatzbezug` umfasst `MeldungenWrite`. Damit erscheint ein solcher Zugang im Paneel
  „Anbindungen“ der Seite „Geräte“ (`EinsatzAnbindungen.tsx`, `src/routes/einsatz_anbindungen.rs`),
  und die Einsatzleitung kann ihn freigeben. Kommentar und Test
  `lage_und_einsaetze_lesen_haben_einsatzbezug` ziehen mit.
- Frontend: Eintrag in `SCOPE_TEXT` (`frontend/src/api/anbindungen.ts`), etwa „Meldungen
  einreichen (als unverifizierte Vorschläge)“.
- `src/public_api/description.md`: neuer Abschnitt zum Scope und zur Route, und der Absatz
  „Einsatzbezug“ nennt den Schreib-Scope.

### Öffentliche Route `POST /api/v1/report-suggestions`

Anfrage (neuer Typ, englische Wire-Felder):

```json
{
  "text": "Abschnitt Nord: 2 Verletzte, brauchen RTW",
  "external_id": "mesh-!a1b2c3d4-3735928559",
  "sent_at": "2026-11-28T09:41:12Z",
  "source": {
    "adapter": "meshtastic",
    "sender_id": "!a1b2c3d4",
    "sender_name": "Nord-1",
    "signed": false
  }
}
```

- `text` Pflicht, getrimmt nicht leer, höchstens `crate::etb::INHALT_MAX` Zeichen (dieselbe
  Grenze wie der Inhalt einer Meldung, damit die Übernahme nie an der Länge scheitert).
- `external_id` Pflicht, höchstens 128 Zeichen: die Kennung der Nachricht an der Quelle
  (Paket-ID, Message-ID). Eindeutig je Zugang.
- `sent_at` optional, Zeit der Quelle.
- `source.adapter` Pflicht, kurzes Kennwort (`[a-z0-9_-]`, höchstens 32). `source.sender_id`
  Pflicht, höchstens 64. `source.sender_name` optional, höchstens `crate::etb::PARTEI_MAX`.
  `source.signed` Pflicht: ob die **Quelle** die Nachricht signiert hat (etwa XEdDSA im Mesh).
  Die Anfrage an den Server ist immer signiert; das meint dieses Feld nicht.
- Antwort: `201` mit `{ "id", "status": "offen", "received_at" }` für einen neuen Vorschlag;
  `200` mit demselben Körper des bestehenden für eine wiederholte `external_id` desselben
  Zugangs. Das gilt auch, wenn der bestehende schon übernommen, verworfen oder abgelaufen ist; der
  Status zeigt es. Der Inhalt der Wiederholung wird nicht verglichen.
- Ablehnungen mit stabilem `code` (ADR-0096):
  - `422` für ungültige Felder;
  - `409 incident_not_released`, wenn keine wirksame Freigabe besteht;
  - `409 incident_mirrored`, wenn der freigegebene Einsatz an dieser Instanz ein Spiegel ist
    (meine Wahl, s. u.);
  - `429` über die vorhandene Drossel.
- Ablauf in einer Transaktion (`write_retry!` wie üblich): Freigabe lesen
  (`freigabe::freigegebener_einsatz_tx`), Dopplung prüfen, einfügen. Nach dem Commit ein
  Live-Ereignis an den Einsatz (s. „Live“).
- Die Route steht nur in `public_api::router()` mit
  `ScopeAnforderung::Scope(Scope::MeldungenWrite)`; `docs/api/public-v1.json` neu erzeugen,
  `cargo test --test public_api_spec_aktuell`.

### Tabelle `meldung_vorschlag`

Eine Migration, Spalten sinngemäß:

| Spalte | Bedeutung |
| --- | --- |
| `id` | `INTEGER PRIMARY KEY` wie `meldung` |
| `einsatz_id` | `NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE` |
| `zugang_id` | der Maschinenzugang (`REFERENCES maschinenzugang(id) ON DELETE SET NULL`; Name der Tabelle wie im Bestand) |
| `external_id` | `NOT NULL`, `UNIQUE (zugang_id, external_id)` |
| `text` | `NULL` nach der Übernahme geleert |
| `adapter`, `absender_kennung`, `absender_name`, `signiert` | Herkunft |
| `gesendet_at` | Zeit der Quelle, optional |
| `empfangen_at` | Zeit des Servers |
| `status` | `offen` \| `angenommen` \| `verworfen`, mit `CHECK`; „abgelaufen“ ist kein gespeicherter Zustand, s. u. |
| `erledigt_at`, `erledigt_von_id` | wer übernommen oder verworfen hat |
| `meldung_id` | `REFERENCES meldung(id) ON DELETE SET NULL`, bei `angenommen` |

- Index auf `(einsatz_id, status, empfangen_at)`.
- Die Tabelle gilt an der Instanz, an der der Zugang angelegt ist, wie die Freigabe. Sie kommt
  in `instanz::spiegel::art::AUSGENOMMEN`; die übernommene Meldung wird wie jede Meldung
  gespiegelt.
- **Abgelaufen** wird beim Lesen bestimmt: Ein offener Vorschlag mit `empfangen_at` älter als
  12 h, oder an einem Einsatz, der nicht aktiv ist, gilt als abgelaufen. Er erscheint nicht in
  der Liste, zählt nicht und lässt sich nicht mehr übernehmen. So braucht es keinen Planer, der
  Zustände umschreibt. Die Dopplungsantwort meldet dann `status: "abgelaufen"`.
- **Löschen:** im vorhandenen Aufräumlauf (`src/einsatz/purge_scheduler.rs`, wie
  `einwurf::purge`): Vorschläge, deren `erledigt_at`, oder bei offenen deren `empfangen_at`,
  älter als 7 Tage ist. Der Einsatz löscht sie per `CASCADE` mit.

### Herkunft an der Meldung

Die übernommene Meldung muss ihre Herkunft auch nach dem Löschen des Vorschlags tragen. Dazu
bekommt `meldung` nullbare Spalten `herkunft_adapter`, `herkunft_kennung`, `herkunft_name` und
`herkunft_signiert`; gesetzt nur bei einer Übernahme. Sie reisen mit der Meldung zum Spiegel,
also müssen die Spiegelwege der Meldung sie mitnehmen.

`MeldungAnzeige` bekommt ein optionales Feld in der Sprache des Typs:
`maschinen_herkunft: { adapter, kennung, name?, signiert }`, nur gesetzt, wenn die Meldung aus
einem Vorschlag kam. Danach `scripts/check-typ-codegen.sh`, beide generierten Dateien
mitcommitten.

Die Herkunft ändert sich nie (wie Wortlaut und Absender; ein PATCH darauf ist nicht vorgesehen).

### Interne Routen (Frontend)

- `GET /api/incidents/{id}/report-suggestions`: die offenen, nicht abgelaufenen Vorschläge,
  älteste zuerst. Recht: Lesezugriff auf das Modul Meldungen. Gekoppelte Geräte bekommen 403,
  denn sie sehen nur eigene Meldungen. Antwort neuer Typ mit englischen Feldern:
  `{ id, text, source { adapter, sender_id, sender_name?, signed }, sent_at?, received_at }`.
- `POST /api/incidents/{id}/report-suggestions/{vid}/accept`: Körper ist derselbe wie beim
  Erfassen einer Meldung (`NeueMeldung`). Der Server legt die Meldung über denselben Code an wie
  `POST /api/incidents/{id}/reports` (Erfassungsrecht, aktiv, Prüfungen, Auto-ETB,
  Auto-Frist-Erinnerung, Live). Dafür wird der Rumpf von `routes::meldung::anlegen` in eine
  gemeinsame Funktion gezogen, kein Kopieren. In derselben Transaktion setzt der Server den
  Vorschlag auf `angenommen` (nur aus `offen`, nicht abgelaufen), leert den Text, setzt
  `meldung_id`, `erledigt_*` und die Herkunftsspalten der Meldung. Antwort wie das Erfassen:
  `201` mit `MeldungAnzeige`.
  - Ist der Vorschlag nicht mehr offen oder abgelaufen, antwortet der Server mit `409`.
  - `client_id` wirkt wie beim Erfassen. Eine Wiederholung mit derselben `client_id` liefert
    die schon angelegte Meldung, auch wenn der Vorschlag inzwischen `angenommen` ist.
  - Kein Gerät (403), wie beim Lesen.
- `POST /api/incidents/{id}/report-suggestions/{vid}/discard`: Recht wie das Erfassen einer
  Meldung, aktiver Einsatz, kein Gerät. Setzt `verworfen` und `erledigt_*`; aus einem anderen
  Zustand als `offen` antwortet der Server mit `409`. Kein Körper, Antwort `204`.
- Am Spiegel lehnen Übernehmen und Verwerfen ab wie jedes Schreiben dort (409). Durch
  `incident_mirrored` entsteht dort ohnehin kein Vorschlag.

Wer verworfen hat, steht nur in der Tabelle. Einen ETB- oder Audit-Eintrag fürs Verwerfen gibt
es nicht, denn es ist kein Vorgang im Einsatz (meine Wahl).

### Live und Zähler

- Nach Anlegen, Übernehmen und Verwerfen eines Vorschlags geht das Live-Ereignis `meldung` an
  den Einsatz, ohne ETB-Bezug. Das Frontend invalidiert dabei zusätzlich den neuen Key
  `einsatzKeys.meldungVorschlaege(id)` (`frontend/src/api/queryKeys.ts`, neben
  `einsatzKeys.meldungen`). Wenn das Ereignis `meldung` heute eine Meldungs-ID braucht, wählt der
  Builder den kleinsten Weg (eigenes Ereignis `meldung_vorschlag` oder dasselbe Ereignis ohne
  ID). Ein Ereignis nur zum Nachladen von Listen gibt es im Bestand.
- `MeldungsZaehler` bekommt `vorschlaege_offen` (offen, nicht abgelaufen). Der Navigationszähler
  des Moduls zählt sie zur offenen Zahl dazu. Die übrigen Felder (`ungesehen`, `sofort_offen`
  …) bleiben, wie sie sind, denn ein Vorschlag hat weder Art noch Priorität. Geräte bekommen den
  Meldungszähler ohnehin nicht. `tests/modul_zaehler.rs` hält Liste und Zähler gleich und bekommt
  einen Fall dazu.

### Oberfläche

Im Meldungseingang (`pages/MeldungenPage.tsx`, schmal `MeldungenSchmal.tsx`) steht über der
Liste ein Bereich, nur wenn es offene Vorschläge gibt:

```
┌ Vorschläge · unverifiziert (2) ───────────────────────────────┐
│ 09:41  Mesh · Knoten „Nord-1“ (!a1b2c3d4) · nicht signiert    │
│ Abschnitt Nord: 2 Verletzte, brauchen RTW                     │
│                         [Verwerfen]  [Als Meldung übernehmen] │
├───────────────────────────────────────────────────────────────┤
│ 09:44  Mesh · Knoten !77ee01ff · signiert                     │
│ Wasserstand Brücke steigt                                     │
│                         [Verwerfen]  [Als Meldung übernehmen] │
└───────────────────────────────────────────────────────────────┘
```

- Der Adapter erscheint mit einem lesbaren Namen, wo einer bekannt ist (`meshtastic` → „Mesh“),
  sonst als Kennwort.
- „Als Meldung übernehmen“ öffnet `MeldungFormular` vorbelegt:
  - Inhalt = Text,
  - Absender = Name, sonst Kennung,
  - Meldeweg = `funk`,
  - Ereigniszeit = `sent_at`, sonst `received_at`,
  - Art `sonstige`.

  Oben im Formular steht ein Hinweis „Unverifiziert · Herkunft …“. Speichern ruft `accept`.
  Abbrechen lässt den Vorschlag offen.
- „Verwerfen“ ruft `discard`; ob mit Rückfrage, entscheidet der Builder nach der
  Bedien-Leitlinie (`frontend/AGENTS.md`).
- `MeldungKarte` und die Detailansicht zeigen bei `maschinen_herkunft` ein Merkmal
  „unverifiziert übernommen · Mesh · Nord-1 · nicht signiert“ in derselben Form wie die heutige
  Geräte-Herkunft (`is_von_geraet`).
- Druck der Meldung: die Herkunft als eine Zeile, falls der Meldungsdruck Herkunftsangaben schon
  zeigt; sonst nicht.

### Dokumentation

- Neue ADR (oben); ADR-0035 auf `ersetzt`.
- `src/AGENTS.md`, Abschnitt „Öffentliche API v1“: zwei Sätze zum Maschinen-Eingang mit Verweis
  auf die neue ADR.
- `src/public_api/description.md` und `docs/api/public-v1.json`.
- Anwenderdoku: das Kapitel zum Meldungseingang bekommt einen Absatz „Vorschläge aus dem
  Maschinen-Eingang“, das Kapitel zu Anbindungen den Scope (Regeln: `docs/anwender/AGENTS.md`).
- Architekturdoku nach der Mitänderungsregel in `docs/architektur/AGENTS.md`.

## Meine Wahl (bitte beim Lesen prüfen)

- **Spiegel:** Am Spiegel entsteht kein Vorschlag (`409 incident_mirrored`), denn dort ließe er
  sich ohnehin nicht übernehmen. Die Brücke spricht nach der Machbarkeitsnotiz immer mit dem
  Server, der den Einsatz führt (im ELW der ELW).
- **`external_id` Pflicht** statt einer Dopplungserkennung über Text und Zeitfenster wie bei
  Alarmmeldungen. Mesh und Postfach haben eine Nachrichtenkennung, und der Vergleich bleibt damit
  eindeutig.
- **Abgelaufen beim Lesen bestimmt**, kein Zustandswechsel durch einen Planer.
- **Herkunft als Spalten an `meldung`**, weil der Vorschlag nach 7 Tagen gelöscht wird.
- **Verwerfen ohne ETB- und Audit-Eintrag.**
- **Übernehmen als eigene Route mit dem Körper von `NeueMeldung`** statt eines neuen Felds an
  `POST …/reports`. Das hält den Erfassungsweg unberührt und das Recht an einer Stelle.

## Dem Builder überlassen

- Namen der Rust-Typen und -Module (Vorschlag: `src/meldung/vorschlag.rs` für Repo und
  Fachlogik, `src/public_api/meldung_vorschlag.rs` für die v1-Route,
  `src/routes/meldung_vorschlag.rs` für die internen Routen).
- Ob das Live-Ereignis `meldung` reicht oder ein eigenes nötig ist (s. „Live und Zähler“).
- Rückfrage beim Verwerfen, Lage des Bereichs in der schmalen Ansicht.
- Eine Tagesgrenze je Zugang wie bei Alarmmeldungen (5 000), falls die Drossel nicht reicht.
- Die Bilder der Änderung mit einem Vorschlag in den Demo-Daten oder per Wegwerf-Spec.
