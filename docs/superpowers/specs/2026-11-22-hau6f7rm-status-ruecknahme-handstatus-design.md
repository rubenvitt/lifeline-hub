# Rücknahme für Personal-, Material- und Einheitsstatus — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/hau6f7rmdpk8gru05bxv8to9 (LLH-1986)
Stand: 22.11.2026, Lösungsweg am Phase-1-Checkpoint abgestimmt.

## Absicht

Seit LLH-1781 quittiert ein Fahrzeug jeden FMS-Wechsel mit „85-1: S2 → S3 · Rückgängig“, und der
Server nimmt den Wechsel echt zurück. Personal-, Material- und Einheitsstatus wechseln weiter ohne
Quittung und ohne Rückweg. Wer im Stab oder am Einheitengerät daneben tippt, kann das nur durch
einen zweiten Wechsel „reparieren“, der „Status seit“, Zeitachse und ETB verfälscht. Dieser Task
bringt dieselbe Quittung und denselben Rückweg für die drei übrigen Statusarten.

## Ziele

- Nach jedem Statuswechsel durch eine Person bei Personal, Material und Einheit (Handstatus)
  erscheint die Quittung „<Name>: <alt> → <neu> · Rückgängig“, gleich an welcher Stelle der Wechsel
  geschah, auch auf der Geräte-Statusseite.
- Die Rücknahme stellt im Server den Zustand vor dem Wechsel her und gelingt nur der wechselnden
  Person, binnen zehn Minuten, solange niemand weiter gewechselt hat; sonst 409.
- Die Prüfung (Riegel) und das Streichen des Zeitachsen-Ereignisses gibt es einmal, für alle vier
  Statusarten; das Fahrzeug nutzt sie auch.

## Nicht-Ziele

- Keine Statushistorie, kein mehrstufiges Rückgängig: zurückgenommen wird nur der letzte Wechsel.
- Kein Rückgängig für Wechsel ohne Person: Schichtplan-Vollzug (hat eigene Rücknahme, LLH-1555),
  Entlassen und Reaktivieren, abgeleiteter Einheitsstatus aus Fahrzeugen.
- Keine Änderung am Rückweg des Fahrzeugs von außen gesehen: Route, Beleg und Antwort bleiben.
- Keine neue Benachrichtigung; eine gesendete „wieder verfügbar“ bleibt bestehen.

## Anti-Ziele

- Der Server glaubt dem Client keinen Vorzustand (D8 von LLH-1781): der Beleg trägt nur Prüfwerte.
- Eine Rücknahme darf nie ein fremdes oder späteres Ereignis streichen oder einen Zustand
  herstellen, den es so nie gab.

## Ansätze

1. **Spalten je Tabelle + gemeinsame Prüfung (gewählt).** `einsatz_personal`, `einsatz_material`
   und `einsatz_einheit` bekommen Spalten wie `einsatz_fahrzeug` (Migration 0356). Riegel und
   Streichen liegen in einem gemeinsamen Rust-Baustein, im Frontend ein Hook für alle Arten. Passt
   zu D8 (keine Verlaufstabelle), hält den Spiegel unberührt (nur ADD COLUMN) und teilt die Logik,
   die heikel ist.
2. **Eine Tabelle `status_wechsel` für alle vier.** Am einheitlichsten, aber genau der Weg, den D8
   verworfen hat: mehr als die Rücknahme braucht, muss in den Spiegel, und das Fahrzeug müsste
   umziehen.
3. **Je Modul kopieren.** Kleinstes Risiko für das Fahrzeug, aber der Riegel stünde viermal und
   liefe auseinander.

Gewählt am 22.11.2026: Ansatz 1, Fahrzeug wird auf den gemeinsamen Baustein umgestellt (Verhalten
gleich, seine Tests bleiben).

## Entscheidungen

### E1 — Was der Server je Tabelle festhält

Migration `0363_status_ruecknahme_hand.sql` (Nummer beim Bauen gegen `alpha` prüfen,
`migrations/AGENTS.md`), nur `ADD COLUMN`, NULL für alte Zeilen:

| Tabelle | Spalten |
|---|---|
| `einsatz_personal` | `status_gesetzt_von` (FK benutzer), `status_gesetzt_at` TEXT, `status_vorher_id` (FK personal_status), `status_ereignis_id` (FK einsatz_kraft_zeitachse, ON DELETE SET NULL) |
| `einsatz_material` | `status_gesetzt_von`, `status_gesetzt_at`, `status_vorher` TEXT (Werte wie `status`, NULL erlaubt) |
| `einsatz_einheit` | `status_gesetzt_von`, `status_gesetzt_at`, `status_vorher_id` (FK fahrzeug_status), `status_vorher_seit` TEXT, `status_ereignis_id` |

