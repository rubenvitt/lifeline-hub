# LFH-64 — Befehlsgebung (strukturierte Befehlsschemata)

**Status:** Design freigegeben (Brainstorming abgeschlossen 2026-06-21)
**ClickUp:** LFH-64 (`86ca3jabn`), Entwicklungsboard
**Branch:** `feat/lfh-64-befehlsgebung`

## Ziel

Strukturierte **Befehlsgebung** als Führungsdokument-Modul. Spiegelt die Mechanik des
bestehenden LFH-48 „Lageberichte" (eigenes Entity, Lebenszyklus Entwurf → Freigabe,
unveränderlicher Snapshot in den ETB bei Freigabe, strukturierte In-App-Anzeige +
Druck/PDF via Browser-Print). UI-seitig **integriert in das bestehende `auftraege`-Modul**
(„Aufträge/Befehle") als zweiter Tab — datenmodell-seitig aber ein **eigenes Entity**.

## Kernentscheidungen (aus dem Brainstorming)

| Frage | Entscheidung |
|---|---|
| Verortung | **In `auftraege` integrieren** (nicht als eigenes Modul). Modul-Kachel bleibt `auftraege`. |
| Datenmodell | **Eigenes `befehl`-Entity** (dokument-shaped), spiegelt `lagebericht`. Keine Vermischung mit dem kommunikations-shaped `auftrag`. |
| UI-Platzierung | **Tab-Switcher** „Aufträge / Befehle" in der `AuftraegePage`. |
| Schemata | **Alle vier:** LAD, LADEF, SCHNEE, EA/ZMW — **fest in Code** (wie LFH-48). |
| Granularität | **Flach** (Abschnitt = Schlüssel + Label + 1 Markdown-Feld). SKK-Unterpunkte als **Hilfetext** im Editor. |
| Fortschreibung | **Ja** — voller LFH-48-Mirror inkl. `version`/`vorgaenger_id` + Fortschreiben-Endpunkt/Button. |
| ETB-Typ des Snapshots | **`anordnung`** (`etb::TYP_ANORDNUNG`). BOS-semantisch korrekt (Befehl = Anordnung), konsistent mit dem Auftrags-Verhalten (Aufträge erzeugen bereits `anordnung`-Einträge), und vermeidet einen CHECK-Rebuild der zentralen `etb_eintrag`-Tabelle. |

## Kontext: warum eigenes Substrat

Der Task verweist auf `auftraege` als `geplant`; das Modul ist inzwischen **fertig** und
**kommunikations-shaped** (Quittierung, Status-Workflow, baut auf `src/kommunikation/`).
Befehlsgebung braucht dagegen die **dokument-shaped** LFH-48-Mechanik
(Entwurf→Freigabe→ETB-Snapshot→Druck). Zwei verschiedene Substrate → eigenes Entity,
aber gemeinsame Modul-Kachel/Berechtigung.

## Befehlsschemata (fest in Code)

Schlüssel sind **pro Vorlage** eindeutig (über Vorlagen hinweg dürfen sie sich wiederholen,
wie bei LFH-48). Backend (`src/befehl/mod.rs::VORLAGEN`) und Frontend
(`frontend/src/befehle/vorlagen.ts`) müssen **synchron** bleiben (Schlüssel + Reihenfolge);
Labels/Hilfetexte dürfen rein kosmetisch abweichen.

### `befehl_lad` — „Befehl LAD (vereinfacht)"
1. `lage` — Lage
2. `auftrag` — Auftrag
3. `durchfuehrung` — Durchführung

### `befehl_ladef` — „Befehl LADEF (erweitert, SKK)"
1. `lage` — Lage · *Hilfetext:* a. Allgemeine Lage · b. Schadenlage · c. Eigene Lage
2. `auftrag` — Auftrag · *Hilfetext:* Erhaltener Auftrag
3. `durchfuehrung` — Durchführung · *Hilfetext:* a. Eigene Absicht · b. Einzelaufträge · c. Zusammenarbeit/Koordinierung · d. Zeitangaben · e. Schutzmaßnahmen
4. `einsatzunterstuetzung` — Einsatzunterstützung · *Hilfetext:* Verpflegung · Betriebsstoffe · Materialerhaltung · Medizinische Versorgung
5. `fuehrung_kommunikation` — Führung und Kommunikation · *Hilfetext:* Kommunikationsverbindungen & Meldewesen · Meldeköpfe · Befehlsstellen · Standort der/des Führenden

### `befehl_schnee` — „Befehl SCHNEE"
1. `schadenlage` — Schadenlage
2. `nachbarn` — Nachbarn
3. `entschluss` — Entschluss / Absicht
4. `einzelauftrag` — Einzelauftrag
5. `eigener_standort` — Eigener Standort

### `befehl_ea_zmw` — „Einzelauftrag (EA/ZMW)"
1. `einheit` — Einheit
2. `auftrag_ziel` — Auftrag / Ziel
3. `mittel` — Mittel
4. `weg` — Weg

## Architektur

### Datenmodell — neue Migration (nächste freie Nummer)

Tabelle `befehl` — strukturgleich zu `lagebericht` (Migration `0038_lagebericht.sql`):

```
befehl(
  id, einsatz_id (FK→einsatz, CASCADE),
  vorlage TEXT CHECK (vorlage IN ('befehl_lad','befehl_ladef','befehl_schnee','befehl_ea_zmw')),
  titel, zeitstand,
  status TEXT CHECK (status IN ('entwurf','freigegeben')),
  abschnitte TEXT (JSON-Array [{schluessel, text}]),
  version INTEGER NOT NULL DEFAULT 1,
  vorgaenger_id INTEGER REFERENCES befehl(id),
  ersteller_id, erstellt_at, aktualisiert_at,
  freigegeben_von_id, freigegeben_at,
  etb_eintrag_id INTEGER REFERENCES etb_eintrag(id)
)
```

Additiv (kein CHECK-Rebuild):
```
ALTER TABLE etb_eintrag ADD COLUMN befehl_id INTEGER REFERENCES befehl(id);
```
Reverse-FK für Badge/Rücklink in der ETB-Timeline (analog `lagebericht_id`).

### Backend (Mirror von `lagebericht`)

- `src/befehl/mod.rs` — Status-Konstanten, `AbschnittDef` (`{schluessel, label}`, **ohne**
  `hilfetext` — das Backend rendert nur Label + Inhalt; Hilfetext ist Frontend-only),
  `VorlageDef`, `VORLAGEN`-Registry (4 Schemata), `leere_abschnitte`, `render_snapshot`
  (deterministisches Markdown), `validiere_freigabe` (Struktur- + Non-Empty-Gate).
- `src/befehl/repo.rs` — `liste`, `laden`, `anlegen`, `aktualisiere` (nur Entwurf,
  DB-Guard `WHERE status='entwurf'`), `freigeben` (Transaktion: `etb_repo::anlegen_tx`
  mit `typ='anordnung'` + Render → `etb_id`; Rückverweis `etb_eintrag.befehl_id`;
  `befehl.status='freigegeben'` + `etb_eintrag_id`; atomar, Rollback bei Fehler),
  `fortschreiben` (nur freigegeben → neuer Entwurf v+1, übernimmt Abschnittsinhalte).
- `src/routes/befehl.rs` — Handler mit `MODUL_KEY = "auftraege"`, Lesezugriff für alle
  mit Einsatz-Lesezugriff, Schreibrecht für Einsatzleitung/Führungspersonal,
  `fordere_aktiv`. SSE-Event `"befehl"` (`{einsatz_id, befehl_id}`).
- Registrierung: `src/lib.rs` (`pub mod befehl;`), `src/routes/mod.rs`, `src/app.rs`
  (6 Routen analog Lagebericht).

Routen:
```
GET   /api/einsaetze/{id}/befehle
POST  /api/einsaetze/{id}/befehle
GET   /api/einsaetze/{id}/befehle/{bid}
PATCH /api/einsaetze/{id}/befehle/{bid}
POST  /api/einsaetze/{id}/befehle/{bid}/freigeben
POST  /api/einsaetze/{id}/befehle/{bid}/fortschreiben
```

### Frontend

- `frontend/src/api/befehle.ts` — HTTP-Client (Mirror von `lageberichte.ts`):
  `listeBefehle`, `ladeBefehl`, `legeBefehlAn`, `aktualisiereBefehl`, `gibBefehlFrei`,
  `schreibeBefehlFort`.
- `frontend/src/api/types.ts` — `BefehlVorlageKey`, `BefehlStatus`, `BefehlAbschnitt`,
  `BefehlAnzeige` (Mirror der Lagebericht-Typen).
- `frontend/src/befehle/vorlagen.ts` — `AbschnittDef` (**+ `hilfetext?`**), `VorlageDef`,
  `VORLAGEN` (4 Schemata mit Hilfetexten), `vorlage`, `leereAbschnitte`.
- `frontend/src/auftraege/BefehlListe.tsx` (neu) — Liste der Befehlsdokumente + „Befehl
  erteilen" (Vorlage-Auswahl), verlinkt zu Detail. Hält die `AuftraegePage` schlank.
- `frontend/src/pages/AuftraegePage.tsx` — Tab-Switcher oben („Aufträge" = bestehender
  Inhalt, „Befehle" = `BefehlListe`). Bestehende Auftrags-Logik unverändert.
- `frontend/src/pages/BefehlDetailPage.tsx` (neu) — Mirror von `LageberichtDetailPage`:
  Entwurf-Form (MarkdownEditor je Abschnitt **+ Hilfetext-Anzeige**), Freigabe-Confirm
  („endgültig, Snapshot im ETB"), Read-only nach Freigabe, Fortschreiben-Button,
  Druck-Button, Link zum ETB-Eintrag.
- Route `auftraege/befehle/:bid` → `BefehlDetailPage` in `App.tsx`.
- Druck: eigene `frontend/src/pages/befehlPrint.css` (gespiegelt von `lageberichtPrint.css`),
  `window.print()`.
- SSE: `useEinsatzLiveStream("befehl")` invalidiert die Befehls-Query-Keys.

## Testplan (TDD)

**Backend:**
- `repo.rs`-Tests: anlegen/laden/aktualisieren (nur Entwurf), freigeben (ETB-Snapshot
  erzeugt, `typ='anordnung'`, bidirektionaler Rückverweis, Status-Guard, Rollback),
  fortschreiben (nur freigegeben → v+1, Inhalte übernommen).
- Routen-Tests: Status-Guards (Bearbeiten nur Entwurf → 422), Freigabe-Validierung,
  Schreibrecht/Lesezugriff, `fordere_aktiv`.

**Frontend:**
- `vorlagen.test.ts` — Schema-Sync Backend↔Frontend (Schlüssel + Reihenfolge je Vorlage).
- `AuftraegePage`-Test: Tab-Wechsel Aufträge/Befehle, Befehls-Tab rendert Liste.
- `BefehlDetailPage`-Test: Entwurf-Edit + Freigabe-Flow + Hilfetext-Anzeige + Read-only
  nach Freigabe.

## Bewusst nicht enthalten (YAGNI)

- Keine Konfigurierbarkeit der Schemata (Admin-Panel/Seed) — wie LFH-48 fest in Code.
- Kein gemeinsames Entity mit Lageberichten — eigenes `befehl`-Entity.
- Keine Empfänger/Quittierung (das ist das kommunikations-shaped `auftrag`).
- Keine hierarchischen Unter-Abschnitte als eigene Felder — flach + Hilfetext.

## Referenzen

- LFH-48 Lageberichte — Template: `src/lagebericht/`, `frontend/src/lageberichte/`,
  `frontend/src/pages/Lagebericht*.tsx`, `migrations/0038_lagebericht.sql`.
- ETB-Kopplung Pattern B: `etb_repo::anlegen_tx`, Reverse-FK.
- `frontend/src/einsatz/modulRegistry.ts` — `auftraege`-Modul (Kategorie Kommunikation).
- https://lageaufsicht.de/fuehrungsvorgang-teil-5-befehlsgebung/
