# Einsatzinterner Chat (LFH-50) — Design

**Task:** LFH-50 · Chat (einsatzinterner Chat) — Untermodul der Initiative LFH-45
**Status:** Design freigegeben (2026-06-10)
**Ausbaustufe:** 2

## Zweck & Abgrenzung

Niederschwellige, schnelle interne Abstimmung innerhalb des Stabes / zwischen Funktionen
(z. B. S2↔S3-Rückfrage), die **keinen** Befehls- oder Meldungscharakter hat. Bewusst
abgegrenzt von formalen Aufträgen/Meldungen — **kein** Quittierungs-/Vollzugs-Workflow.

Chat ist einsatzintern (pro Einsatz, nicht einsatzübergreifend) und live über den
bestehenden LiveHub (eine Verbindung pro Einsatz).

**Verbindlichkeit entsteht ausschließlich durch Heraufstufen:** Eine relevante Nachricht
wird per Klick zu einem ETB-Eintrag überführt; nur dann landet sie dokumentiert. Chat
erzeugt **keinen** automatischen ETB-Eintrag.

## Scope (MVP)

**Enthalten:**

- Kanäle pro Einsatz, frei anlegbar; Auto-Default „Allgemein"
- Nachrichten pro Kanal (Felder: Kanal, Autor, Zeit, Text)
- Live-Aktualisierung über den bestehenden Einsatz-LiveHub
- Rollen: Schreiben = Leitung/Führungspersonal, Beobachter lesen mit
- Heraufstufen einer Nachricht → ETB-Eintrag (transaktional, mit Rückverweis & Markierung)
- Autor darf eigene Nachrichten bearbeiten und soft-löschen

**Bewusst ausgegliedert (Schema nur erweiterbar halten):**

- Optional Anhang → **LFH-102** (keine Datei-Upload-/Storage-Infrastruktur vorhanden)
- Optional Bezug (Meldung/Auftrag/Lageobjekt) → **LFH-103** (polymorphes Referenzmodell;
  Meldung/Auftrag-Module existieren noch nicht)
- Heraufstufen zu Auftrag → **LFH-101** (Auftrag-Modul existiert noch nicht)
- Quittierungs-/Vollzugs-Workflow, automatischer ETB-Eintrag, Volltextsuche (FTS)

## Akzeptanzkriterien (aus dem Task)

1. Stabsmitglieder können je Kanal schnell abstimmen, Beobachter lesen mit.
2. Eine relevante Chat-Nachricht ist zu einem ETB-Eintrag heraufstufbar; Verbindliches
   landet damit dokumentiert.
3. Chat erzeugt keinen automatischen ETB-Eintrag (nur bei Heraufstufung).

## Architektur

Das Modul folgt dem bestehenden vertikalen Muster (ETB / Lagebericht als Blaupause):
Domain (`src/chat/mod.rs`) → Repository (`src/chat/repo.rs`) → Routes
(`src/routes/chat.rs`) → Migration → Frontend-Modul (`frontend/src/chat/`).

### Datenmodell (neue Migration `migrations/00xx_chat.sql`, SQLite)

```sql
CREATE TABLE chat_kanal (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    beschreibung    TEXT,
    erstellt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    archiviert_at   TEXT
);
CREATE INDEX idx_chat_kanal_einsatz ON chat_kanal(einsatz_id);

CREATE TABLE chat_nachricht (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    kanal_id       INTEGER NOT NULL REFERENCES chat_kanal(id) ON DELETE CASCADE,
    autor_id       INTEGER NOT NULL REFERENCES benutzer(id),
    inhalt         TEXT    NOT NULL,
    erstellt_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    bearbeitet_at  TEXT,
    geloescht_at   TEXT,
    -- Heraufstufungs-Rückverweis (NULL = reine Chat-Nachricht)
    etb_eintrag_id INTEGER REFERENCES etb_eintrag(id)
);
CREATE INDEX idx_chat_nachricht_kanal ON chat_nachricht(kanal_id, id DESC);
```

Designentscheidungen:

- **Default-Kanal lazy:** Der Kanal „Allgemein" wird server-seitig beim Listen der Kanäle
  sichergestellt (angelegt, falls für den Einsatz noch kein Kanal existiert). Das deckt
  Bestands-Einsätze ohne Backfill-Migration ab und koppelt den Chat nicht an die
  Einsatz-Anlageroute.