`status_gesetzt_at` ist die Kennung des Wechsels (Prüfwert der Rücknahme) und Beginn der Frist.
Personal und Material haben kein „Status seit“; die Einheit hat es, aber nach dem Löschen des
Handstatus ist `status_seit` NULL und taugt nicht als Kennung. Deshalb überall eine eigene Spalte;
das Fahrzeug behält `status_seit` als Kennung.

Gesetzt werden die Spalten bei jedem echten Wechsel in der Schreibfunktion des Status
(`personal::disposition_repo::update_tx`, `material::disposition_repo::update_tx`,
`einheit::repo::setze_hand_status_tx`). Keine der drei kennt heute Person oder Zeitpunkt: ihre
Patch-Strukturen bzw. Parameter bekommen `gesetzt_von: Option<i64>` und `jetzt` (wie
`FahrzeugPatch.gesetzt_von`), die Aufrufer ziehen mit (Routen, `abloesung/schichtplan/vollzug.rs`,
`demo/import.rs`). `gesetzt_von` kommt aus dem Aufruf (`None` bei Wegen ohne Person, etwa dem
Schichtplan-Vollzug → keine Rücknahme möglich), `gesetzt_at` = `jetzt`, Vorzustand aus der Zeile
vor dem UPDATE, `ereignis_id` NULL. Das Zeitachsen-Ereignis trägt die Route danach in derselben
Transaktion nach (wie `merke_status_ereignis_tx`); die Personal-Route nimmt dafür
`aus_personalstatus_id_tx` statt `aus_personalstatus_tx`. Der Handstatus der Einheit setzt
`status_seit` künftig auf `jetzt` des Aufrufs statt `datetime('now')`, damit Seit und Kennung
übereinstimmen.

**Wer die Spalten leert** (sonst bliebe eine Rücknahme stehen, die einen nie dagewesenen Zustand
herstellt): Entlassen (Personal, Material), Auflösen (Einheit), der rohe Status-UPDATE des
Schichtplan-Vollzugs (`vollzug.rs`, „leerer Stand“) und beim Material jede Änderung von Menge oder
Art sowie das Aufteilen einer Zeile (die abgeteilte Zeile bekommt keine Spalten, die verbleibende
verliert sie). Als Rückhalt prüft die Material-Rücknahme die herzustellende Zeile mit
`material::check_zeile`; scheitert das, 409 mit Grund. *(Eigene Entscheidung beim Entwurf, folgt
aus dem Anti-Ziel.)*

Schwärzung: Einträge in `einsatz/schwaerzung_registry.rs` mit denselben Gattungen wie beim
Fahrzeug (`G_FK`, `G_ZEIT`; `status_vorher` des Materials wie `status`).

### E2 — Gemeinsamer Baustein im Backend

Neues Modul `src/status_ruecknahme.rs` (Name nach der Bezeichner-Regel: Fachbegriff deutsch):

- `GRUND_STATUS_RUECKNAHME` und der Konflikttext ziehen aus `fahrzeug/disposition_repo.rs` hierher.
- `pruefe(gemerkt, beleg, benutzer_id, jetzt)`: Prüfwerte ungleich der Zeile (Status oder
  Kennung) → `AppError::Veraltet` (409 `veraltet`, CAS nach `src/AGENTS.md`); andere Person oder
  Frist (`entlassung::RUECKNAHME_FRIST_MINUTEN`, `is_in_ruecknahme_frist` ab Kennung) überschritten
  → `AppError::Conflict` mit dem bisherigen Text. Generisch über den Statustyp (`Option<i64>` für
  Kataloge, Materialstatus).
- `streiche_ereignis_tx(conn, einsatz_id, benutzer_id, kraft, ereignis_id)`: die heutige Logik aus
  `status_zuruecknehmen_tx` (nur ein offenes Ereignis genau dieser Kraft wird gestrichen;
  bräche das die Ordnung, `Conflict`, und der Aufrufer rollt zurück); liefert `Beruehrt`.
- `status_zuruecknehmen_tx` des Fahrzeugs nutzt beides. Verhalten unverändert.

### E3 — Beleg, Antworten und Routen

Wire-Formen sind additiv; das Fahrzeug bleibt, wie es ist.

