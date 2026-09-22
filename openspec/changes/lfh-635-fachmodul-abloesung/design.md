# Design

## Context

Den Anlass beschreibt `proposal.md`, das Verhalten legt `specs/kraefte-abloesung/spec.md`
fest. Für das Vorgehen sind vier Befunde aus dem Bestand maßgeblich (Scope-Lauf vom
22.09.2026):

- **Einheit und Abschnitt kennen keine Zeitachse.** `einsatz_einheit` hat weder Status noch
  Einsatzbeginn, `einsatzabschnitt` hat keine Rhythmusfelder. Beides wird neu modelliert. Eine
  Näherung aus `angelegt_at` oder aus Bereitstellungsraum-Belegungen scheidet aus, weil die
  Erfassung kein Eintreffen ist.
- **Der Erinnerungs-Scheduler ist generisch, aber nicht transaktionsfähig.**
  `erinnerung::repo::anlegen_aus_frist` hat nur eine Pool-Variante und liest bei einem
  Konflikt nur, statt zu verschieben. `schliesse_offene_auto_tx` gibt es bereits. Der
  partielle UNIQUE-Index `idx_erinnerung_auto_bezug(bezug_typ, bezug_id) WHERE
  quelle='auto_frist' AND status='offen'` lässt je Bezug genau eine offene Auto-Frist zu.
  `bezug_typ` hat keinen CHECK, ein neuer Wert braucht also keine Migration.
- **Das Live-Ereignis `erinnerung` ist auf das Modul `erinnerungen` beschränkt**
  (`live/mod.rs`, `modul_keys`). Wer nur Ablösung sieht, bekäme den Scheduler-Hinweis nicht.
- **Die AlarmZentrale hat schon ein Budget** (`MAX_SICHTBARE_TOASTS = 3`, Sammel-Toast,
  `duration: 0`, kein Blinken). Sie kennt die Ziele `meldungen | auftraege | erinnerungen`.

Als Referenzen dienen das jüngste Fachmodul `stab` (Commit `ccdb3e76`: Extractor-Gates,
LiveEvent, Codegen, Schwärzung), `nachforderung` (Status-Workflow, ETB-Rückverweis) und
`meldung/repo.rs:bestaetige` (atomarer Vollzug mit `schliesse_offene_auto_tx`).

## Goals / Non-Goals

**Goals:**
- Fälligkeit und Einstufung werden beim Lesen berechnet. Der Scheduler liefert nur den
  einmaligen Hinweis.
- Alles, was eine Ablösung verändert, läuft in einer `write_retry!`-Transaktion: Schicht,
  Fristen, Folgeschicht und ETB.
- Das Modul kommt ohne neues Alarm-Primitiv aus. Es nutzt Scheduler, AlarmZentrale und
  „Nächste Marken“.

**Non-Goals:**
- Der Vollzug **verschiebt die ablösende Einheit nicht** in den Abschnitt
  (`einsatz_einheit.abschnitt_id` bleibt, wie es ist). Das bleibt Sache der
  Einheiten-Verwaltung.
- Kein Schichtplan im Voraus (mehrere künftige Schichten), keine Personal-Ebene (Ablösung
  einzelner Personen), keine Ruhezeiten- oder Arbeitszeitrechnung.
- Keine Eskalationsstufe über „überfällig“ hinaus (höchstens drei Stufen:
  planmäßig → Vorwarnung → überfällig).
- Die Vorwarnzeit ist fest auf 30 min gesetzt (entspricht `KNAPP_MINUTEN` im Überblick) und
  ist in v1 nicht einstellbar.

## Decisions

### D1 — Datenmodell: eine Tabelle `einsatz_abloesung` = eine Schicht

