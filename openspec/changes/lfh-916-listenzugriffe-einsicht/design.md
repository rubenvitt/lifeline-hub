# Design

## Context

- **Tabelle.** `person_zugriff_audit` (`migrations/0021`, CHECK zuletzt in `0141`) führt je Zeile
  Einsatz, optionale Person, Benutzer, Art (`detail`, `export`, `druck`, `anhang`) und
  `zugriff_at` (`strftime('%Y-%m-%d %H:%M:%S','now')`). `export` und `druck` tragen
  `person_id = NULL` (`routes/einsatz_person.rs`, `export`/`druck`), `detail` und `anhang` eine
  Person. Index `idx_person_audit_einsatz (einsatz_id, zugriff_at)` besteht.
- **Einsicht heute.** Nur `GET …/personen/{pid}/audit` (`audit`): Lesezugriff auf das Modul
  Personen, dann `fordere_einsatzleitung`, 404 für eine fremde Person, Antwort
  `Vec<ZugriffAnzeige>` aus `audit_repo::liste_je_person` (`WHERE person_id = ?`). Die
  Detailseite zeigt sie im Abschnitt „Zugriffs-Audit“, nur für `istEinsatzLeitung`, geladen erst
  beim Aufklappen (`einsatzKeys.personAudit`, in `NICHT_LIVE_KEYS`). Die Art steht als Klartext
  aus `personen/zugriffArt.ts` („Liste exportiert“, „Liste gedruckt“).
- **Erfassung und Storno.** `einsatz_person.erfasst_at` setzt nur der Server (Default), auch für
  offline erfasste Personen beim Zustellen. `storniert_at` setzt `storno::storniere` im selben
  Format; eine Stornierung lässt sich nicht aufheben. Export und Druck liefern
  `repo::liste(…, None)`, also alle nicht stornierten Personen des Einsatzes.
- **Personenliste.** `pages/PersonenPage.tsx` trägt im Kopf Ansichtswahl, „Druckansicht“, bis zu
  drei Erfassungsknöpfe und „CSV exportieren“. `frontend/AGENTS.md`: Drawer nur als
  schreibgeschützte Schnellansicht; der Kopf-Slot trägt, was öffnet.

## Goals / Non-Goals

**Goals:**

- Die Einsatzleitung sieht Export und Druck der Personenliste ohne Datenbankzugriff, dort, wo
  beides ausgelöst wird.
- Die Einsicht je Person beantwortet „wer hatte meine Daten?“ vollständig, also einschließlich
  der Listen, in denen die Person stand.

**Non-Goals:**

- Kein Filter, keine Seitenweise, kein Export des Protokolls. Ein Einsatz erzeugt wenige
  Listenzugriffe (je Klick einer); die Einsicht je Person lädt heute ebenfalls alles.
- Keine Erfassung, *welche* Auswahl gedruckt wurde (Filter im Client, LFH-727 D1) — das Protokoll
  hält fest, dass die Liste abgerufen wurde.
- Kein Protokoll für Tier- und Schadenslisten (unverändert, LFH-727 Non-Goals).
- Keine Live-Aktualisierung der Einsicht.

## Decisions

### D1 — Eigener Endpunkt `GET /api/einsaetze/{id}/personen/listenzugriffe`

Gate wie bei `audit`: `EinsatzLesezugriff<Personen>`, dann `ctx.fordere_einsatzleitung()?`.
Antwort `Vec<ZugriffAnzeige>` aus einer neuen Abfrage `audit_repo::liste_listenweit`
(`WHERE einsatz_id = ? AND person_id IS NULL ORDER BY zugriff_at DESC, id DESC`). Der Handler
schreibt keinen Protokolleintrag. Die statische Route liegt neben `…/personen/druck` und
`…/personen/export`; axum zieht statische Segmente dem Parameter `{pid}` vor.

„Listenweit“ ist über `person_id IS NULL` bestimmt, nicht über eine Art-Liste: die
Tabellenspalte ist genau dafür dokumentiert („NULL bei Export gesamter Liste“), und eine künftige
listenweite Art erschiene ohne Nachzug. Eine neue Art bricht im Frontend ohnehin `tsc` über den
erschöpfenden `Record` in `zugriffArt.ts`.

*Verworfen:* `GET …/personen/audit` ohne `{pid}` (liest sich wie „alles“, obwohl nur Listen
gemeint sind); ein Query-Parameter am Personen-Endpunkt (vermischt zwei Mengen in einem Handler).

### D2 — Ort im Frontend: Kopf-Knopf „Listenzugriffe“ an der Personenliste, Schnellansicht im Drawer