- **Beleg** `HandStatusRuecknahmeBeleg { vorher_status_id?: i64|null, status_id: i64|null,
  gesetzt_at: String }` für Personal und Einheit; `MaterialStatusRuecknahmeBeleg { vorher_status?:
  MaterialStatus|null, status: MaterialStatus, gesetzt_at: String }`. `vorher_*` dient nur dem
  Wortlaut der Quittung.
- **Antworten:** `PATCH …/personal/{ep_id}` liefert `PersonalPatchAntwort` (Anzeige `flatten` +
  `status_ruecknahme?`), `PATCH …/material/{em_id}` `MaterialPatchAntwort`, `PUT
  …/einheiten/{eid}/status` `EinheitStatusAntwort` — je nur bei einem echten Statuswechsel mit
  Beleg. Typ-Codegen mitziehen (`scripts/check-typ-codegen.sh`).
- **Routen** (Body = Beleg, Antwort = Anzeige wie beim Fahrzeug):
  - `POST /api/einsaetze/{id}/personal/{ep_id}/status/zuruecknehmen` — `EinsatzSchreibzugriff<Personal>`
  - `POST /api/einsaetze/{id}/material/{em_id}/status/zuruecknehmen` — `EinsatzSchreibzugriff<Material>`
  - `POST /api/einsaetze/{id}/einheiten/{eid}/status/zuruecknehmen` — `EinsatzSchreibzugriff<Einheiten>`;
    auch in der Routenliste `EINHEIT` des Einheitengeräts (`src/geraet/mod.rs`), der Handler schneidet
    wie `status_setzen` über `abschnitt::bereich` zu (fremde Einheit 404). Der Test
    `einheitengeraet_meldet_status_und_quittiert_aber_fuehrt_nicht` prüft die Liste genau und
    nimmt die Route auf.
- **Ablauf je Route, eine Transaktion:** Kraft aktiv (sonst wie heute), Zeile lesen, `pruefe`,
  Ereignis streichen (Personal `Kraft::Person`, Einheit `Kraft::Einheit`, Material hat keins),
  Status (und bei der Einheit „seit“) aus den gemerkten Spalten herstellen mit CAS auf Status und
  Kennung im `WHERE`, die Rücknahme-Spalten leeren, ETB-Eintrag, nach dem Commit Live-Meldungen wie
  beim Wechsel (Personal: `sse_personal`; Material: `sse_material` + Leser des Orts wie
  `notify_orte`; Einheit: `sse_einheit`, Personen aus `Beruehrt`, `publish_kopplung`).
- **ETB-Texte:** „Person «X»: Statuswechsel «A» → «B» zurückgenommen“, „Material «X»: …“,
  „Einheit «X»: …“, gebaut wie `etb_text_statuswechsel_zurueckgenommen` (fehlender Wert „—“).
- **Einheit, Sonderfälle:**
  - Löschen des Handstatus ist ein Wechsel wie jeder andere: Beleg mit `status_id: null`,
    Rücknahme stellt Status und „seit“ von davor her.
  - Hat die Einheit inzwischen aktive Fahrzeuge, führen diese ihren Status; eine Rücknahme, die
    einen Handstatus herstellen müsste, antwortet 409 mit Grund. Eine, die „kein Status“
    herstellt, gelingt.
  - Das Einheitengerät darf den Handstatus nicht löschen. Nimmt es aber seinen eigenen Wechsel
    zurück und war davor „kein Status“, stellt die Rücknahme „kein Status“ her: sie macht den
    Fehlgriff ungeschehen, sie entscheidet nichts Neues. *(Eigene Entscheidung beim Entwurf.)*

### E4 — Frontend

- `kommunikation/rueckgaengig.tsx`: `zeigeStatusQuittung(api, { schluessel, name, vorher, neu },
  aufRueckgaengig)`; der Schlüssel ist nach Art getrennt (`lfh-status-quittung-fahrzeug-<id>`,
  `…-personal-<id>`, `…-material-<id>`, `…-einheit-<id>`), damit gleiche IDs verschiedener Arten
  sich nicht überschreiben. Form wie heute: 6 s, Knopf „Rückgängig“, antd-`message`, nimmt keinen
  Fokus.
