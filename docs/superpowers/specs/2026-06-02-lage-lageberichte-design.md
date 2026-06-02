# Lageberichte — strukturierte Lagevorträge (LFH-48)

**Teilprojekt:** 4 „Lage". Ergänzt das bestehende Lage-Modul (Lagekarte L‑1/L‑2/L‑3,
künftig Dashboard, Kräfteübersicht) um **strukturierte Lageberichte** — bislang nur
Platzhalter (`status: 'geplant'`) in `frontend/src/einsatz/modulRegistry.ts`.

**ClickUp:** LFH-48 (Sub-Task von LFH-44 „Lage – Ausbau"). Befehlsgebung
(LAD/LADEF/SCHNEE/EA-ZMW) ist **bewusst abgespalten** in einen eigenen Task
(„Befehle/Befehlsgebung", `auftraege`-Modul) — siehe Nicht-Ziele.

**Unterbau (wiederverwendet, nicht neu gebaut):**
- ETB-Append-Pfad (`src/etb/`) — der freigegebene Bericht wird als unveränderlicher
  ETB-Eintrag (`typ='lage'`) gesnapshottet.
- Sub-Entity-Vorbild `src/einsatzabschnitt/` (`mod.rs` + `repo.rs`) für eine
  einsatz-skopierte Tabelle mit Routen.
- `LiveHub` (`src/live/`) für SSE-Live-Updates pro Einsatz.
- Rollen-/Nachlauf-Gate (`src/einsatz/berechtigung.rs`).
- Modul-Registry + „disabled statt versteckt"-Muster (`frontend/src/einsatz/modulRegistry.ts`).
- ETB-Frontend `frontend/src/pages/EtbPage.tsx` als Verlinkungs-/Einstiegspunkt.

---

## Ziel

Eine Führungskraft (bzw. ein mitschreibender Mitarbeiter im FüKw) kann den Stand aus einer
**Lagebesprechung** als **strukturierten Lagebericht** erfassen — komfortabler und gegliederter
als ein freier ETB-Eintrag. Der fertige Bericht wird **freigegeben**, erscheint **vollständig
und unveränderlich im ETB** und lässt sich **strukturiert anzeigen und drucken / als PDF
speichern**. Fortschreibungen bilden eine nachvollziehbare Versionskette.

## Architektur in einem Satz

Ein eigenes, einsatz-skopiertes **`lagebericht`-Entity** trägt den editierbaren Arbeits- und
Versionsstand (Entwurf → freigegeben); bei **Freigabe** wird der serverseitig gerenderte
Bericht als unveränderlicher **Snapshot in einen `etb_eintrag` (`typ='lage'`)** geschrieben —
der ETB bleibt der manipulationssichere Rechtsstand, das Entity der strukturierte
Arbeitsspeicher.

## Scope-Entscheidungen (v1)

1. **Eigenes Entity + ETB-Snapshot** (nicht: Bericht direkt im append-only `etb_eintrag`).
   Begründung: Entwürfe, iteratives Bearbeiten und eine Versionskette brauchen einen
   editierbaren Speicher; das ETB ist beim Insert append-only/immutable.
2. **Voller Bericht inline im ETB.** Bei Freigabe wird der gerenderte Volltext in
   `etb_eintrag.inhalt` geschrieben — in der ETB-Timeline vollständig lesbar, unveränderlich.
   Kein toter Link.
3. **Vorlagen fest in Code** (eine Schema-Registry analog `modulRegistry`), **nicht** über ein
   Admin-Panel konfigurierbar. Strukturierte Formulare + strukturiertes Rendering pro Schema
   lassen sich nicht sinnvoll frei konfigurieren. Org-Konfigurierbarkeit ist eine spätere
   Ausbaustufe (Nicht-Ziel v1).
4. **Inhalt ist Mitschrift, nicht generiert.** Berichte stammen aus Lagebesprechungen und sind
   überwiegend manueller Text. Keine Auto-Aggregation von Kennzahlen aus Einsatzdaten — das ist
   die Abgrenzung zum (separaten) Lage-Dashboard.
5. **Druck/PDF via Browser-Print** (dedizierte Print-Ansicht + Print-CSS → Browser-Dialog
   „Drucken / als PDF speichern"). Keine Server-PDF-Pipeline (passt zu Offline/Self-Host; keine
   PDF-Infrastruktur vorhanden).
6. **Korrektur = Fortschreibung.** Ein freigegebener Bericht ist immutable; eine Korrektur ist
   eine neue Version, die auf die vorige zeigt und bei eigener Freigabe einen eigenen
   ETB-Eintrag erzeugt.

## Berichtsvorlagen (v1, fest in Code)

Quelle: Führungsvorgang / Sonderformen der Kommunikation (Lagevortrag).

**`lagebericht` — Lagevortrag zur Information** (7 Abschnitte):
Auftrag · Gefahren-/Schadenlage · Eigene Lage · Lageentwicklung ·
Besondere (Führungs-)Probleme · Anträge und Vorschläge · Zusammenfassung

**`lagebeurteilung` — Lagevortrag zur Entscheidung** (8 Abschnitte):
Auftrag · Anlass des Lagevortrags · Beurteilung der Schadenlage · Beurteilung der eigenen Lage ·
Gemeinsame Elemente aller Möglichkeiten · Entschlussvorschläge · Abwägen der Möglichkeiten ·
Vorschlag der besten Möglichkeit

**`freitext` — freier Bericht** (1 Abschnitt): ein einzelnes Freitextfeld.

Jede Vorlage ist eine Definition `{ schluessel, label, abschnitte: [{schluessel, label}] }`.
Die Registry lebt sowohl im Frontend (Formular/Anzeige) als auch im Backend (Render +
Validierung der Abschnitts-Schlüssel) — beide synchron halten (gleiches Muster wie
`etb_baustein/mod.rs` ↔ Migration-Seed).

## 1. Datenmodell — `migrations/0038_lagebericht.sql`

```sql
CREATE TABLE lagebericht (
    id                INTEGER PRIMARY KEY,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vorlage           TEXT NOT NULL
                      CHECK (vorlage IN ('lagebericht','lagebeurteilung','freitext')),
    titel             TEXT NOT NULL,
    zeitstand         TEXT NOT NULL,            -- beschriebener Lage-Zeitpunkt (default jetzt)
    status            TEXT NOT NULL DEFAULT 'entwurf'
                      CHECK (status IN ('entwurf','freigegeben')),
    -- Gefüllte Abschnitte als JSON-Array [{schluessel, text}], Reihenfolge = Vorlage.
    abschnitte        TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    vorgaenger_id     INTEGER REFERENCES lagebericht(id),  -- Fortschreibungs-Kette
    ersteller_id      INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    freigegeben_von_id INTEGER REFERENCES benutzer(id),
    freigegeben_at    TEXT,
    etb_eintrag_id    INTEGER REFERENCES etb_eintrag(id)   -- gesetzt bei Freigabe
);

CREATE INDEX idx_lagebericht_einsatz ON lagebericht(einsatz_id, status, zeitstand);
```

**Additive Mini-Migration auf `etb_eintrag`** (für Badge/Rückverlinkung in der ETB-Timeline):

```sql
ALTER TABLE etb_eintrag ADD COLUMN lagebericht_id INTEGER REFERENCES lagebericht(id);
```

`abschnitte` als JSON (nicht eigene Tabelle): die Abschnitte werden immer komplett gelesen und
geschrieben, ihre Struktur ergibt sich aus `vorlage`. Eine Zeile pro Abschnitt brächte keinen
Abfrage-Nutzen, nur Join-Aufwand.

## 2. Lebenszyklus & Versionierung

- **Entwurf anlegen** (`POST …/lageberichte`): Vorlage wählen, leere Abschnitte gem. Schema,
  `zeitstand` default = jetzt, `status='entwurf'`.
- **Entwurf bearbeiten** (`PATCH …/{id}`): nur erlaubt solange `status='entwurf'`. Aktualisiert
  Abschnitte/Titel/Zeitstand, setzt `aktualisiert_at`. Live-Update über `LiveHub`.
- **Freigeben** (`POST …/{id}/freigeben`):
  1. Validieren: alle Pflicht-Abschnitt-Schlüssel der Vorlage vorhanden; Bericht nicht leer.
  2. Bericht **serverseitig deterministisch rendern** (Titel + Zeitstand + Abschnitte als
     Markdown/Text).
  3. `etb_eintrag` schreiben: `typ='lage'`, `inhalt=<Render>`, `ereigniszeit=zeitstand`,
     `erfasser_id=<Freigeber>`, `lagebericht_id=<id>` — über den bestehenden ETB-Append-Pfad
     (`src/etb/`), inkl. server-autoritativer `lfd_nr`.
  4. `lagebericht`: `status='freigegeben'`, `freigegeben_von_id`, `freigegeben_at`,
     `etb_eintrag_id` setzen. Danach **immutable** (kein weiteres PATCH).
- **Fortschreiben** (`POST …/{id}/fortschreiben`): nur aus einem freigegebenen Bericht. Legt
  eine neue `lagebericht`-Zeile an, `status='entwurf'`, `version = vorige+1`,
  `vorgaenger_id = <id>`, Abschnitte aus der Vorlage vorbefüllt. Eigene Freigabe → eigener
  ETB-Eintrag.

Korrektur eines bereits freigegebenen Berichts läuft ausschließlich über Fortschreibung — es
gibt kein In-Place-Edit und keinen separaten Berichtigungs-Typ (das ETB trägt den Verlauf
ohnehin chronologisch).

## 3. ETB-Integration

- **Snapshot:** wie in §2 beschrieben — voller Bericht inline, unveränderlich.
- **Timeline-Darstellung:** ETB-Einträge mit `lagebericht_id` zeigen ein Badge
  „Lagebericht (Vorlage, Version N)" mit Link ins Lagebericht-Modul. Der Inhalt selbst ist
  bereits der Volltext, also auch ohne Modul lesbar/durchsuchbar (FTS greift auf `inhalt`).
- **Einstieg aus dem ETB:** In der ETB-Schnellerfassung erhält der Eintragstyp **`lage`** einen
  sekundären Button **„Als strukturierten Lagebericht erfassen"**, der in den Lagebericht-Editor
  führt. Kurze `lage`-Vermerke bleiben unverändert direkt im ETB möglich — der Lagebericht ist
  das Angebot für den *strukturierten* Fall, kein Zwang.

## 4. Berechtigungen

Wiederverwendung von `src/einsatz/berechtigung.rs` und des Frontend-Gates
(`istModulGesperrt`).

| Aktion | Recht |
|---|---|
| Liste/Detail lesen | jede Einsatz-Rolle (inkl. Beobachter) |
| Entwurf anlegen/bearbeiten | Führungskraft / Einsatzleitung / Admin |
| Freigeben / Fortschreiben | Führungskraft / Einsatzleitung / Admin |

Schreibzugriff respektiert das bestehende **Nachlauf-Gate** (kein Schreiben nach
Einsatz-Abschluss). **Festlegung:** Der Modul-Eintrag erhält **keine** `benoetigteRolle`
(Lesen für alle, inkl. Beobachter); die Schreibrechte (Entwurf/Freigabe/Fortschreiben nur für
Führung) greifen auf Routen- und Button-Ebene.

## 5. Backend — `src/lagebericht/` (`mod.rs` + `repo.rs`)

Nach dem Muster `src/einsatzabschnitt/`:
- `repo.rs`: CRUD auf `lagebericht`, Freigabe-Transaktion (Render + ETB-Append + Status-Update
  atomar), Fortschreibe-Anlage.
- `mod.rs`: Vorlagen-Registry (Schlüssel/Labels/Abschnitte), deterministisches Render
  (`render_snapshot(&Lagebericht) -> String`), Validierung der Abschnitts-Schlüssel.
- Routen in `src/routes/` (analog bestehender Einsatz-Sub-Routen), gemountet unter
  `/api/einsaetze/{id}/lageberichte`:
  `GET` (list), `GET /{id}`, `POST`, `PATCH /{id}`, `POST /{id}/freigeben`,
  `POST /{id}/fortschreiben`.
- Live: nach jeder schreibenden Aktion ein `LiveHub`-Event pro Einsatz.

> **Org-Lesezugriff:** Alle Routen prüfen Einsatz-Zugehörigkeit/Org wie die übrigen
> Einsatz-Sub-Routen — kein neuer Cross-Org-Pfad (vgl. bekannte Org-Isolations-Sensitivität).

## 6. Frontend — `frontend/src/pages/LageberichtePage.tsx`

- Modul-Registry: `lageberichte` von `status: 'geplant'` → `'fertig'`.
- **Liste:** Berichte des Einsatzes (Status-Badge Entwurf/Freigegeben, Vorlage, Zeitstand,
  Version/Fortschreibungs-Kette), Aktion „Neuer Bericht" (Vorlagenauswahl).
- **Editor:** Antd-Formular, ein Textbereich je Abschnitt der gewählten Vorlage (bzw. ein
  Feld bei Freitext) + Titel + Zeitstand. „Entwurf speichern" und „Freigeben"
  (Bestätigungsdialog: Freigabe ist endgültig, erzeugt ETB-Eintrag).
- **Detailansicht:** strukturierte Read-Only-Darstellung; bei freigegebenen Berichten Link zum
  ETB-Eintrag und „Fortschreiben".
- **Druck:** dedizierte Print-Ansicht + Print-CSS; Button „Drucken / als PDF" öffnet den
  Browser-Druckdialog.
- Live-Aktualisierung über den bestehenden Einsatz-SSE-Stream (`useEinsatzLiveStream` — **eine**
  Verbindung pro Einsatz, keine zusätzliche EventSource).
- Vorlagen-Registry als reine, unit-testbare Datenstruktur (gleiches Schema wie Backend).
- **Frontend ist ins Binary eingebettet** → nach Frontend-Änderungen `pnpm build` + Backend
  neu starten, sonst zeigt cargo-run das alte Bundle.

## 7. Tests

- **Backend:** Entwurf-CRUD; Freigabe schreibt genau einen `etb_eintrag` (`typ='lage'`,
  korrekte `lfd_nr`, Inhalt = Render); freigegebener Bericht ist nicht mehr patchbar (→ Fehler);
  Fortschreibung erzeugt Version 2 mit `vorgaenger_id`; Render deterministisch; Validierung
  fehlender Pflicht-Abschnitte; Rechte (Beobachter darf lesen, nicht schreiben/freigeben);
  Nachlauf-Gate.
- **Frontend:** Vorlagen-Registry/Render-Helfer (pur); Editor rendert Abschnitte je Vorlage;
  Freigabe-Bestätigung; Liste mit Status-Badges; Print-Ansicht.
- Test-Setup beachtet das `localStorage`-Polyfill (`src/test/setup.ts`); volle Suite ggf.
  `--no-file-parallelism`.

## Nicht-Ziele (v1)

- **Befehlsgebung** (LAD/LADEF/SCHNEE/EA-ZMW) — eigener Task „Befehle/Befehlsgebung"
  (`auftraege`-Modul). Soll dieselbe Mechanik (Entity, Entwurf/Freigabe, ETB-Snapshot, Druck)
  wiederverwenden; **jetzt keine spekulative Abstraktion** dafür bauen — bei Landung des Tasks
  refactoren.
- **Org-konfigurierbare Vorlagen / Admin-Panel** (analog ETB-Schnellbausteine) — spätere
  Ausbaustufe.
- **Server-seitige PDF-Pipeline** — Browser-Print genügt.
- **Auto-Aggregation** von Kennzahlen/Lagebild in den Bericht — bewusst manuell.
- **Mehr-Personen-gleichzeitig-Editing** mit Konfliktauflösung — v1: einfacher
  Last-Write/Entwurf, Live-Sichtbarkeit reicht.

## Offene Punkte / bewusste Festlegungen

- **Zeitstand vs. Freigabezeit:** `zeitstand` = beschriebener Lage-Zeitpunkt (Sortierung/ETB
  `ereigniszeit`); `freigegeben_at`/ETB `received_at` = wann freigegeben. Bewusst getrennt.
- **Render-Format:** Markdown im `etb_eintrag.inhalt` (ETB rendert bereits Text; Markdown bleibt
  auch roh lesbar und FTS-durchsuchbar). Festlegung: leichtes Markdown (Abschnitts-Überschriften
  + Absätze).
- **Leere Abschnitte bei Freigabe:** erlaubt (nicht jeder Abschnitt ist immer befüllt); nur der
  *gesamte* Bericht darf nicht leer sein. Pflicht ist die Abschnitts-*Struktur*, nicht der Inhalt
  jedes Felds.
