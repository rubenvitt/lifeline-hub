# Versand-Anbindung ohne Abruf-Angaben — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versand-Anbindungen (SMTP, Matrix, Fax) sprechen von Prüfung statt Abruf und haben kein bearbeitbares Intervall.

**Architecture:** Die Art meldet `zweck` (`abruf`/`versand`) über `AdapterArt::zweck()` und das DTO `AdapterArtAnzeige`. Der Server legt das Intervall einer Versand-Art auf ihren Vorschlag fest. Das Frontend wählt Texte und Felder nach `art.zweck`.

**Tech Stack:** Rust (axum, utoipa, `wire_enum!`), React/TypeScript (antd, vitest).

**Spec:** `docs/superpowers/specs/2026-11-28-x256kbnt-versand-anbindung-ohne-abruf-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/x256kbnt8fqxc3jh3k4lf385

## Global Constraints

- Wire-Werte `abruf` und `versand`, DTO-Feld `zweck` (deutsch, bestehender Typ).
- Fehlertext bei abweichendem Intervall: `intervall_s: bei einer Versand-Anbindung fest` (400).
- Texte exakt wie in der Tabelle des Design-Docs.
- Nach der DTO-Änderung `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts` mitcommitten.
- Abruf-Arten unverändert.

## Review Focus

- Bestehende SMTP-Zeile mit `intervall_s = 900`: PATCH nur des Namens muss gelingen (Intervall nicht gesendet → Wert bleibt). Test in Task 1.
- PATCH mit `intervall_s` gleich dem Vorschlag (alter Client) → 200. Test in Task 1.
- Adapter, dessen Art fehlt (`art == null`, „Art unbekannt“): Ansicht zeigt weiter die Abruf-Texte, kein Absturz. Test in Task 2.
- Ein gescheiterter Prüfversuch im Verlauf zeigt weiter den Fehlertext (nicht „erreichbar“). Test in Task 2.
- Anlegen-Formular beim Wechsel von einer Versand- zu einer Abruf-Art zeigt das Intervall mit Vorschlag wieder. Test in Task 2.

---

### Task 1: Backend — Zweck der Art und festes Intervall

**Files:**
- Modify: `src/adapter/art.rs` (Enum, Trait-Methode, DTO, Unit-Test)
- Modify: `src/adapter/smtp_art.rs`, `src/adapter/matrix_art.rs`, `src/adapter/sipgate_fax_art.rs`
- Modify: `src/routes/adapter.rs` (`check_intervall` Aufrufe beim Anlegen und Ändern)
- Test: `tests/adapter_smtp.rs`
- Generated: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`

**Interfaces:**
- Produces: `wire_enum! AdapterZweck { Abruf => "abruf", Versand => "versand" }` in `art.rs`;
  `fn zweck(&self) -> AdapterZweck { AdapterZweck::Abruf }` in `AdapterArt`;
  `AdapterArtAnzeige.zweck: AdapterZweck`; im TS `AdapterArtAnzeige['zweck']: 'abruf' | 'versand'`.

- [ ] **Step 1: Tests schreiben.** Unit-Test in `art.rs`: `Verzeichnis::produktiv(..)` liefert für `smtp`, `matrix`, `sipgate_fax` `zweck() == Versand`, für `stammdaten_abruf` `Abruf`. In `tests/adapter_smtp.rs`:
  `arten_liste_meldet_zweck_versand` (GET Liste: Art `smtp` hat `zweck == "versand"`),
  `anlegen_mit_abweichendem_intervall_ist_400` (`intervall_s: 900` → 400, Meldung enthält „fest“),
  `aendern_mit_abweichendem_intervall_ist_400`, `aendern_mit_vorschlag_intervall_ist_200`,
  `aendern_ohne_intervall_laesst_altwert_stehen` (Zeile per SQL auf 900 setzen, PATCH `name` → 200, `intervall_s == 900`).
