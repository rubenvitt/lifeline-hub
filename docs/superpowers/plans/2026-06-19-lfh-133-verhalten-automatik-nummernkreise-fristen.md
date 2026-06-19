# LFH-133 — Verhalten & Automatik: Nummernkreise + Default-Fristen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — task-by-task TDD. Steps use `- [ ]`.

**Goal:** Pro Einsatz konfigurierbare **Nummernkreis-Präfixe** (ETB, Meldung, **Auftrag**), einen konfigurierbaren **Startwert** der laufenden Nummer, **Default-Fristen** (Meldungs-Bestätigung, Auftrags-Quittierung) und einen **Auto-ETB-Schalter** als additive Sektion der Einsatz-Einstellungen — server-validiert, mit **Field-Freeze** sobald die erste Nummer eines Nummernkreises vergeben ist.

> **ENTSCHEIDUNG (Checkpoint):** Auftrags-Nummern werden in diesem Subtask **mitgebaut** — Auftrag bekommt zuerst eine laufende `lfd_nr` (operative Vorarbeit, vorgezogener Task 0), dann den Nummernkreis (Präfix/Start/Freeze) analog ETB/Meldung.

**Architecture:** Alle Felder sind **skalare ADD-COLUMN auf `einsatz_einstellungen`** (kein Rebuild, kein CHECK), Validierung in Rust (Muster `einstellungen.rs`). Entscheidende Design-Festlegung: **Das Präfix ist reine Anzeige-Konfiguration und wird NICHT pro Zeile gespeichert.** Jede ETB-/Meldungszeile behält ihre bare Integer-`lfd_nr`; das Präfix wird beim Rendern/Export vorangestellt (z. B. `EB-7`). Der **Startwert** wird beim ersten Anlegen wirksam (`COALESCE(MAX(lfd_nr)+1, <startwert>)` statt `COALESCE(MAX(lfd_nr),0)+1`), danach läuft die Nummerierung wie bisher fortlaufend. **Default-Fristen** sind nullable Spalten; Konsumenten lesen den Einstellungswert und fallen auf die bestehende Konstante (`BESTAETIGUNG_FRIST_DEFAULT_MIN`) zurück. **Auto-ETB-Schalter** ist ein Bool, der das Pattern-B-Dual-Publish (Meldung/Auftrag → ETB-Eintrag) gated.

**Freeze (NEUES Pattern, nicht das bestehende `fordere_aktiv`):** Präfix UND Startwert eines Nummernkreises frieren **field-level** ein, **getriggert durch Daten-Existenz** (`EXISTS(SELECT 1 FROM etb_eintrag WHERE einsatz_id=?)` bzw. `meldung`), **pro Nummernkreis getrennt** (ETB unabhängig von Meldung). Das ist **nicht** der whole-settings-Lock auf Abschluss. Es gibt im Repo **keinen** field-level/Daten-Existenz-Freeze-Präzedenzfall — die Pre-Mortem-Annotation „Freeze-Pattern wie für standard_modul/Karten bereits genutzt" ist faktisch falsch (`einstellungen_setzen` macht nur `fordere_aktiv`); dieses Muster wird hier **neu** gebaut.

**Tech Stack:** Rust (axum + sqlx-sqlite), React/TS (antd, React Query).

## Global Constraints