```
einsatz_abloesung(
  id, einsatz_id → einsatz CASCADE,
  einheit_id → einsatz_einheit CASCADE,
  abschnitt_id → einsatzabschnitt SET NULL,   -- Einsatzstelle der Schicht (Snapshot)
  beginn_at, rhythmus_minuten CHECK (>0 AND <=10080),
  rhythmus_quelle CHECK IN ('abschnitt','einheit'),
  faellig_at,                                  -- gespeichert = beginn + rhythmus (Sortierung, Frist)
  abloesende_einheit_id → einsatz_einheit SET NULL,
  status CHECK IN ('laufend','abgeloest'),
  vollzogen_at, vollzogen_von_id,
  vorgaenger_id → einsatz_abloesung SET NULL,  -- Folgeschicht zeigt auf die abgelöste
  etb_vollzug_id → etb_eintrag,                -- Bezug für die Berichtigung
  angelegt_at, angelegt_von_id)
UNIQUE INDEX (einheit_id) WHERE status='laufend'
+ ALTER TABLE einsatzabschnitt ADD COLUMN abloesung_rhythmus_minuten INTEGER
```

- **`faellig_at` wird gespeichert**, obwohl man es berechnen könnte. Grund: Sortierung und
  Fristanlage brauchen denselben Wert, und SQLite-Zeitarithmetik in jeder Abfrage wäre eine
  zweite Rechenstelle. Geschrieben wird der Wert nur in `repo`, immer zusammen mit
  `beginn_at`/`rhythmus_minuten`.
- **`abschnitt_id` ist ein Snapshot an der Schicht**, kein Join über die Einheit. Eine
  Folgeschicht erbt ihn von der abgelösten Schicht. So bleibt „Deichwache Nord“ die
  Einsatzstelle, auch wenn die ablösende Einheit noch im Bereitstellungsraum geführt wird.
  Die Weitergabe einer Vorgabe und die Gruppierung der Marke laufen über diese Spalte.
  Verworfen wurde der Join über `einsatz_einheit.abschnitt_id`: dann hinge die Marke daran,
  ob jemand die Einheit umgehängt hat.
- **Die Enums bekommen einen DB-CHECK** wie in `0102_stab.sql` (jüngstes Muster), nicht die
  reine Code-Prüfung aus `nachforderung`.
- **Kein Freitext in der Tabelle.** Damit sind alle Spalten in der Schwärzungsregistry
  `retain`.
- Die Migrationsnummer ist `0104`. Beim Mergen wird sie gegen offene Branches geprüft
  (LFH-606 trägt eine eigene `0103`). Eine Kollision wird dort aufgelöst, eine
  angewendete Migration wird nicht editiert.

### D2 — Fristen: zwei Bezugstypen statt einer Frist mit zwei Zeitpunkten

`bezug_typ = 'abloesung'` (zur Fälligkeit) und `'abloesung_vorwarnung'` (Fälligkeit −30 min).
Weil sie verschiedene Bezugstypen sind, deckt der vorhandene UNIQUE-Index beide ab, ohne
dass man ihn anfasst. Verworfen wurden:
- **eine wiederkehrende Erinnerung mit Intervall.** Das Intervall ist ein festes Raster, eine
  Ablösung dagegen ein einmaliger Zeitpunkt je Schicht.
- **ein Vorwarn-Zweig im Scheduler, der ein Offset rechnet.** Das wäre eine zweite
  Fälligkeitslogik neben `faellig_at`.

Neu in `erinnerung::repo`:
- `anlegen_aus_frist_tx(conn, …)`: die transaktionsfähige Form. Die Pool-Variante ruft sie
  auf, an Auftrag und Meldung ändert sich also nichts.
- `setze_auto_frist_tx(conn, eid, ersteller, bezug_typ, bezug_id, titel, faellig_at)`:
  Upsert. Gibt es eine offene Auto-Frist, setzt sie `faellig_at`, `titel` und
  `zuletzt_ausgeloest_at = NULL`, sodass die verschobene Frist erneut auslöst. Sonst legt sie
  eine an.
- `oeffne_letzte_auto_tx(conn, bezug_typ, bezug_id)`: öffnet bei der Rücknahme die zuletzt
  geschlossene Auto-Frist wieder. `zuletzt_ausgeloest_at` bleibt dabei stehen, eine schon
  erfolgte Auslösung wiederholt sich also nicht (Spec: Rücknahme).
