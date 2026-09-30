# Design

## Context

- `src/live/mod.rs`: `LiveEvent` (31 Varianten, `ALLE`) mit `modul_keys()`. Die Füll-Regel lautet:
  Im Gate steht das Modul, dem das Datenobjekt gehört. Eine leere Menge heißt heute „bewusst ungated"
  und gilt nur für `lagged`. Das pinnt `nur_kontroll_events_sind_ungegatet`.
- `src/routes/live.rs`: EINE Tür `EinsatzLesezugriff` (ohne Modul), dann ein Filter je Ereignis über
  `sichtbar_fuer(erlaubte_module)`.
- `GET /api/einsaetze/{id}` (`routes/einsatz.rs::detail`): ebenfalls `EinsatzLesezugriff` ohne
  Modul. Der Einsatzkopf ist also für jeden lesbar, der den Strom öffnen darf.
- Schreibwege auf Kopfspalten durch Nutzeraktion: `aktualisieren` (PATCH, `repo::patche_kopf`),
  `abschliessen`, `aufbewahrungsfrist_setzen` und `stab::repo` beim Abschluss einer Lagebesprechung
  (`UPDATE einsatz SET naechste_lagebesprechung_at`, Schritt 6 in der Transaktion). Soft-Delete,
  Purge und Schwärzung laufen im Scheduler bzw. im Archiv an Einsätzen, deren Strom ohnehin endet.
- Frontend: `EINSATZ_KEYS.einsatz` steht in `NICHT_LIVE_KEYS`. Rund 30 Seiten lesen den Kopf über
  `einsatzKeys.einsatz(id)`, unter anderem für das Schreibrecht (`status`). Der Stab-GET liefert den
  Termin aus derselben Spalte mit (LFH-46, Entscheidung 11).
- Die Stab-Variante trägt den Kommentar: `einsatzdaten` NICHT ins Gate, sonst erführe ein Leser ohne
  Stab-Recht, *dass* eine Besprechung stattfand.

## Goals / Non-Goals

**Goals**
- Der Termin der nächsten Lagebesprechung ist auf allen Schirmen live, in beide Richtungen (Stab →
  Einsatzdaten/Überblick, Einsatzdaten → Stab-Kopfblock).
- Der Abschluss des Einsatzes und die Pflege der Kopfdaten erreichen andere Schirme sofort.
- Eine Terminwahrheit, kein zusätzlicher Speicherort, kein neues Recht.

**Non-Goals**
- Benutzerbezogene Kopffelder und `lagekennzahlen` live machen (D5).
- Die globale Einsatzliste (`globalKeys.einsaetze`) live machen. Sie liegt nicht unter einer Einsatz-ID.
- Den Frischabruf im Wiedervorlage-Modal (LFH-463) entfernen. Er bleibt als Absicherung bei
  gestörter Verbindung stehen.

## Decisions

### D1 — Live statt bewusst nicht-live

Das Ticket lässt beide Wege offen. Live gewinnt, weil der Nachlauf nicht nur den Termin trifft.
Auch der Abschluss des Einsatzes erreicht andere Schirme nicht, und sie laufen erst beim Speichern
in einen 409. Die Kosten sind klein: Die Nutzlast ist nur eine Kennung, und der Kopf ist eine
Einzelabfrage, die fast jede Seite ohnehin hält.

**Verworfen:** Nicht-live lassen und den Stab-GET weiter als Umweg nutzen. Das deckt nur den Termin
und nur auf der Stab-Seite ab.

### D2 — Leere Gate-Menge, Regel fortgeschrieben

Der Kopf gehört keinem Modul. Seine Tür ist dieselbe wie die des Stroms. Nach der Füll-Regel ist die
Gate-Menge daher leer. Diese Menge bekommt eine genauere Bedeutung: **„kein Modul — erreicht jeden,
der die Tür des Stroms passiert"**. Sie gilt für zwei Fälle, das Kontrollereignis `lagged` und den
Kopf `einsatz`. Der Guard `nur_kontroll_events_sind_ungegatet` wird zu
`ungegatet_sind_nur_lagged_und_einsatz` (`["einsatz", "lagged"]`). Jede weitere leere Menge bleibt
damit rot. Kommentar an `modul_keys` und `sichtbar_fuer` fortschreiben.

**Verworfen:** Ein Pseudo-Modul `einsatzdaten` ins Gate aufnehmen. `erlaubte_module` enthält es nicht
für jeden Leser des Kopfs, und damit fehlte das Ereignis bei jemandem, der den Kopf per GET sieht.
Genau diesen stehenden Cache soll das Ticket beseitigen.

### D3 — Stab feuert `einsatz` nur bei tatsächlicher Terminänderung

Das Leck aus Entscheidung 11 ist die Frage, ob ein Leser ohne Stab-Recht erfährt, *dass* eine
Besprechung stattfand. Feuert `einsatz` nur, wenn sich der Termin tatsächlich ändert, erfährt er
nicht mehr als das, was der Kopf-GET ohnehin zeigt: einen neuen Termin. Umsetzung in Schritt 6 der
Transaktion:

```sql
UPDATE einsatz SET naechste_lagebesprechung_at = ?
 WHERE id = ? AND naechste_lagebesprechung_at IS NOT ?
```