- **ADD COLUMN auf `einsatz_einstellungen`** für alle Felder — kein Rebuild, kein CHECK; Validierung in Rust. Muster strikt aus `einstellungen.rs`.
- **Migrationsnummer:** nächste freie Migration nach 0064 (NICHT hart `0065` festschreiben).
- **Präfix display-only:** keine Spalte/kein Wert pro ETB-/Meldungszeile; bare `lfd_nr` bleibt unverändert.
- **Freeze pro Nummernkreis über Daten-Existenz** (nicht `fordere_aktiv`): PUT lehnt Änderung eines eingefrorenen Feldes ab → **409**; GET liefert je Nummernkreis ein `*_eingefroren`-Flag, damit die UI das Feld disabled.
- **Auftrags-Nummern: Zähler-Vorarbeit zuerst.** Auftrag hat heute keine `lfd_nr` (Sortierung prio/frist/id). Task 0 führt eine laufende `auftrag.lfd_nr` (pro Einsatz, atomar `COALESCE(MAX(lfd_nr)+1, ?)` wie ETB/Meldung) als eigene Migration + Repo-Änderung ein; danach behandelt der Nummernkreis (Präfix/Start/Freeze) Auftrag exakt wie ETB/Meldung. `lfd_nr` ist NOT-NULL-fähig erst ab Befüllung — neue Spalte nullable, beim Anlegen gesetzt; Bestandszeilen (keine) nicht relevant, Seeds setzen sie mit.
- **Org-Isolation:** alle Queries strikt per `einsatz_id`; nie über Benutzer-Org ableiten (Memory cross-org-lesezugriff-luecke).
- Fehler-Codes: Validation=400, Conflict=409 (Freeze-Verletzung), Forbidden=403.
- **Default-Fristen ohne neuen Timer:** Werte greifen ausschließlich **beim Anlegen**; bestehender Erinnerungs-Scheduler (`anlegen_aus_frist` + tick) bleibt unberührt (Memory fristen-eskalation-erinnerungs-scheduler).
- rust-embed: Frontend-Änderung = pnpm build + Backend-Neustart.
- Commit-Referenz: `LFH-133`.

## File Structure

**Backend:**
- Create `migrations/00XX_auftrag_lfd_nr.sql` (nächste freie Nummer, **vor** der Verhalten-Migration) — `ALTER TABLE auftrag ADD COLUMN lfd_nr INTEGER;` (nullable, kein CHECK, kein Rebuild; wird beim Anlegen gesetzt). Index optional `(einsatz_id, lfd_nr)` für MAX-Lookup.
- Create `migrations/00XX_einsatz_einstellungen_verhalten.sql` (nächste freie Nummer) — `ALTER TABLE einsatz_einstellungen ADD COLUMN`:
  - `etb_nummer_praefix TEXT` (z. B. `EB-`), `etb_nummer_start INTEGER`,
  - `meldung_nummer_praefix TEXT`, `meldung_nummer_start INTEGER`,
  - `auftrag_nummer_praefix TEXT`, `auftrag_nummer_start INTEGER`,
  - `meldung_bestaetigung_frist_min INTEGER`, `auftrag_quittierung_frist_min INTEGER`,
  - `auto_etb_eintraege INTEGER` (0/1, Bool als INTEGER; NULL = Default an).
- Modify `src/einsatz/einstellungen.rs`:
  - Struct/`EinstellungenAnzeige`/`EinstellungenDaten`/`leer`/`speichern` SELECT+UPSERT um die neuen Spalten erweitern (Muster strikt wie bestehende Felder).
  - Validatoren in Rust: `ist_gueltiges_nummer_praefix(&str)` (Länge ≤ 8, Whitelist `[A-Za-z0-9-_/ ]`, getrimmt), `ist_gueltiger_startwert(i64)` (1..=999_999), `ist_gueltige_frist_min(i64)` (1..=10_080 = 1 Woche).
  - Freeze-Helfer: `pub async fn etb_nummer_vergeben(pool, einsatz_id) -> bool` (`EXISTS(SELECT 1 FROM etb_eintrag WHERE einsatz_id=?)`), `meldung_nummer_vergeben(...)` und `auftrag_nummer_vergeben(...)` (`EXISTS(SELECT 1 FROM auftrag WHERE einsatz_id=?)`); in `anzeige()` als `etb_nummer_eingefroren`/`meldung_nummer_eingefroren`/`auftrag_nummer_eingefroren` durchreichen (Anzeige braucht den Pool → entweder `anzeige_mit_freeze(pool)` oder Flags im Handler ergänzen — Muster wie Rolle-Durchreichung in einsatz.rs).
  - Startwert-Auflösung: `pub fn etb_startwert(&self) -> i64` (`self.etb_nummer_start.unwrap_or(1)`), analog `meldung_startwert`/`auftrag_startwert` — für die Repos.