- `loesche_auto_tx(conn, bezug_typ, bezug_id)`: entfernt die Fristen einer
  zurückgenommenen Folgeschicht. Löschen statt Schließen, weil die Schicht selbst
  verschwindet. Eine erledigte Frist ohne Bezug wäre ein Geist in der Erinnerungsliste.

Die Konstanten `OBJEKT_ABLOESUNG` und `OBJEKT_ABLOESUNG_VORWARNUNG` liegen in
`kommunikation/mod.rs` neben den übrigen `OBJEKT_*`.

### D3 — Scheduler: zusätzliches Ereignis statt Umbau des Gates

`tick_einmal` publiziert wie bisher `LiveEvent::Erinnerung`. Für die Bezüge `abloesung*`
kommt ein zweites Ereignis `LiveEvent::Abloesung` dazu, mit
`{einsatz_id, abloesung_id, art: 'vorwarnung'|'faellig', titel, faellig_at}` und dem Gate
`&["abloesung"]`. So erreicht der Hinweis die Leser des Moduls, und das Gate des
Erinnerungs-Ereignisses bleibt unverändert. Dasselbe `LiveEvent::Abloesung` ohne `art` dient
wie beim Muster `erinnerung` als Listen-Refresh nach CRUD.

Verworfen wurde, das Gate von `erinnerung` auf `["erinnerungen","abloesung"]` zu erweitern.
Dann sähen Ablösungs-Leser alle Erinnerungen des Einsatzes.

### D4 — Frontend-Alarm: ein Pfad je Bezug

- `useEinsatzLiveStream.onErinnerung` überspringt `bezug_typ` `abloesung*` genauso wie
  `meldung` (kein Doppelalarm).
- Ein neuer Listener `onAbloesung` alarmiert nur, wenn `art` gesetzt ist. Bei `faellig` spielt
  er `spieleAlarmTon('alarm')`, bei `vorwarnung` `'dezent'`. Danach feuert er
  `lfh:abloesung-alarm`.
- `AlarmZentrale` bekommt das `AlarmZiel` `'abloesung'`, einen eigenen Toast-Titel
  („Ablösung fällig“ / „Ablösung in 30 min“) mit Deeplink `abloesungPfad` und denselben
  Budget-Weg (Scope, Sammel-Toast). Der Zähl-Scope ist ein eigener, damit der Sammeltext
  „n weitere Ablösungen“ stimmt.

### D5 — API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/einsaetze/{id}/abloesungen?status=laufend\|abgeloest` | Liste; jede Zeile mit `einstufung`, Einheits- und Abschnittsname, Name der ablösenden Einheit |
| POST | `…/abloesungen` | Schicht beginnen `{einheit_id, beginn_at?, rhythmus_minuten?}` |
| PATCH | `…/abloesungen/{aid}` | `{beginn_at?, rhythmus_minuten?: number\|null, abloesende_einheit_id?: number\|null}`; `rhythmus_minuten: null` = zurück zur Abschnittsvorgabe |
| POST | `…/abloesungen/{aid}/vollzug` | `{vollzogen_at?, abloesende_einheit_id?}` → 200 mit abgelöster Schicht und Folgeschicht |
| POST | `…/abloesungen/{aid}/vollzug/zuruecknehmen` | Rücknahme |
| GET | `…/abloesungen/vorgaben` | Abschnitte mit ihrer Vorgabe |
| PUT | `…/abloesungen/vorgaben/{abschnitt_id}` | `{rhythmus_minuten: number\|null}` |

- Die Vorgabe am Abschnitt wird **über das Ablösungsmodul** geschrieben, nicht über die
  Abschnitts-Routen. Rechte und Modulsichtbarkeit bleiben so an einem Gate, und
  `einsatzabschnitt.rs` (noch `DEFERRED_MODULE`) bleibt unberührt.
