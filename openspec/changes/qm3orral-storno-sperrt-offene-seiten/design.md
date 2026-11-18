# Design

## Context

LLH-1832 (Parent LLH-1813, Thema 13 der UI/UX-Analyse). Mit Ruben am 18.11.2026 abgestimmt.

Ausgangslage im Code:

- **Live-Verteilung.** `LiveEvent` (`src/live/mod.rs`) trägt nur die Kennung des Objekts
  (`publiziere_objekt`), keine Fachangaben. Das Frontend gleicht über `EINSATZ_STREAM_ZIELE`
  (gezielt, mit Kennung) bzw. `EINSATZ_STREAM_EVENTS` (Präfixe) ab
  (`frontend/src/api/queryKeys.ts`).
- **Person.** Das Detail (`GET …/personen/{pid}`, `detail_mit_audit`) schreibt je Abruf eine
  Zeile ins Zugriffsprotokoll. Es steht deshalb bewusst in `NICHT_LIVE_KEYS`. Trotzdem lädt es
  beim Fokuswechsel neu (globaler `staleTime` 10 s) und schreibt dabei Protokollzeilen, ohne dass
  jemand etwas tut. Die protokollfreie Route `…/zeile` (LLH-1682) beantwortet eine stornierte
  Person mit 404 `nicht_in_liste`. Am Gerät bedeutet derselbe 404 aber auch „fremde Stelle“, und
  er sagt nicht, wer storniert hat.
- **Tier, Schaden.** Ihr Detail-GET schreibt kein Protokoll. Die Keys `einsatz-tier` und
  `einsatz-schaden` stehen nur deshalb in `NICHT_LIVE_KEYS`, weil die Listenpräfixe
  (`einsatz-tiere`, `einsatz-schaeden`) sie nicht treffen.
- **Nachweis.** `storno::storniere` schreibt bei Person und Tier `Vermerk::Geaendert`, also nur
  `geaendert_von`. Beim Schaden schreibt es `GeaendertUndStorniert` mit `storniert_von`. Kein DTO
  trägt bisher einen Namen.
- **Betreuungsstelle.** Die Seite liest die Stelle aus `GET …/betreuung` (live über `betreuung`).
  Die Übersicht lässt stornierte Stellen weg, also wechselt die Seite auf
  `StelleNichtGefunden`. Die Tabelle hat `storniert_von_id`.
- **Darstellung storniert.** Alle drei Detailseiten blenden heute schon Aktionen aus, wenn
  `storniert_at` gesetzt ist, und zeigen ein Tag. Nach einem Neuladen stimmt die Seite also
  bereits; es fehlen nur der Anstoß und das Banner.

## Goals / Non-Goals

**Goals**
- Eine offene Detailseite von Person, Tier, Schaden und Betreuungsstelle sperrt sich ohne Zutun,
  sobald der Datensatz storniert ist, und zeigt Wer und Wann.
- Kein zusätzlicher Eintrag im Zugriffsprotokoll, weder durch Live-Abgleich noch durch
  Fokuswechsel.

**Non-Goals**
- Hartes Löschen. Keiner der vier Datensätze kennt es; der Titel der Aufgabe nennt es nur
  allgemein.
- UHS, BR, Einheit und Einsatzabschnitt. Sie haben schon einen Live-Zustand für „gibt es nicht
  mehr“ bzw. „aufgelöst“.
- Storno rückgängig machen. Dafür gibt es keinen Weg.
- Präsenzanzeige (LLH-1946).

## Decisions

### D1 — `storniert_von` als eigene Spalte an Person und Tier

Neue Migration (Nummer größer als jede auf `alpha`, beim Bau mit `scripts/check-migrationen.sh`
prüfen):

```sql
ALTER TABLE einsatz_person ADD COLUMN storniert_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_tier   ADD COLUMN storniert_von INTEGER REFERENCES benutzer(id);
```

- Person und Tier stornieren künftig mit `Vermerk::GeaendertUndStorniert`.
- Kein Nachtrag aus `geaendert_von`: Der Altbestand bleibt `NULL` und zeigt „Storniert um …“.
  Ein Nachtrag wäre nur eine Vermutung.