Die Einsatzleitung sieht im Kopf der Personenliste neben „CSV exportieren“ einen Knopf
„Listenzugriffe“. Er öffnet einen Drawer mit einer `KatalogTabelle` (Wann · Wer · Art, wie der
Abschnitt „Zugriffs-Audit“ der Detailseite). Die Abfrage läuft erst mit offenem Drawer
(`enabled`), unter einem neuen Key `einsatzKeys.personenListenzugriffe(einsatzId)` in
`NICHT_LIVE_KEYS` (Begründung wie `personAudit`). Der Knopf ändert nichts und öffnet nur — er
gehört damit in den Kopf (`frontend/AGENTS.md`, Aktionen) und zählt nicht als Primäraktion.

Begründung: Die Einsicht steht dort, wo Export und Druck ausgelöst werden, wie „Zugriffe“ bei den
UHS-Dateien (LFH-758) an der Datei steht. Ein Drawer ist hier zulässig: reine Schnellansicht,
schreibgeschützt, drei Spalten.

*Verworfen:*
- *Abschnitt in den Einsatzeinstellungen* (etwa bei „Aufbewahrung“): Einstellungen ändern
  Verhalten, das Protokoll ist ein Nachweis; die Einsatzleitung suchte es dort nicht neben dem
  Export, und die Seite steht allen Mitgliedern offen.
- *Aufklappbarer Abschnitt unter der Tabelle der Personenliste*: bei langen Listen außer Sicht,
  und `Datensicht` füllt die Seite.
- *Eigene Route*: lohnt erst mit Filtern oder Seitenweise (Non-Goals).

### D3 — Die Einsicht je Person zeigt die Listenzugriffe ihres Erfassungsfensters

`liste_je_person` liefert zusätzlich die listenweiten Zeilen des Einsatzes, deren `zugriff_at`
im Fenster der Person liegt:

```sql
WHERE a.einsatz_id = ?1
  AND (a.person_id = ?2
       OR (a.person_id IS NULL
           AND a.zugriff_at >= p.erfasst_at
           AND (p.storniert_at IS NULL OR a.zugriff_at <= p.storniert_at)))
```

(mit `einsatz_person p` über `p.id = ?2 AND p.einsatz_id = ?1`). Beide Grenzen schließen die
gleiche Sekunde ein: Die Zeitstempel haben Sekundenauflösung, und ob die Person in der Liste
stand, ist dort nicht entscheidbar. Wie bei LFH-727 gilt „eher ein Eintrag zu viel als einer zu
wenig“. Stornierung ist endgültig, das Fenster ist also ein einziges Intervall. Die Zeitstempel
haben dasselbe Format (`strftime('%Y-%m-%d %H:%M:%S')`), der Textvergleich ist ein
Zeitvergleich.

Die Art bleibt `export`/`druck`, `person_id` bleibt `NULL` — die Detailseite zeigt sie als „Liste
exportiert“/„Liste gedruckt“ und braucht dafür keine neue Spalte. Ein Satz unter der Tabelle
erklärt, dass Listenzugriffe erscheinen, wenn die Person in der Liste stand.

Begründung: Eine Auskunft nach Art. 15 DSGVO fragt, wer die Daten der Person erhalten hat; ein
CSV mit ihr ist genau das. Ohne D3 müsste die Einsatzleitung die Listenzugriffe von Hand gegen
Erfassungs- und Stornozeit legen.

*Verworfen:* alle Listenzugriffe des Einsatzes je Person zeigen (falsch für Personen, die erst
später erfasst wurden); eine eigene Art „betrifft auch diese Person“ im DTO (DTO- und
Codegen-Änderung ohne Mehrwert, die Art „Liste …“ sagt es schon).

## Risks / Trade-offs

- [Bestehende Tests zählen die Einträge je Person nach einem Export] → Die Integrationstests in
  `tests/einsatz_person.rs`, die `audit_anzahl` nach einem Export oder Druck zählen, werden auf
  die neue Menge angepasst; die Änderung der Zahl ist gewollt und steht im Test.
- [Personen-Schwärzung (`schwaerzung_person.rs`) behandelt Zeilen mit `person_id`] → Listenweite
  Zeilen tragen keine Person und sind davon nicht berührt; die Einsicht je Person einer
  geschwärzten Person zeigt sie weiter, das ist der Nachweis, den die Schwärzung behalten soll.
- [Die Einsicht zeigt Namen von Einsatzkräften] → Nur die Einsatzleitung, wie die bestehende
  Einsicht je Person.

## Migration Plan

Keine Migration und kein DTO-Wechsel. Rückbau ist ein Revert des PR.