- Modify `src/auftrag/repo.rs` (Task 0 + Nummernkreis) — `anlegen` Signatur um `startwert: i64` erweitern; `lfd_nr` beim Insert via `COALESCE(MAX(lfd_nr)+1, ?)` pro `einsatz_id` setzen (atomar in der Anlege-Transaktion, identisch zum ETB/Meldung-Muster). Auftrags-`AuftragAnzeige`/Listen um `lfd_nr` ergänzen.
- Modify `src/etb/repo.rs` — `anlegen_tx` (+ `anlegen`) Signatur um `startwert: i64` erweitern; SELECT-Insert auf `COALESCE(MAX(lfd_nr)+1, ?)` (erste Zeile = startwert, danach fortlaufend). **Hot-Path-Signaturänderung** → alle Aufrufer anpassen (Handler laden Einstellungen, reichen `etb_startwert()`; transaktionale Aufrufer wie Lagebericht-Freigabe ebenso).
- Modify `src/meldung/repo.rs` — analog: `anlegen` um `startwert` erweitern, `COALESCE(MAX(lfd_nr)+1, ?)`.
- Modify `src/routes/etb.rs`, `src/routes/meldung.rs`, `src/routes/auftrag.rs`, `src/routes/lagebericht.rs` (alle ETB/Meldung-Erzeuger):
  - Vor `repo::anlegen` Einstellungen laden (`laden_oder_default`), `startwert` reichen.
  - `meldung.rs`: `frist_min`-Default aus `meldung_bestaetigung_frist_min` statt Konstante (Konstante bleibt **finaler** Fallback, wenn Spalte NULL).
  - `auftrag.rs`: wenn `req.frist_at` leer → `frist_at` aus `auftrag_quittierung_frist_min` ableiten (Erteilzeit + Minuten); sonst Client-Wert.
  - Auto-ETB-Schalter: bei `auto_etb_eintraege == Some(0)` das Pattern-B-Dual-Publish (Meldung→ETB / Auftrag→ETB) überspringen.
- Modify `src/routes/einsatz.rs` — `EinstellungenUpdate` + `einstellungen_setzen`:
  - neue Felder annehmen + validieren (400 bei Verstoß),
  - **Freeze-Guard:** ist `etb_nummer_vergeben` true und das eingehende Präfix/Start unterscheidet sich vom Bestand → **409**; analog Meldung. (XOR-gegen-Bestand wie Memory patch-xor: nur ablehnen, wenn tatsächlich geändert wird.)
  - GET `einstellungen_laden` liefert die `*_eingefroren`-Flags mit.
- Modify `tests/einsatz.rs` (+ ggf. `src/einsatz/einstellungen.rs` Unit-Tests) — Validatoren, UPSERT der neuen Spalten, Freeze-409, Startwert-Wirkung, Frist-Default-Fallback, Auto-ETB-Gate, Org-Isolation.
- Ggf. Modify `src/dev/seed.rs` — der vorhandene Lückenlos-Invariant-Check (`COUNT==MAX(lfd_nr)`) gilt nur bei Startwert 1; Seeds setzen keinen Startwert → bleibt grün (verifizieren, nicht umbauen).

**Frontend:**
- Modify `frontend/src/api/types.ts` — `EinsatzEinstellungen` + `EinstellungenUpdate` um die neuen Felder; `etb_nummer_eingefroren`/`meldung_nummer_eingefroren: boolean` (nur in der Anzeige).
- Modify `frontend/src/pages/EinsatzEinstellungenPage.tsx` — **eine** additive Sektion „Verhalten & Automatik" (Nummernkreise, Default-Fristen, Auto-ETB) unter den bestehenden Sektionen; bestehende Sektionen NICHT umbauen. Eingefrorene Präfix-/Startwert-Felder `disabled` + Hinweistext „Erste Nummer bereits vergeben — nicht mehr änderbar". `karten_zoom_start`-Durchreichungs-Muster im `speichern` analog für die neuen Felder.
- Modify `frontend/src/api/einsaetze.ts` — `speichereEinstellungen`/`ladeEinstellungen` brauchen keine neuen Funktionen (Vollersatz-PUT trägt die Felder mit); nur Typen.
- Tests: `EinsatzEinstellungenPage` — Submit-Payload enthält die neuen Felder (Feldabdeckung, Memory review-eingabemaske-feldabdeckung); eingefrorenes Feld ist disabled.