- Die Schwärzungs-Registry (`einsatz::schwaerzung_registry`) bekommt für beide Tabellen
  `retain("storniert_von", G_FK)`, wie beim Schaden.
- Die Spiegel-Trigger sind zeilenweise und brauchen keine Änderung. Das prüft der Bau mit
  `spiegel`-Tests.

*Verworfen:* `geaendert_von` als Storno-Nachweis lesen. Das stimmt heute nur, weil nach dem Storno
niemand mehr schreibt, und es bricht still beim ersten Wartungs- oder Rücknahmeweg.

### D2 — `storniert_von_name` im DTO, per Join

`PersonAnzeige`, das Tier-DTO und das Schaden-DTO bekommen `storniert_von_name: Option<String>`
(Join `LEFT JOIN benutzer b ON b.id = x.storniert_von`, `b.anzeigename`). Die bestehende
`storniert_von: Option<i64>` am Schaden bleibt (Grenzwert). Danach `scripts/check-typ-codegen.sh`
laufen lassen und beide erzeugten Dateien mitcommitten.

Am Einheitengerät (`ohne_personalien`) bleibt der Name des Benutzers stehen. Er ist eine
Einsatzkraft, keine Personalie der betroffenen Person (LFH-752).

### D3 — Gemeinsame Antwortform `StornoStand`

```rust
pub struct StornoStand { pub storniert_at: Option<String>, pub storniert_von_name: Option<String> }
```

Zwei neue Lese-Routen liefern diese Form:

- **`GET /api/einsaetze/{id}/personen/{pid}/stand`**
  - Gleiche Schranken wie das Detail: `EinsatzLesezugriff<Personen>`,
    `stelle::fordere_person`, fremder Einsatz → 404.
  - **Kein** Audit. Eine stornierte Person ist hier 200 mit `storniert_at`, kein 404.
  - Am Gerät gilt sie, wo auch das Detail gilt (Routenliste der Geräte wie `…/zeile`).
- **`GET /api/einsaetze/{id}/betreuung/stellen/{sid}/stand`**
  - Lesezugriff des Moduls Betreuung, fremder Einsatz oder unbekannt → 404.
  - Name über `storniert_von_id`.

Tier und Schaden brauchen keine Stand-Route: ihr Detail wird live (D5).

*Verworfen:* ein Merker `storniert: true` im Live-Ereignis (Fachangabe im Ereignis, Name fehlt
trotzdem). Ebenso `/zeile` mit anschließendem protokolliertem Detailabruf (der 404 ist am Gerät
mehrdeutig, und der Abruf schriebe trotzdem eine Protokollzeile).

### D4 — Person: Stand-Key live, Detail nicht

- Neuer Key `einsatzKeys.personStand(e, pid)` (`einsatz-person-stand`).
- Er wird live:
  - In `EINSATZ_STREAM_ZIELE.person` kommt `key(einsatzKeys.personStand(e, pid))` dazu.
  - In `EINSATZ_STREAM_EVENTS.person` kommt der Präfix für `lagged` und Wiederaufbau dazu.
- `PersonenDetailPage` fragt ihn mit `enabled` nur ab, solange das Detail geladen ist.
- Liefert er `storniert_at`, während das Detail noch keins hat, gilt die Seite als storniert
  (`storniertStand = detail.storniert_at ? detail : stand`).
- Das Detail wird dafür **nicht** neu geladen. Es bleibt in `NICHT_LIVE_KEYS` und bekommt
  `refetchOnWindowFocus: false`.

### D5 — Tier und Schaden: Detail live

- `EINSATZ_KEYS.tier` und `EINSATZ_KEYS.schaden` gehen aus `NICHT_LIVE_KEYS`.
- Tier: der Key kommt in `EINSATZ_STREAM_EVENTS.tier` (es gibt keinen gezielten Abgleich, der
  Präfix trifft alle offenen Tierdetails, das ist billig).
- Schaden: der Key kommt in `EINSATZ_STREAM_EVENTS.schaden` und in `EINSATZ_STREAM_ZIELE.schaden`
  als `key(einsatzKeys.schaden(e, sid))`, nicht im Zweig `anhang` (eine Datei ändert das Detail
  nicht).