- Die Statuscodes folgen der Konvention: unbekannter Status-Filter, Rhythmus außerhalb von
  1..=10080 oder ein leerer Pflichtwert ergeben **400**. Zweite laufende Schicht, Selbstablösung,
  Vollzug einer abgelösten Schicht und eine unzulässige Rücknahme ergeben **422**. Eine fremde
  Einheit oder Schicht ergibt **404**.
- Gates über `EinsatzLesezugriff<Abloesung>`/`EinsatzSchreibzugriff<Abloesung>`, Bodies über
  `JsonBody`, Sub-IDs über `PfadParam`.
- `einstufung` ist ein Enum `planmaessig|vorwarnung|ueberfaellig` im Anzeige-DTO. Es wird in
  `repo` gegen ein übergebenes `jetzt` berechnet, damit Tests deterministisch bleiben.

### D6 — ETB

| Anlass | Typ | Wortlaut (Beispiel) |
|---|---|---|
| Vorgabe am Abschnitt gesetzt oder geändert | `entscheidung` | „Ablösung Abschnitt Deichwache Nord auf 6-Stunden-Rhythmus gesetzt (vorher 8 h).“ |
| Schicht begonnen, Rhythmus/Beginn/ablösende Einheit geändert | `system` (`system_audit_tx`) | „Ablösung: Florian 1 im Einsatz seit 09:30, fällig 15:30 (6 h).“ |
| Vollzug | `meldung` | „Ablösung vollzogen: Florian 1 durch Florian 2 um 15:40.“ Die ID landet in `etb_vollzug_id`. |
| Rücknahme | `berichtigung` mit `berichtigt_eintrag_id = etb_vollzug_id` | „Ablösung Florian 1 zurückgenommen.“ |

Ein Rückverweis `etb_eintrag.abloesung_id` wird **nicht** eingeführt. Den Sprung vom ETB zur
Ablösung verlangt die Spec nicht, und jede Rückverweis-Spalte ist ein Nachtrag in der
ETB-Anzeige.

### D7 — Seite

- Route `/einsaetze/:einsatzId/abloesung`, gebaut aus `EinsatzSeite`. Primäraktion im Kopf ist
  „Schicht beginnen“: sie öffnet ein `ErfassungsModal` mit drei Feldern (Einheit, Beginn,
  Rhythmus in Stunden) und liegt damit im Budget.
- **Form: Liste** (`components/Liste.tsx`), nicht Tabelle. Die Frage lautet „was ist mit
  dieser Einheit?“, nicht „welche von diesen?“, und die Ordnung ist die Fälligkeit. Eine
  Karte zeigt Einheit (Titel), Einstufung als `StatusTag` (Wort + Rolle aus der neuen
  Vertragskarte `abloesungEinstufung` in `theme/statusFarben.ts`: planmäßig neutral,
  Vorwarnung `achtung`, überfällig `alarm`), Fälligkeit als Uhrzeit, dazu Abschnitt, Beginn,
  Rhythmus mit Kennzeichnung „Vorgabe“ oder „eigener Wert“, und die geplante ablösende
  Einheit. Die Einstufung sitzt am linken Rand nach der C8-Regel „der linke Kartenrand trägt
  EINE Farbe, Gefahr gewinnt“.
- **Primäraktion je Karte:** „Ablösung vollziehen“ öffnet ein `ErfassungsModal` mit
  Zeitpunkt und ablösender Einheit (vorbelegt mit der geplanten). Die weiteren Aktionen
  (ablösende Einheit planen, Rhythmus ändern) sind unter der LFH-365-Regel gebündelt, sobald
  es drei oder mehr sind.
- **Nach dem Vollzug** erscheint `zeigeRueckgaengig`. Die Rücknahme hat einen
  serverseitigen Rückweg, deshalb gibt es keine Rückfrage (LFH-343).
- `Segmentleiste`: laufend / abgelöst.
- Das Paneel **„Rhythmus je Abschnitt“** führt die Abschnitte mit ihrer Vorgabe. Bearbeitet
  wird über ein kleines Modal mit einem Feld. Die Seite trägt keine Inline-Zahlenfelder in
  der Liste.