`rows_affected() == 1` heißt, der Termin hat sich geändert. `IS NOT` behandelt `NULL` richtig. Die
Transaktion gibt dazu `termin_geaendert: bool` zurück. Die Route publiziert nach dem Commit
`LiveEvent::Einsatz` nur dann. Der bestehende Riegel `fordere_aktiv_in_tx` (Schritt 5) bleibt
unverändert. Das Prädikat ist kein Status-Riegel und nimmt ihm nichts ab. Der Wert wird vor dem
Vergleich wie bisher normalisiert (`etb::normalisiere_zeit`), sonst zählte eine andere Schreibweise
desselben Zeitpunkts als Änderung.

Die Gate-Menge von `stab` bleibt `["stab"]`. Der Kommentar dort verweist künftig auf D3 statt auf
„Einsatzkopf bleibt NICHT_LIVE".

### D4 — Frontend: ein Eintrag, zwei Caches

```ts
// Einsatzkopf (LFH-555). Der Stab-GET liefert den Termin aus derselben Spalte mit
// (LFH-46, Entscheidung 11), deshalb hängt er hier mit dran: eine Terminwahrheit, zwei Caches.
einsatz: [EINSATZ_KEYS.einsatz, EINSATZ_KEYS.stab],
```

`einsatz` fällt aus `NICHT_LIVE_KEYS`, und der Kommentar dort wird angepasst. Der `lagged`-Vollabgleich
nimmt den Kopf dadurch automatisch mit. Die Invalidierung eines `stab`-Caches ist kein Leck, denn
der Stab-GET prüft sein Modul selbst (403 → die Fehlernaht räumt wie bisher).

Keine Seite ändert sich. Das Bearbeitungsformular der Einsatzdaten-Seite belegt seine Felder einmal
beim Öffnen (`bearbeitenStarten` → `setFieldsValue`), und ein Refetch überschreibt es nicht.
`InlineAngabe` hält ihr eigenes `<form>`. Beides wird in der Umsetzung per Test belegt. Das
Lage-Dashboard hält seinen Zuschnitt bereits während der Betrachtung fest (LFH-640, Sammelbanner),
ein live frischer Kopf verschiebt die Kennzahlreihe also nicht.

### D5 — Was bewusst nicht über `einsatz` läuft

- **`meine_*`** ist benutzerbezogen. Ein Ereignis bei der Stab-Besetzung verriete Lesern ohne
  Stab-Recht Besetzungsaktivität, obwohl sich *ihr* Kopf nicht ändert. Das wäre genau das Leck aus
  Entscheidung 11. Mitgliedschaftswechsel (`meine_rolle`) bekommen ein Folge-Ticket, denn der Wechsel
  des Schreibrechts auf dem Schirm der betroffenen Person ist eine eigene Frage.
- **`lagekennzahlen`** stammt aus Pegel bzw. Evakuierung. Ein Ereignis beim Festlegen feuerte bei
  jeder Pegeländerung, nicht nur beim Umschalten der Kennzahl. Das bekommt ein Folge-Ticket mit
  derselben Technik wie in D3 (nur beim Umschalten).
- **Scheduler-Wege** (Soft-Delete, Purge, Schwärzung) laufen an abgeschlossenen Einsätzen. Die Fehlernaht
  räumt beim nächsten 403/404 ohnehin.

## Risks / Trade-offs

- **Mehr Abrufe:** Jede Kopfänderung ruft den Kopf auf allen offenen Schirmen neu ab. Kopfänderungen
  sind selten (Minutentakt und seltener), der Abruf ist eine Einzeilenabfrage. Das ist vertretbar.
- **Regelverschiebung der leeren Gate-Menge:** Sie ist sicherheitstragend. Der umbenannte Guard pinnt
  die Menge `["einsatz", "lagged"]`, `gate_mengen_sind_gepinnt` pinnt `Einsatz → &[]`. Ein
  Fachereignis, das versehentlich auf `&[]` rutscht, bleibt rot.
- **Replay:** `einsatz` läuft durch denselben Ring wie jedes Ereignis. Die Kennung ist harmlos.

## Migration Plan

Keine Datenmigration. Die Reihenfolge im PR: Backend-Variante und Emitter, dann der Codegen, dann
das Frontend. Die Wire-Kontrakttests auf beiden Seiten laufen im selben Commit rot/grün.

## Open Questions

_keine_ — Die zwei Wahlpunkte (D1 live ja/nein, Emitter-Umfang D5) werden vor `/opsx:apply` vom User
bestätigt.

## Nachweise (Umsetzung 30.09.2026)

- **Mutationsprobe Backend:** `IS NOT`-Prädikat in `stab/repo.rs` entfernt →
  `lagebesprechung_ohne_terminaenderung_feuert_kein_einsatz` und
  `lagebesprechung_die_den_termin_aufhebt_feuert_einsatz` rot; zurückgedreht → grün.
- **Mutationsprobe Frontend:** Eintrag `einsatz` aus `EINSATZ_STREAM_EVENTS` genommen → beide Fälle
  in `e2e/einsatzkopf-live.spec.ts` rot (der Termin erscheint ohne Neuladen nicht); zurückgedreht →
  grün. Ohne den Eintrag bricht zusätzlich `tsc` am Typ-Kontrakt in `liveEvent.contract.test.ts`.
- **Einsatzdaten-Seite:** offenes Bearbeitungsformular und offene Zeile behalten ihre Eingaben bei
  einem Refetch des Kopfs (Vitest in `EinsatzdatenPage.test.tsx`); kein Fix nötig (D4).