## Tasks (TDD, Commit je Task)

0. **Auftrags-Zähler `lfd_nr` (operative Vorarbeit)** — Migration `auftrag ADD COLUMN lfd_nr INTEGER`; `auftrag::repo::anlegen` setzt `lfd_nr = COALESCE(MAX(lfd_nr)+1, ?startwert)` pro `einsatz_id` (startwert vorerst fest 1, im Nummernkreis-Task durchgereicht); `AuftragAnzeige`/Listen-Query um `lfd_nr`; Seeds setzen `lfd_nr` mit.
   - [ ] Tests: erster Auftrag eines Einsatzes bekommt `lfd_nr=1`, zweiter `2`; pro Einsatz unabhängig (Org-Isolation); Anzeige/Liste liefert `lfd_nr`.
   - [ ] Implementierung, bis grün. Commit `LFH-133`.
1. **Migration (ADD COLUMN) + Einstellungen-Domain erweitern** — neue Spalten (inkl. `auftrag_nummer_praefix`/`auftrag_nummer_start`) in Struct/Anzeige/Daten/`leer`/`speichern`; Validatoren (`ist_gueltiges_nummer_praefix`, `ist_gueltiger_startwert`, `ist_gueltige_frist_min`) + Startwert-Auflöser (ETB/Meldung/Auftrag).
   - [ ] Unit-Tests: Validatoren (Grenzen, Whitelist), UPSERT der neuen Spalten round-trips, `leer` = alle None, `etb_startwert` Default 1.
   - [ ] Implementierung, bis grün. Commit `LFH-133`.
2. **Freeze-Helfer + Anzeige-Flags** — `etb_nummer_vergeben`/`meldung_nummer_vergeben`; `*_eingefroren` in der Anzeige.
   - [ ] Tests: kein Eintrag → nicht eingefroren; nach erstem ETB-/Meldungs-Insert → eingefroren; ETB-Freeze unabhängig von Meldung-Freeze.
   - [ ] Implementierung. Commit `LFH-133`.
3. **Startwert in ETB-Repo** — `anlegen_tx`/`anlegen` um `startwert` erweitern, `COALESCE(MAX(lfd_nr)+1, ?)`; alle Aufrufer anpassen.
   - [ ] Tests: erste Nummer = startwert (z. B. 100), zweite = startwert+1; ohne Setting (1) altes Verhalten unverändert.
   - [ ] Implementierung inkl. Lagebericht-Freigabe-Aufrufer. Commit `LFH-133`.
4. **Startwert in Meldungs- + Auftrags-Repo** — `anlegen` um `startwert`; analog ETB. Auftrag reicht `auftrag_startwert()` in die in Task 0 gebaute `lfd_nr`-Vergabe.
   - [ ] Tests: Startwert wirkt (Meldung + Auftrag), Default 1 unverändert, ETB-in-selbem-Commit nutzt seinen eigenen Startwert.
   - [ ] Implementierung. Commit `LFH-133`.
5. **PUT-Route: neue Felder + Freeze-Guard (409)** — `EinstellungenUpdate` + `einstellungen_setzen` validieren; Freeze-XOR-gegen-Bestand für ETB **und** Meldung **und** Auftrag; GET liefert Flags.
   - [ ] Integrationstests: setzen ungültig → 400; Präfix/Start ändern bei vergebener Nummer → 409 (je Nummernkreis getrennt: Auftrag eingefroren, ETB frei); unveränderter Wert bei vergebener Nummer → ok (kein 409); GET-Flags korrekt; Org-Isolation (fremder Einsatz beeinflusst Freeze nicht).
   - [ ] Implementierung. Commit `LFH-133`.