- **Ohne Schreibrecht** zeigt die Seite einen `RechteHinweis`, und die Primäraktion ist
  gesperrt. Die Kartenaktionen fallen weg (C11: zwei Zuschnitte).
- Die Zeit tickt über `useJetzt(30_000)`. Neue oder geänderte Datensätze von Dritten kommen
  über die Invalidierung von `einsatzKeys.abloesungen` herein. Die Liste springt nicht unter
  dem Cursor, weil sie nach Fälligkeit geordnet und klein ist. Die Prüfliste bewertet das
  Kriterium ausdrücklich.

### D8 — Überblick und Zähler

- `ueberblickDaten.naechsteMarken` bekommt eine vierte Quelle `abloesungen` und
  `MarkenArt = … | 'abloesung'`. Gruppiert wird nach `(abschnitt_id, faellig_at` auf die
  Minute gekürzt`)`. Der Text lautet „Ablösung <Abschnitt>, n Einheiten“ bzw.
  „Ablösung <Einheit>“, das Ziel ist `abloesungPfad`.
- Die Query ist nur aktiv, wenn das Modul sichtbar ist (`istModulSichtbar`). Für eine
  ausgeblendete Quelle entsteht also kein 403 und kein Ladefehler im Paneel.
- `ModulZaehlerQuelle` bekommt `'abloesung'` mit der Anzahl der Einstufungen `vorwarnung` +
  `ueberfaellig`. Die Einstufung berechnet das Frontend gegen `jetzt` nach derselben Regel
  (30 min). Die Regel steht deshalb als reine Funktion in `abloesung/einstufung.ts` und ist
  gegen die Backend-Grenzfälle getestet.

## Risks / Trade-offs

- **Zwei Stellen berechnen die Einstufung** (Backend-DTO und Frontend-Zähler/Marke, weil die
  Uhr im Client tickt). → Beide Seiten bekommen dieselben Grenzfall-Tests (genau fällig,
  genau 30 min, 30 min + 1 s). Das Frontend nutzt das Backend-Feld, wo es nicht zwischen zwei
  Abrufen veralten kann.
- **Die Titel der Fristen sind ein Snapshot des Einheitsnamens.** Nach einer Umbenennung
  nennt der Hinweis den alten Namen. → Bei jedem Setzen der Frist (`setze_auto_frist_tx`)
  wird der Titel erneuert. Eine Umbenennung ohne Friständerung bleibt ein bekannter,
  kosmetischer Rest.
- **Eine Einheit wird aufgelöst, während eine Schicht läuft:** Der CASCADE entfernt die
  Schicht, die Fristen würden als Geister weiterlaufen. → `einheit::repo::aufloesen` löscht
  in derselben Transaktion die Auto-Fristen der Schichten dieser Einheit
  (`loesche_auto_tx`).
- **Die Migrationsnummer kann mit LFH-606 kollidieren.** → Vor dem Merge gegen
  `origin/alpha` und offene Branches prüfen und neu nummerieren, solange sie nirgends
  angewendet ist.
- **Alarmlast bei vielen Einheiten:** Zwei Hinweise je Schicht, bei 20 Einheiten mit
  gleichem Takt also bis zu 40 Hinweise in wenigen Minuten. → Das Budget der AlarmZentrale
  bündelt ab dem vierten Hinweis. Weil Schichten eines Abschnitts meist gleichzeitig beginnen,
  bleibt die Last über den Tag verteilt. Die Prüfliste bewertet Kriterium 10 mit dieser
  Rechnung, und eine eigene Bündelung je Abschnitt ist ein benannter Nachzug, falls sie im
  Betrieb nötig wird.

## Migration Plan

Additive Migration, ohne Datenübernahme. Rollback: keine Schichten angelegt bedeutet kein
Verhalten. Eine Down-Migration gibt es im Projekt nicht. Das Modul ist nach dem Deployment
sofort sichtbar (Status `fertig`) und lässt sich je Einsatz über die Moduleinstellungen
ausblenden.
