# LFH-136 — Anzeige-Konventionen pro Einsatz (Zeitzone/Zeitformat, Einheiten, Koordinatenformat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — task-by-task TDD. Steps use `- [ ]`.

**Goal:** Pro Einsatz konfigurierbare Anzeige-Konventionen — **Zeitzone + Zeitformat**, **Einheiten** (metrisch/imperial) und **Koordinatenformat** (WGS84 dezimal / MGRS / UTM) — als skalare Felder auf `einsatz_einstellungen`, im Frontend über **einen zentralen Context/Hook** bereitgestellt, den die bestehenden Anzeige-Komponenten konsumieren. Keine Streuung von Formatlogik: die heute schon zentrale Zeitformatierung (`kommunikation/zeit.ts`) und die heute hartcodierte Koordinatenanzeige (`Inspector.tsx`) werden auf die Konvention umgestellt.

**Architecture:** **ADD COLUMN** auf `einsatz_einstellungen` (`zeitzone TEXT`, `zeitformat TEXT`, `einheiten TEXT`, `koordinatenformat TEXT`) — kein Rebuild, kein CHECK; die Migration-0064-Doku nennt „Anzeige-Konventionen per ADD COLUMN" bereits explizit als vorgesehenen Weg. Validierung in Rust (Whitelist-Validatoren analog `ist_gueltiger_basemap_modus`). `None` = projektweiter Default (keine Verhaltensänderung gegenüber heute). Frontend: ein **`EinsatzAnzeigeProvider`** in `EinsatzLayout` (wrappt das Outlet-Subtree, kennt `einsatzId` schon, lädt Einstellungen über den geteilten queryKey `['einsatz-einstellungen', id]`), der einen `useAnzeigeKonventionen()`-Hook mit `formatZeit(utc)`, `formatKoordinate(lat, lon)` und `einheiten` exponiert. Die reine Formatlogik liegt in einem testbaren, framework-freien Modul (`anzeige/format.ts`), das Provider/Hook und Defaults (heutiges Verhalten) wrappt.

**Tech Stack:** Rust (axum + sqlx-sqlite), React/TS (antd, React Query, dayjs + `dayjs/plugin/utc` + `dayjs/plugin/timezone`).

## Global Constraints