6. **Default-Fristen anwenden** — Meldung: `meldung_bestaetigung_frist_min` als Default (Konstante = finaler Fallback). Auftrag: fehlende `frist_at` aus `auftrag_quittierung_frist_min` ableiten.
   - [ ] Integrationstests: Meldung ohne `bestaetigung_frist_min` nutzt Setting; ohne Setting Konstante; explizites Request-Override schlägt Setting. Auftrag ohne `frist_at` + Setting → Frist gesetzt; ohne Setting → keine Frist (wie heute).
   - [ ] Implementierung. Commit `LFH-133`.
7. **Auto-ETB-Schalter** — `auto_etb_eintraege == Some(0)` überspringt Pattern-B-Dual-Publish in Meldung/Auftrag-anlegen.
   - [ ] Integrationstests: Schalter aus → kein ETB-Eintrag bei Meldung/Auftrag; an/NULL → ETB-Eintrag wie heute (Default an).
   - [ ] Implementierung. Commit `LFH-133`.
8. **Frontend-Typen + Settings-Sektion** — Typen erweitern; additive Sektion „Verhalten & Automatik"; eingefrorene Felder disabled.
   - [ ] Test: Submit-Payload enthält alle neuen Felder (Feldabdeckung); eingefrorenes Präfix-Feld ist disabled.
   - [ ] Implementierung. Commit `LFH-133`. pnpm build + Backend-Neustart (rust-embed) erst zur manuellen Verifikation.

## Risiken / Hinweise

- **Hot-Path-Signaturänderung** (`anlegen_tx`/`anlegen` mit `startwert`) ist der größte Aufwand und Hauptfehlerquelle: jeder ETB-/Meldungs-Erzeuger (etb.rs, meldung.rs, auftrag.rs Vollzug, lagebericht.rs Freigabe) muss Einstellungen laden + Startwert reichen. Erst ETB exemplarisch + Test festzurren, dann mechanisch replizieren; ein vergessener Aufrufer bricht den Build (gut) — aber Test je Erzeuger fängt falsche Weitergabe.
- **Freeze ist ein NEUES Pattern, nicht `fordere_aktiv`** (im Repo nicht vorhanden — Pre-Mortem-Annotation ist hier ungenau). Field-level, Daten-Existenz-getriggert, pro Nummernkreis getrennt. 409 nur bei tatsächlicher Wertänderung gegen Bestand (XOR, Memory patch-xor) — sonst sperrt sich ein unveränderter Vollersatz-PUT selbst aus.
- **Präfix display-only:** auf keinen Fall pro Zeile speichern (verletzt ADD-COLUMN-only-Vertrag und macht Freeze sinnlos). Anzeige/Export setzt das Präfix beim Rendern voran — Render-Stelle ist hier NICHT in Scope (nur Konfiguration + Persistenz); Konsumieren des Präfix in ETB-/Meldungs-Anzeige ist optionaler Folge-Task (analog karten_zoom_start, das als Fundament gespeichert, aber noch nicht konsumiert wird — siehe EinsatzEinstellungenPage Zeile 104-106).
- **Default-Fristen nur beim Anlegen** — kein neuer Timer; Scheduler/`anlegen_aus_frist` unangetastet. Frist-Override im Request schlägt das Setting (bestehende Semantik in meldung.rs erhalten).
- **Seed-Invariante:** `src/dev/seed.rs` prüft `COUNT==MAX(lfd_nr)` (Lückenlosigkeit ab 1). Seeds setzen keinen Startwert → bleibt grün. Wenn ein Seed je einen Startwert setzte, müsste die Invariante auf `MAX-MIN+1==COUNT` umgestellt werden — heute nicht nötig, aber im Hinterkopf behalten.
- **Org-Isolation:** Freeze-`EXISTS` strikt per `einsatz_id`; ein fremder Einsatz mit Einträgen darf den Freeze dieses Einsatzes nicht auslösen (Test in Task 5).