- `kraefte/useStatusQuittung.ts` (ersetzt `useFahrzeugStatusQuittung.ts`): ein Hook, der aus
  Beleg, Name und Kurzform des Status die Quittung zeigt, die Rücknahme ruft, bei 409 `veraltet`
  „<Name>: Nicht mehr zurückzunehmen, inzwischen geändert.“ und sonst den Servertext meldet und
  danach die betroffenen Abfragen auffrischt (je Art: das eigene Modul, `etb`, bei Einheit auch
  `personal`, bei Fahrzeug wie heute). Je Art eine kleine Anpassung für Name und Kurzform:
  - Fahrzeug: Rufname, `S<fms_anker>` (wie heute)
  - Personal: Name, Label des Personalstatus („Anna Muster: verfügbar → im Einsatz“)
  - Material: Bezeichnung, deutsches Label des Materialstatus („Trage: einsatzbereit → defekt“)
  - Einheit: Funkrufname, sonst Name; `S<fms_anker>` bzw. Label; gelöscht „—“
- **Aufrufer** (alle Stellen, die den Status setzen): `PersonalPage`, `EinsatzkraftPage`,
  `MaterialPage`, `MaterialAmOrt` (damit Fahrzeuge, UHS, Bereitstellungsraum, Einheit),
  `KraefteuebersichtPage`, `EinheitDetailPage`/`EinheitKopf` (ersetzt dort „Status gespeichert“),
  `GeraetStatusPage`, dazu wie bisher `FahrzeugePage` und `FahrzeugeBesatzung`. Optimistische
  Zeilen und jeder, der die PATCH-Antwort direkt in den Cache schreibt (auch
  `useEinteilungSchreiben.ts`), nehmen `status_ruecknahme` vorher ab (wie `FahrzeugePage`).
- API-Funktionen geben die neuen Antworttypen zurück; je Art eine Funktion für die Rücknahme.

### E5 — Regeln (E2 des Routings)

- `frontend/AGENTS.md`, „Statusmenü und Quittung bei Fahrzeugen“: Satz „Personal-, Material- und
  Einheitsstatus haben noch keinen Rückweg“ ersetzen; der Quittungsteil verweist auf die Regel in
  `frontend/src/kraefte/AGENTS.md`.
- `frontend/src/kraefte/AGENTS.md` (Client und Server) bekommt die Regel „Quittung und Rücknahme
  eines Statuswechsels“: alle vier Arten, Server hält den Vorzustand, Riegel und Streichen nur über
  `src/status_ruecknahme.rs`, Hook `useStatusQuittung`, Wege ohne Person setzen kein
  `gesetzt_von`. Die Spec `fahrzeugstatus-quittung` bleibt eingefroren; die neue Regel nennt sie
  als Herkunft.
- Anwenderdoku: das Kapitel, das den Statuswechsel von Personal, Material und Einheit beschreibt,
  um „Rückgängig“ ergänzen (Mitänderungsregel `docs/anwender/AGENTS.md`).

## Prüfbar (Akzeptanz)

- Je Art: Wechsel und Rückgängig ergeben genau den Zustand davor (Status; Einheit auch „seit“),
  das Zeitachsen-Ereignis des Wechsels ist gestrichen (Personal, Einheit), das ETB nennt die
  Rücknahme.
- Andere Person → 409; nach elf Minuten → 409; inzwischen weiter gewechselt → 409 `veraltet`, der
  neue Status bleibt; erfundener Beleg stellt trotzdem nur den gemerkten Vorzustand her.
- Wechsel aus dem Schichtplan-Vollzug ist nicht zurückzunehmen (kein `gesetzt_von`).
- Material: nach Aufteilen, Mengen- oder Artänderung ist der vorige Statuswechsel nicht mehr
  zurückzunehmen (409).
- Einheit: Löschen und Rückgängig stellt den alten Handstatus mit altem „seit“ her; inzwischen
  Fahrzeug zugeordnet → Rücknahme zu einem Handstatus 409.
- Einheitengerät: Quittung erscheint, Rücknahme der eigenen Einheit gelingt, fremde Einheit 404.
- Fahrzeug: bestehende Tests unverändert grün.
- Frontend: Quittung an jeder Aufrufstelle oben; Text und Schlüssel je Art.

## Dem Bauenden überlassen

- Ob die Antwort-Hüllen generisch (`PatchAntwort<T, B>`) oder je Art geschrieben werden, solange
  der erzeugte Typ sauber ist.
- Schnitt der Rust-Tests (je Modul neben dem Repo, wie beim Fahrzeug) und ob eine bestehende e2e
  (`frontend/e2e/statusmenue.spec.ts`) um einen Fall Personal oder Einheit wächst.
- Die genaue Kurzform des Personalstatus, falls der Katalog ein Kürzel kennt.
