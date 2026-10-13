# Proposal

## Why

Das Informationstelefon lädt das Anrufprotokoll heute als Vollliste. Kennzahlen, Aufgliederung
nach Anliegen und der Infotelefon-Teil der Medienlage zählen dieselbe geladene Menge im Client
(`pages/InfotelefonPage.tsx`, `stab/medienlage.ts`). Bei hunderten Anrufen trägt das. Bei einer
Großlage mit einem Bürgertelefon und tausenden Anrufen wird jede Live-Änderung zur Vollabfrage.
LFH-554 hat das bewusst offen gelassen (`openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/design.md`,
Risks: „Das Bürgertelefon wächst über die volle Liste hinaus“). Diese Change setzt den dort
benannten Folgeschritt um (Zunder LLH-732). Die Vorbilder sind die ETB-Zählung (LFH-612,
Spec `etb-zaehler`) und das Presse-Log (LFH-1075: Kennzahlen über den ganzen Bestand,
seitenweise Liste).

## What Changes

- **Zählung am Server:** `GET /api/einsaetze/{id}/stab/infotelefon/zaehler` liefert `gesamt`,
  `offen` und `je_anliegen` mit allen sieben Anliegen, auch denen ohne Anruf (0). Der Endpunkt
  nimmt denselben Filter wie die Liste (`status`) und zählt genau, was die Liste über alle Seiten
  liefert.
- **Liste seitenweise:** `GET …/stab/infotelefon` liefert die jüngsten Anrufe zuerst, je Seite
  höchstens `limit` Anrufe (Vorgabe 100, geklemmt auf die Obergrenze des ETB). Weitergeblättert
  wird über den Cursor `vor_zeit` + `vor_id` (Eingang und Kennung des letzten Anrufs). Neu ist
  der Filter `status=offen|erledigt`.
  - **BREAKING (intern):** Ohne Parameter liefert der Endpunkt nur noch die erste Seite, nicht
    mehr alle Anrufe. Einziger Abnehmer ist das eigene Frontend; es zieht im selben PR mit.
- **Ein Anruf einzeln:** `GET …/stab/infotelefon/{aid}` für den Deeplink `?anruf=<id>` auf einen
  Anruf, der in keiner geladenen Seite steht (404 bei fremdem Einsatz).
- **Protokollseite:**
  - Die Kennzahlen „Anrufe“ und „offene Rückrufe“ und „Nach Anliegen“ kommen aus der Zählung.
    Ist die Zählung nicht geladen, steht keine Zahl da, auch nicht die des geladenen Fensters.
  - Die Zeitachse lädt ein Fenster und am Ende „Ältere laden“, wie ETB und Presse-Log.
  - „offene Rückrufe“ blättert über den Server-Filter, statt die geladene Menge zu filtern.
  - Die Zufluss-Schleuse arbeitet auf dem geladenen Fenster.
- **Medienlage und Presseseite:** Der Infotelefon-Teil der Medienlage liest die Zählung statt der
  Anrufliste. Die Presseseite lädt keine Anrufliste mehr.
- **Live:** Das Ereignis `infotelefon` hält Liste, Zählung und Einzelabruf über den gemeinsamen
  Prefix aktuell. Das ist schon heute so verdrahtet; es kommt kein neues Ereignis hinzu.
- **Unverändert:** Erfassen, Statuswechsel, Rechte, Schwärzung, keine Offline-Speicherung,
  Sprung zu den Vermissten. Keine Migration (der Index `idx_infotelefon_anruf_einsatz` trägt
  Blättern und Zählen).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `stab-infotelefon`: Die Anforderung „Protokoll, offene Rückrufe und Kennzahlen“ verlangt die
  Zahlen nicht mehr aus der geladenen Menge, sondern aus einer Zählung am Server mit demselben
  Filter wie die Liste. Neu sind die Anforderungen „Zählung der Anrufe“ und „Das Protokoll wird
  seitenweise geladen“.
- `stab-medienlage`: Die Anforderung „Medienlage ohne Personenbezug“ nimmt die Anrufzahlen aus
  der Zählung des Informationstelefons, nicht aus der geladenen Anrufliste.

## Impact

- **Backend:** `src/infotelefon/repo.rs` (gemeinsame Filterbedingung, Seite, Zählung),
  `src/infotelefon/mod.rs` (DTO der Zählung), `src/routes/infotelefon.rs` (Parameter,
  Zähl- und Einzelroute), `src/routes/mod.rs`, `src/api_doc.rs`, `src/kommunikation/mod.rs`
  (Seitenparameter ohne Phase auslesen); neue Tests `tests/infotelefon_zaehler.rs`, Anpassung
  `tests/stab_infotelefon.rs`.
- **Typ-Codegen:** `frontend/src/api/openapi.json`, `types.generated.ts`.
- **Frontend:** `api/infotelefon.ts`, `api/queryKeys.ts` (Sub-Keys unter dem Prefix
  `infotelefon`), `pages/InfotelefonPage.tsx`, `pages/PressePage.tsx`, `stab/medienlage.ts`,
  `stab/medienlageQuelle.ts` samt Tests.
- **Regeln und Doku:** `frontend/src/stab/AGENTS.md` (Absatz zum Informationstelefon),
  `docs/anwender/kapitel/presse-infotelefon.md` („Ältere laden“).