- [ ] **Step 2: Rot sehen** — `cargo test --test adapter_smtp` und `cargo test --lib adapter::art`.
- [ ] **Step 3: Umsetzen.** Enum, Trait-Default, DTO-Feld in `AdapterArtAnzeige::aus`; die drei Arten überschreiben `zweck`. In `routes/adapter.rs` eine Funktion `check_intervall_fuer(art, gesendet: Option<i64>, bisher: i64) -> Result<i64, AppError>`: bei `Versand` → `Some(x) if x != vorschlag` ist 400, sonst `bisher`; bei `Abruf` wie bisher `check_intervall(art, gesendet.unwrap_or(bisher))`. Beim Anlegen ist `bisher` der Vorschlag.
- [ ] **Step 4: Grün sehen**, dann `scripts/check-typ-codegen.sh` laufen lassen.
- [ ] **Step 5: Commit** `feat: Zweck der Adapterart, festes Intervall für Versand-Anbindungen (LLH-2126)`.

### Task 2: Frontend — Prüfung statt Abruf

**Files:**
- Modify: `frontend/src/pages/einstellungen/adapterAnzeige.ts` (+ `.test.ts`)
- Modify: `frontend/src/api/adapter.ts` (`adapterVersuchText`)
- Modify: `frontend/src/pages/einstellungen/AdapterAnsicht.tsx` (+ `.test.tsx`)
- Modify: `frontend/src/pages/einstellungen/AdapterPaneel.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `AdapterArtAnzeige.zweck` aus Task 1.
- Produces: `isVersandArt(art: Pick<AdapterArtAnzeige,'zweck'> | undefined): boolean`;
  `adapterZustandAnzeige(a, versand = false)` (Wort für `wartet` bei `versand`: „noch nicht geprüft“);
  `adapterVersuchText(v, versand = false)` (bei `versand`: Erfolg „erreichbar“, keine Eintragszahl).

- [ ] **Step 1: Tests schreiben.** `adapterAnzeige.test.ts`: Zustandswort `wartet` mit/ohne `versand`; `isVersandArt(undefined) === false`. `AdapterAnsicht.test.tsx` mit SMTP-Art (`zweck: 'versand'`): kein „Intervall“, „Zuletzt geprüft“ ohne „Einträge“, „Nächste Prüfung“, Paneel „Letzte Prüfungen“, „Noch keine Prüfung.“, Verlaufseintrag „erreichbar“, gescheiterter Eintrag zeigt Fehlertext; Ergebnis „Verbindung prüfen“ ohne „nichts übernommen“. Gegenprobe mit Abruf-Art: alte Texte stehen. Art fehlt: Abruf-Texte. `AdapterPaneel.test.tsx`: Anlegen mit SMTP zeigt kein Intervallfeld und sendet kein `intervall_s`; Wechsel zu einer Abruf-Art zeigt es mit Vorschlag; Listenzeile „noch nicht geprüft“ bzw. „zuletzt geprüft …“.
- [ ] **Step 2: Rot sehen** — `mise exec -- pnpm -C frontend exec vitest run src/pages/einstellungen/Adapter src/pages/einstellungen/adapterAnzeige`.
- [ ] **Step 3: Umsetzen** nach der Tabelle des Design-Docs; Intervallfeld in `felder` und im Anlegen-Formular nur bei `!isVersandArt(art)`; `nebenangaben` bekommt die Art.
- [ ] **Step 4: Grün sehen**, dazu `tsc` und Lint der geänderten Dateien.
- [ ] **Step 5: Commit** `fix: Versand-Anbindung zeigt Prüfung statt Abruf (LLH-2126)`.

### Task 3: Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] Bilder der SMTP-Ansicht vorher/nachher und des Anlegen-Formulars (Wegwerf-Spec).
- [ ] Nachzug-Aufgabe „letzte Übergabe aus dem Ausgang an der Anbindung“ anlegen.