- Keine DB-CHECK; Validierung in Rust. **Skalare Felder → ADD COLUMN** auf `einsatz_einstellungen` (kein Rebuild, kein Leaf nötig — alle vier sind 1:1-Skalare).
- **Migrationsnummer zur Implementierungszeit** vergeben (nächste freie nach 0064/0065…). NICHT hart festschreiben.
- **Genau EINE additive Sektion** in `EinsatzEinstellungenPage.tsx` („Anzeige-Konventionen"). Bestehende Sektionen (Einstieg, Karten-Defaults) nicht umbauen.
- **Org-Isolation:** Queries strikt per `einsatz_id` (Felder leben auf der bestehenden, per `einsatz_id` adressierten Zeile — automatisch erfüllt; nie über Benutzer-Org ableiten).
- **Default = heutiges Verhalten:** `None`/leer ⇒ Zeit lokal `DD.MM.YYYY HH:mm` (wie `formatZeit` heute), Koordinate WGS84 dezimal `lat.toFixed(5), lon.toFixed(5)` (wie `Inspector` heute), Einheiten metrisch. Kein Feld erzwingt eine Migration bestehender Anzeigen über das Nötige hinaus.
- Fehler-Codes: Validation=400, Conflict=409, Forbidden=403.
- rust-embed: Frontend-Änderung = pnpm build + Backend-Neustart.
- Commit-Referenz: `LFH-136`.
- **Aufnahme-Filter erfüllt:** alle vier Felder variieren pro Einsatz UND sind Anzeige-Präferenz (kein operativer Inhalt). Theme bleibt Benutzerprofil; diese Konventionen sind bewusst einsatzweit (gemeinsames Lagebild), nicht pro Benutzer.

## File Structure

**Backend:**
- Create `migrations/<nächste freie>_einsatz_anzeige_konventionen.sql` — `ALTER TABLE einsatz_einstellungen ADD COLUMN zeitzone TEXT; … zeitformat TEXT; … einheiten TEXT; … koordinatenformat TEXT;` (vier separate `ADD COLUMN`-Statements, keine CHECK).
- Modify `src/einsatz/einstellungen.rs`:
  - Whitelist-Konstanten + Validatoren: `ZEITFORMATE` (`'24h'`,`'12h'`), `EINHEITEN_SYSTEME` (`'metrisch'`,`'imperial'`), `KOORDINATENFORMATE` (`'wgs84'`,`'mgrs'`,`'utm'`) + `ist_gueltiges_zeitformat`/`ist_gueltiges_einheiten_system`/`ist_gueltiges_koordinatenformat`. Zeitzone: IANA-Name; pragmatisch nicht-leer validieren (volle TZ-DB-Prüfung wäre Over-Engineering — siehe Risiken).
  - `EinsatzEinstellungen` (FromRow) um die vier `Option<String>`-Felder erweitern; `leer()`, `anzeige()`/`EinstellungenAnzeige`, `SELECT`-Spaltenliste in `laden_oder_default`, `EinstellungenDaten<'a>` und `speichern`-UPSERT (Insert-Spalten + `ON CONFLICT … DO UPDATE SET`) je um die vier Felder ergänzen — strikt nach bestehendem Muster.
- Modify `src/routes/einsatz.rs` — `EinstellungenUpdate` um die vier Felder; im `einstellungen_setzen` bereinigen (`bereinige`) + Whitelist-Validierung (Fehler ⇒ 400) + an `EinstellungenDaten` durchreichen. Guard/Freeze unverändert (bereits einsatzleitung|admin + `fordere_aktiv`).
- Modify `src/einsatz/einstellungen.rs` Tests — `speichern_upsert_und_laden` um die vier Felder erweitern; Validatoren-Unit-Tests (gültig/ungültig).
- Modify `tests/einsatz.rs` (Integration) — PUT mit gültigen Werten persistiert + GET liest zurück; ungültiges `koordinatenformat`/`zeitformat`/`einheiten` ⇒ 400; Org-Isolation (fremder Einsatz ⇒ 403/404).

**Frontend:**
- Modify `frontend/src/api/types.ts` — `Zeitformat = '24h' | '12h'`, `EinheitenSystem = 'metrisch' | 'imperial'`, `Koordinatenformat = 'wgs84' | 'mgrs' | 'utm'`; `EinsatzEinstellungen` + `EinstellungenUpdate` um `zeitzone: string | null`, `zeitformat`, `einheiten`, `koordinatenformat` erweitern.
- Create `frontend/src/anzeige/format.ts` — **reine Formatlogik** (framework-frei, voll unit-testbar): `interface AnzeigeKonventionen { zeitzone?: string|null; zeitformat?: Zeitformat|null; einheiten?: EinheitenSystem|null; koordinatenformat?: Koordinatenformat|null }`; `formatZeit(utc, konv)`, `formatZeitKurz(utc, konv)` (dayjs.utc → `.tz(zeitzone)` wenn gesetzt sonst `.local()`; `12h`→`hh:mm A`), `formatKoordinate(lat, lon, konv)` (wgs84 dezimal default; mgrs/utm). `DEFAULT_KONVENTIONEN` = heutiges Verhalten.
- Create `frontend/src/anzeige/koordinaten.ts` — `wgs84ZuMgrs(lat,lon)`, `wgs84ZuUtm(lat,lon)` (kleine, getestete Eigenimplementierung; **keine** neue schwere Dependency, vgl. Risiken).
- Create `frontend/src/anzeige/AnzeigeKonventionenContext.tsx` — `EinsatzAnzeigeProvider` (lädt `['einsatz-einstellungen', einsatzId]` per useQuery, geteilter Cache; bei fehlenden Werten Defaults) + `useAnzeigeKonventionen()`-Hook, der gebundene `formatZeit`/`formatZeitKurz`/`formatKoordinate` + rohe Konventionen liefert.
- Modify `frontend/src/einsatz/EinsatzLayout.tsx` — Outlet mit `<EinsatzAnzeigeProvider einsatzId={einsatzId}>…</EinsatzAnzeigeProvider>` umschließen.
- Modify `frontend/src/pages/lagekarte/Inspector.tsx` — hartcodierte `toFixed(5)`-Koordinate durch `useAnzeigeKonventionen().formatKoordinate(marker.lat, marker.lon)` ersetzen.
- Modify `frontend/src/kommunikation/zeit.ts` — bestehende `formatZeit`/`formatZeitKurz` als dünne Delegationen auf `anzeige/format.ts` mit `DEFAULT_KONVENTIONEN` umstellen (Signatur bleibt rückwärtskompatibel ⇒ die 7 Konsumenten bleiben grün), **Konvention-bewusste Variante** zusätzlich exportieren. (Optional/Folge: einzelne Karten-Komponenten auf den Hook umstellen — Scope hier: zentral + Inspector + Kommunikations-Zeitachse exemplarisch.)
- Modify `frontend/src/api/einsaetze.ts` — keine neue Funktion nötig (`ladeEinstellungen`/`speichereEinstellungen` tragen die neuen Felder über die erweiterten Typen).
- Modify `frontend/src/pages/EinsatzEinstellungenPage.tsx` — **additive Sektion „Anzeige-Konventionen"**: `Select` Zeitzone (kuratierte IANA-Liste + Freitext), `Radio`/`Select` Zeitformat (24h/12h), Einheiten (metrisch/imperial), Koordinatenformat (WGS84/MGRS/UTM). `FormWerte` + `initialWerte` + `speichern()`-Payload um die vier Felder erweitern (Vollersatz-Semantik beibehalten).
- Tests:
  - Create `frontend/src/anzeige/format.test.ts` — `formatZeit` 24h vs. 12h, Zeitzonen-Anwendung, Default = altes Verhalten; `formatKoordinate` wgs84/mgrs/utm + Default.
  - Create `frontend/src/anzeige/koordinaten.test.ts` — bekannte Referenzpunkte (z. B. ein deutscher Punkt) → erwartetes MGRS/UTM.
  - Modify `frontend/src/kommunikation/zeit.test.ts` — Rückwärtskompatibilität der Default-Pfad-Ausgabe bleibt unverändert.
  - Modify `frontend/src/pages/EinsatzEinstellungenPage.test.tsx` — Submit-Payload enthält `zeitzone/zeitformat/einheiten/koordinatenformat` (Feldabdeckung), und die Felder werden aus geladenen Einstellungen vorbelegt.
  - Test für `Inspector` Koordinatenanzeige unter MGRS-Konvention (innerhalb Provider/MemoryRouter).

## Tasks (TDD, Commit je Task)

1. **Migration + Backend-Domain/Validatoren.** Migration (`ADD COLUMN` ×4). `einstellungen.rs`: Whitelist-Konstanten + Validatoren, `EinsatzEinstellungen`/`leer`/`anzeige`/`laden_oder_default`/`EinstellungenDaten`/`speichern` um vier Felder erweitern.
   - [ ] Validatoren-Unit-Tests (gültig/ungültig je Feld) schreiben → rot.
   - [ ] `speichern_upsert_und_laden` um die vier Felder erweitern → rot.
   - [ ] Implementieren bis grün. Commit `LFH-136`.
2. **Route: PUT/GET tragen neue Felder + Validierung.** `EinstellungenUpdate` + `einstellungen_setzen` (bereinigen, Whitelist ⇒ 400, durchreichen).
   - [ ] Integrationstests in `tests/einsatz.rs`: PUT persistiert + GET liest zurück; ungültiges Format ⇒ 400; Org-Isolation ⇒ 403/404 → rot.
   - [ ] Handler implementieren bis grün. Commit `LFH-136`.
3. **Frontend Formatlogik (rein).** `anzeige/format.ts` + `anzeige/koordinaten.ts` + Typen in `types.ts`.
   - [ ] `format.test.ts` + `koordinaten.test.ts` (24h/12h, TZ, wgs84/mgrs/utm, Default=alt) → rot.
   - [ ] Implementieren bis grün. Commit `LFH-136`.
4. **Context/Hook + EinsatzLayout-Wrap.** `AnzeigeKonventionenContext.tsx`; Layout umschließt Outlet.
   - [ ] Test: Hook liefert gebundene Formatter mit geladenen Einstellungen; ohne Werte = Default → rot.
   - [ ] Implementieren bis grün. Commit `LFH-136`.
5. **`kommunikation/zeit.ts` auf `format.ts` delegieren (rückwärtskompatibel).**
   - [ ] `zeit.test.ts` bleibt grün (Default-Pfad unverändert); ggf. ergänzender Test für Konvention-Variante → rot.
   - [ ] Umstellen bis grün. Commit `LFH-136`.
6. **Inspector-Koordinate auf Hook umstellen.**
   - [ ] Test: Inspector unter MGRS-Konvention zeigt MGRS statt Dezimalgrad → rot.
   - [ ] `toFixed(5)` durch `formatKoordinate` ersetzen bis grün. Commit `LFH-136`.
7. **Settings-UI-Sektion „Anzeige-Konventionen".** Additive Sektion in `EinsatzEinstellungenPage`; `FormWerte`/`initialWerte`/`speichern()` erweitern.
   - [ ] Submit-Payload-Test (Feldabdeckung) + Vorbelegung aus geladenen Werten → rot.
   - [ ] Implementieren bis grün. Commit `LFH-136`.
8. **Verifikation.** `pnpm build` + Backend-Neustart (rust-embed); voller Vitest-Lauf `--no-file-parallelism`; `cargo test`.
   - [ ] Gates grün. Commit (falls nötig) `LFH-136`.

## Risiken / Hinweise

- **Koordinaten-Umrechnung ohne schwere Dependency:** MGRS/UTM sauber selbst zu implementieren ist nicht-trivial. Erste Wahl: kleine, getestete Eigenimplementierung in `koordinaten.ts` (UTM-Vorwärtsformel + MGRS-100km-Square-Buchstaben), gegen Referenzpunkte verifiziert. Falls Genauigkeit/Aufwand das sprengt, ist `mgrs` (npm, leichtgewichtig, kein proj4-Zwang) der einzige akzeptable Fallback — Entscheidung im Plan offen lassen (siehe Open Questions), aber **keine** breite proj4-Abhängigkeit einziehen.
- **Zeitzone-Validierung:** Volle IANA-TZ-DB-Validierung im Backend wäre Over-Engineering. Backend prüft nur „nicht-leerer String"; die UI bietet eine kuratierte Liste (Default `Europe/Berlin` + gängige) plus Freitext. `dayjs/plugin/timezone` (+ Daten) muss im Frontend extended werden — idempotent wie in `zeit.ts` bereits für `utc`.
- **Default = striktes Alt-Verhalten:** `formatZeit(utc)` ohne Konvention muss byte-identisch zur heutigen Ausgabe bleiben, sonst kippen die 7 Konsumenten-Snapshots/Tests. Deshalb `DEFAULT_KONVENTIONEN` und rückwärtskompatible Signatur in `zeit.ts`.
- **Scope-Disziplin (kein Streuen):** Dieser Subtask zentralisiert die Konvention und stellt **exemplarisch** Inspector (Koordinate) + Kommunikations-Zeitachse (Zeit) um. Flächendeckendes Umstellen jeder einzelnen `dayjs().format(...)`-Stelle (ETB-MetaChip, diverse Formulare, Dashboard) ist bewusst NICHT Teil dieses Tickets — das wären Folge-Tickets; hier nur die zentrale Infrastruktur + zwei nachweisbare Konsumenten, damit der Mechanismus belegt ist.
- **Einheiten-Konsum:** Es gibt heute kaum nutzerseitige metrische Größenanzeigen mit Einheitensuffix; `einheiten` wird als Konvention bereitgestellt und vom Hook exponiert, aber mangels breiter Konsumstellen ggf. nur in `format.ts` (z. B. `formatDistanz`) vorbereitet — nicht erzwungen flächendeckend verdrahtet.
- **rust-embed:** Frontend-Änderungen erst nach `pnpm build` + Backend-Neustart sichtbar.
- **Test-Stabilität:** Vitest-Gate via `--no-file-parallelism` (Memory frontend-testsuite-parallel-timeouts); Provider-Tests mit `MemoryRouter` umschließen (Memory dndkit-onclick-koexistenz).