- **Soft-Delete via `geloescht_at`:** gelöschte Nachrichten bleiben als Tombstone erhalten
  (Anzeige „Nachricht gelöscht"); heraufgestufte Nachrichten bleiben über `etb_eintrag_id`
  nachvollziehbar.
- **Cursor-Pagination über `id`** (absteigend), analog ETB. Kein FTS im MVP.
- Kanäle/Nachrichten sind erweiterbar: Anhang (LFH-102) und polymorpher Bezug (LFH-103)
  docken später an `chat_nachricht` an, ohne Bruch.

### Backend (`src/chat/`, `src/routes/chat.rs`)

Routen unter `/api/einsaetze/{id}/chat`:

| Methode + Pfad | Recht | Zweck |
|---|---|---|
| `GET  /chat/kanaele` | Lesen (inkl. Beobachter) | Kanäle listen, Default sicherstellen |
| `POST /chat/kanaele` | Schreiben + aktiv | Kanal anlegen |
| `GET  /chat/kanaele/{kid}/nachrichten` | Lesen | Nachrichten paginiert (Cursor `before_id`) |
| `POST /chat/kanaele/{kid}/nachrichten` | Schreiben + aktiv | Nachricht senden |
| `PATCH  /chat/nachrichten/{mid}` | Schreiben + Autor | Eigene Nachricht bearbeiten |
| `DELETE /chat/nachrichten/{mid}` | Schreiben + Autor | Eigene Nachricht soft-löschen |
| `POST /chat/nachrichten/{mid}/heraufstufen-etb` | Schreiben + aktiv | Nachricht → ETB-Eintrag |

- **Rollen-Gates** wie bestehend: `fordere_lesezugriff` (Lesen, inkl. Beobachter & DSGVO-/
  Schonfrist-Regeln), `fordere_schreibrecht` (Leitung/Führung), `fordere_aktiv` (nur aktive
  Einsätze beim Schreiben). Autor-Prüfung für PATCH/DELETE zusätzlich.
- **Autor** = eingeloggter Benutzer (`CurrentUser`-Extractor, `benutzer.id`), wie bei ETB
  `erfasser_id`.
- **Live:** kein eigener SSE-Endpoint. Schreibende Operationen publizieren über den
  bestehenden Einsatz-Hub: `state.live.publiziere_event(einsatz_id, "chat", json)`. Das
  hält „eine Verbindung pro Einsatz" ein.

### Heraufstufen → ETB

Muster = Lagebericht-Freigabe (`src/lagebericht/repo.rs::freigeben()`):

1. UI-Modal: ETB-Typ wählen (`meldung` / `anordnung` / `lage` / `entscheidung`), Text
   vorbefüllt aus der Nachricht (editierbar).
2. Transaktion: ETB-Eintrag anlegen (`anlegen_tx`, `erfasser_id` = aktueller User,
   `inhalt` = übergebener Text) → `chat_nachricht.etb_eintrag_id` setzen → COMMIT/ROLLBACK.
3. `chat`- und `etb`-Event publizieren.

Regeln:

- Eine Nachricht ist **nur einmal** heraufstufbar (`etb_eintrag_id IS NULL` als Guard →
  sonst 409/422).
- Nachricht trägt sichtbar die Markierung „heraufgestuft zu ETB #lfd_nr" mit Deep-Link
  ins ETB.

### Frontend (`frontend/src/chat/`)

Route `chat` ist im `modulRegistry` bereits angelegt (Kategorie `kommunikation`); Status
wird nach Umsetzung auf `fertig` gesetzt.

Komponenten / Hooks:

- `ChatSeite.tsx` — Layout: Kanal-Sidebar + Nachrichtenstrom + Eingabe.
- `KanalListe.tsx`, `NachrichtenStrom.tsx`, `NachrichtEingabe.tsx`.
- `HeraufstufenModal.tsx` — ETB-Typ-Auswahl + Text.
- `useChatKanaele.ts` (`['chat-kanaele', einsatzId]`), `useChatNachrichten.ts`
  (`['chat', einsatzId, kanalId]`), `useChatMutations.ts` (senden/bearbeiten/löschen/
  heraufstufen).
- `"chat"`-Event in `useEinsatzLiveStream` einklinken → invalidiert `['chat-kanaele', id]`
  und `['chat', id]`. Kein separater EventSource.
- Beobachter: Eingabe/Kanal-anlegen ausgeblendet, Strom lesbar (`disabled statt
  versteckt`-Grundsatz beachten, wo passend).

## Fehlerbehandlung

- Schreiben in abgeschlossenem Einsatz → `fordere_aktiv` → 409/422.
- Lesen ohne Berechtigung → `fordere_lesezugriff` → 403.
- PATCH/DELETE fremder Nachricht → 403.
- Doppeltes Heraufstufen → 409/422.
- Pufferüberlauf im Live-Stream → bestehendes `lagged`-Resync (Query-Invalidierung).

## Teststrategie (TDD)

**Backend (Rust):**

- Repo: `anlegen` (Nachricht/Kanal), Default-Kanal-Sicherstellung, Pagination
  (`before_id`), Soft-Delete, Heraufstufen-Transaktion (ETB-Eintrag + Rückverweis gesetzt),
  Doppel-Heraufstufen-Guard, Rollback bei Fehler.
- Routes: Rollen-Gates (Beobachter darf lesen, nicht schreiben), Aktiv-Gate,
  Autor-Gate (PATCH/DELETE), Heraufstufen erzeugt ETB-Eintrag + Markierung.

**Frontend (Vitest):**

- Strom rendert Nachrichten; Senden ruft Mutation + invalidiert Query.
- Heraufstufen-Modal: Typ-Auswahl, Absenden.
- Beobachter-Sicht: keine Eingabe, Strom sichtbar.
- Live-Event `chat` invalidiert die richtigen Queries.

## Referenzen

- LiveHub: `src/live/mod.rs` (`publiziere_event`, `abonniere`)
- Vertikale Blaupause: `src/etb/`, `src/routes/etb.rs`, `migrations/0004_etb.sql`
- Heraufstufen-Muster: `src/lagebericht/repo.rs::freigeben()`, `migrations/0038_lagebericht.sql`
- Rollen: `src/einsatz/berechtigung.rs` (`fordere_lesezugriff`/`fordere_schreibrecht`/`fordere_aktiv`)
- Frontend-Hooks: `frontend/src/etb/useEinsatzLiveStream.ts`, `frontend/src/etb/useEtbStream.ts`
- Modul-Registry: `frontend/src/einsatz/modulRegistry.ts` (Key `chat`)
- Follow-ups: LFH-101 (Heraufstufen→Auftrag), LFH-102 (Anhänge), LFH-103 (Bezug)