- `useEditSitzung` hält den Basisstand beim Öffnen fest. Ein Live-Neuabruf während einer offenen
  Bearbeitung ändert also weder Entwurf noch Konfliktprüfung. Das sichert ein Test ab.

### D6 — Betreuungsstelle: letzter Stand bleibt

- Die Seite merkt sich die zuletzt gesehene Stelle (`useRef`).
- Fehlt sie danach in der Übersicht, fragt die Seite `betreuungsstelleStand` ab:
  - liefert er `storniert_at`: letzten Stand gesperrt mit Banner zeigen;
  - 404 oder kein `storniert_at` (etwa fremde Stelle am Gerät): wie heute `StelleNichtGefunden`.
- Ein direkter Aufruf einer schon stornierten Stelle (keine gemerkte Stelle) zeigt weiter
  `StelleNichtGefunden`. Die Übersicht liefert stornierte Stellen nicht, und ein eigener
  Einzel-Endpunkt nur dafür lohnt nicht. Das ist eine bewusste Grenze.

### D7 — Ein Baustein `StornoBanner` und eine Sperre

- `components/StornoBanner.tsx` nimmt `StornoStand`. Text:
  - „Storniert von {Name} um {HH:MM}“;
  - ist das Datum nicht heute, mit Datum („am TT.MM. um HH:MM“);
  - ohne Namen „Storniert um …“.
- Gestaltung über den Statusvertrag (`theme/statusFarben.ts`, Rolle für „storniert“, sonst die
  neutrale Hinweisrolle; keine neue Farbe) und `role="status"`. Es steht oberhalb der
  `SeitenHinweise` im Seitenkopf.
- Die Seiten leiten aus dem Stand ein `gesperrt` ab, an derselben Stelle, an der heute
  `storniert_at` die Aktionen ausblendet. Neue Bedingungen kommen nicht dazu.
- Offene Eingaben (D8) hängen am selben Wert.

### D8 — Offene Eingabe: schreibgeschützt statt geschlossen

- `InlineAngabe` regelt das selbst: Fällt `darfSchreiben` weg, während ein geänderter Entwurf
  offen ist, gilt Schreibschutz.
  - Das Eingabeelement wird `readOnly` und der Text bleibt markierbar.
  - „Speichern“ verschwindet, „Abbrechen“ heißt „Schließen“.
  - Der Entwurf zählt nicht mehr als Änderung, also gibt der Merker `offeneBearbeitung` die
    Sperre frei, ohne nachzufragen.
  - Eine unveränderte Bearbeitung schließt.
- Damit gilt die Regel überall, wo eine Seite `darfSchreiben && !storniert_at` übergibt, ohne
  eigene Verdrahtung.
- Die Bearbeiten-Formulare von Tier und Schaden (`useEditSitzung`, eigenes `<Form>`) und die
  Notizzeile im Patientenkopf verhalten sich ebenso.
- `BearbeitbaresPaneel` steht auf keiner der vier Seiten und bleibt unverändert.
- Ein schon laufender Speicherversuch, der danach mit 409 endet, zeigt keinen Konfliktdialog.
  Das Banner sagt genug, der Grund am Feld entfällt.

- Die Paneele des Patientenkopfs (Sichten, Verbleib, Transport, Maßnahme, Verletzung) tragen
  fast nur Auswahlen; sie schließen beim Storno wie bisher.

## Risks / Trade-offs

- **Zusätzlicher Abruf je Person-Ereignis und offener Detailseite.** Die Stand-Abfrage ist ein
  einzelner Primärschlüssel-Zugriff mit einem Join. Bündelung (300 ms) und Pause in verdeckten
  Tabs gelten wie für jeden Live-Key.
- **Tier- und Schaden-Detail laden live nach.** Eine fremde Änderung erscheint jetzt sofort, auch
  während man liest. Eine offene Bearbeitung ist durch D5 geschützt.
- **Direkt geöffnete stornierte Betreuungsstelle** zeigt weiterhin „gibt es nicht (mehr)“ (D6).

## Migration Plan

- Eine Migration, nur `ADD COLUMN` (nullable, kein Umbau, kein `-- no-transaction`).
- Ein Rücklauf ist nicht vorgesehen: Ältere Server ignorieren die Spalte.

## Open Questions

- (keine; am 18.11.2026 abgestimmt)
