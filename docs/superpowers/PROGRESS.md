# lifeline-hub — Fortschritt & Roadmap

> **Für einen neuen Chat:** Diese Datei + die Spec genügen, um mit minimalem Kontext weiterzuarbeiten. Siehe „So startest du einen neuen Chat" am Ende.

## Was ist lifeline-hub

All-in-One-System für die Einsatzverwaltung weißer Hilfsorganisationen (Katastrophenschutz **und** täglicher Bereitschaftsdienst), vergleichbar mit Command X / Fireboard. Kern ist ein elektronisches Einsatztagebuch (ETB), erweitert um Fahrzeug-, Patienten- und Lageverwaltung. Echtes Einsatzprodukt, **self-hostbar** (lokal im ELW *oder* Cloud), Client verbindet sich zu konfigurierbarer Server-Adresse.

Vollständige Details: `docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md`.

## Tech-Stack (Kurz)

- **Backend:** Rust + Axum + SQLite (WAL, Foreign Keys), **Single-Binary mit statisch gebündeltem SQLite**, liefert Frontend mit aus.
- **Frontend (später):** React + **Ant Design v5** (PWA).
- **Live:** SSE (Server→Client) + POST (Client→Server).
- **Karte (später):** MapLibre GL. **Desktop/Mobile (später):** Tauri / Capacitor.

## Gesamt-Zerlegung (Teilprojekte)

```
FUNDAMENT (Server · Auth · Einsatz · Stammdaten · Live)
  └─▶ ① ETB-Kern                     ← Teilprojekt 1 (funktional fertig)
       ├─▶ ② Kräfte & Mittel         ← Teilprojekt 2 (Specs K&M‑1…4 vollständig)
       │      (Fahrzeuge · Personal · Einheiten · Material)
       ├─▶ ③ Erfassung               ← Teilprojekt 3 (aktuell)
       │      (Personen/Betroffene · Unfallhilfsstellen · Tiere · Schäden — sensible Daten)
       └─▶ ④ Lagekarte (visualisiert ①–③)
```

Jedes Teilprojekt bekommt einen eigenen Zyklus: Spec → Pläne → Umsetzung.

> **Reframing (2026-05-25):** Das Navigations-Redesign hat die Module in Kategorien
> gegliedert. Das alte T2 „Fahrzeug-/Einsatzmittelverwaltung" wird zur ganzen
> Kategorie **„Kräfte & Mittel"** geweitet. **Abrollbehälter** ist bewusst
> gestrichen (keine eigene Entity; bei Bedarf später wieder aufnehmbar — auch der
> geplante `modulRegistry`-Eintrag entfällt dann).

## Teilprojekt 1 — Plan-Sequenz (6 Pläne)

Jeder Plan ergibt für sich lauffähige, testbare Software und baut auf dem vorigen auf.

| # | Plan | Status |
|---|---|---|
| 1 | **Backend-Fundament** — Server-Skelett, Config (CLI/ENV), SQLite-Pool (WAL/FK), Migrationen, Router, `/api/health`, Graceful Shutdown (SIGINT/SIGTERM) | ✅ **DONE** — auf `main`, Commit `9440456` |
| 2 | **Auth & Benutzer/Org** — lokale Konten, Argon2-Hashing, Login/Sessions (httpOnly-Cookie), Admin-Bootstrap, Benutzerverwaltung; `error`-Modul (`AppError` + `IntoResponse`) | ✅ **DONE** — auf `main`, Commit `bfa047f` |
| 3 | **Einsatz & Rollen** — Einsatz-CRUD, Lebenszyklus (aktiv → abgeschlossen, read-only), Mitgliedschaften, Rollen (Admin/Einsatzleitung/Führungspersonal/Beobachter), Autorisierung | ✅ **DONE** — auf `main`, Commit `8d5cc46` |
| 4 | **ETB-Kern + Live + Suche** — append-only Einträge, server-autoritative `lfd_nr`, Berichtigungen, Drei-Zeitstempel-Modell (`ereigniszeit`/`received_at`/`erfasst_lokal_at`), SSE-Live, FTS5-Suche/Filter | ✅ **DONE** — Branch `worktree-feat+einsatz-rollen`, 136 Tests grün (Merge nach `main` ausstehend) |
| 5 | **Frontend (React + Ant Design PWA)** — Login, Einsatzauswahl, ETB-Ansicht, Schnellerfassung, SSE-Client, Offline-Queue (IndexedDB), Mitglieder-/Benutzerverwaltung | ✅ **DONE** — Branch `worktree-feat+einsatz-rollen`, Frontend unter `frontend/` |
| 6 | **Backup/Restore + Packaging** — Hot-Backup (`GET /api/backup` + CLI), Restore (CLI + Doku), Frontend-Embedding (rust-embed), Single-Binary-Build | ✅ **DONE** — Branch `worktree-feat+einsatz-rollen` |

**Bewusst später (nicht Teil von T1):** PDF-/Druck-Export (priorisiert für T1.1/T2), OIDC/SSO, MFA, Schnellbausteine, Server-Discovery (QR/mDNS).

## Teilprojekt 2 — „Kräfte & Mittel" — Spec-Sequenz

Org-globaler Ressourcen-Stamm + **Disposition** in den Einsatz (Auswahl/Aktivierung
aus dem Pool + Ad-hoc-externe Kräfte). K&M‑1 legt die generische Mechanik und zieht
sie konkret für Fahrzeuge durch; K&M‑2/3/4 verwenden dieses Pattern wieder. Jede Spec
wird einzeln durchgebrainstormt (eigener Zyklus Spec → Plan → Umsetzung).

| # | Spec | Liefert | Abhängigkeit | Status |
|---|---|---|---|---|
| K&M‑1 | **Stammdaten & Disposition — am Beispiel Fahrzeuge** | Generische Mechanik + Fahrzeuge: Stamm-CRUD im globalen Stammdaten-Bereich, Disposition im Einsatz, Ad-hoc-externe Fahrzeuge | — (Unterbau) | 📝 Design abgestimmt → Plan als Nächstes |
| K&M‑2 | **Personal** | Personal-Stamm + Disposition (reuse der Mechanik) | K&M‑1 | 📝 Design abgestimmt → Plan als Nächstes |
| K&M‑3 | **Einheiten (taktische Einheiten)** | Komponiert Personal + Fahrzeuge, Zuordnung zu Einsatzabschnitt | **K&M‑1 + K&M‑2 (Zwang)** | ✅ im Code (Migr. `0014`–`0017`, `src/einheit/`) |
| K&M‑4 | **Material** | Material-Stamm + Disposition + Material→Einheit-Zuordnung | K&M‑1 (+ K&M‑3 für Einheit-Zuordnung) | 📝 Design abgestimmt → Plan als Nächstes |

**Harte Reihenfolge:** Einheiten *muss* nach Personal **und** Fahrzeugen kommen — eine taktische Einheit bündelt Führer + Mannschaft + Fahrzeug, die vorher existieren müssen. Material-Stamm + Disposition hängen nur am Unterbau (K&M‑1); die **Material→Einheit-Zuordnung** (K&M‑4-Scope, abgestimmt 2026-05-27) setzt zusätzlich K&M‑3 voraus — das ist bereits gebaut.

**Dispositions-Modell (abgestimmt, gilt für alle K&M‑Module):** Referenz aus dem globalen Stamm-Pool + Einsatz-Zustand obendrauf (kein Voll-Snapshot, keine Stamm-Versionierung). Zwei Schutzmechanismen für die Nachvollziehbarkeit: (1) **kein Hard-Delete** im Stamm — Ressourcen werden nur „außer Dienst" gesetzt, damit alte Referenzen auflösbar bleiben; (2) **Identitäts-Schnappschuss** in der Dispositionszeile (z. B. Funkrufname/Kennzeichen zum Dispo-Zeitpunkt). Dispo-/Status-Ereignisse werden zusätzlich als **ETB-Einträge** mitgeschrieben (inkl. Ressourcen-Identität) — das ist die unveränderliche Historie.

**Spec K&M‑1:** `docs/superpowers/specs/2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md`
**Spec K&M‑2:** `docs/superpowers/specs/2026-05-26-kraefte-mittel-personal-disposition-design.md`
**Spec K&M‑3:** `docs/superpowers/specs/2026-05-26-kraefte-mittel-einheiten-abschnitte-design.md`
**Spec K&M‑4:** `docs/superpowers/specs/2026-05-27-kraefte-mittel-material-disposition-design.md`

## Teilprojekt 3 — „Erfassung" — Spec-Sequenz

Die Kategorie **Erfassung** (Navigations-Redesign) erfasst die im Einsatz betroffenen
Subjekte/Objekte: Personen/Betroffene, Tiere, Schäden — plus **Unfallhilfsstellen** als
deren örtliche Struktur. **Neu gegenüber T1/T2: sensible Personendaten** (medizinische
Sichtung, DSGVO-besondere Kategorie, Lösch-/Aufbewahrungspflichten). Das K&M-Prinzip
„alle Berechtigten lesen alles" trägt hier nicht — das **Zugriffs-/Audit-/Retention-Modell**
wird in der ersten Spec (E‑1) gebaut und von E‑2…E‑5 wiederverwendet (analog wie K&M‑1
die generische Mechanik legte). Jede Spec wird einzeln durchgebrainstormt.

| # | Spec | Liefert | Abhängigkeit | Status |
|---|---|---|---|---|
| E‑1 | **Personen-Fundament + Erfassung** | Personen-Entity, Status-Lebenszyklus (vermisst → betroffen → Patient SK I–IV → verstorben), Basis-Erfassung, ETB-Integration **+ sensible-Daten-Zugriffs-/Audit-/Retention-Modell** | — (Unterbau) | ✅ **DONE** — Plan `docs/superpowers/plans/2026-05-27-erfassung-personen-fundament.md`, PersonenPage + Tests, Modul aktiviert |
| E‑2 | **Sichtung & medizinischer Verlauf** | Sichtungskategorien SK I–IV/tot/unverletzt (Verlauf + Cache), Befund-/Verlaufsnotiz (append-only), Transport/Verbleib (KH=Freitext), Vermisstenabgleich (Verdacht→bestätigt) | E‑1 | ✅ **DONE** — Plan `docs/superpowers/plans/2026-05-27-erfassung-sichtung-medizinischer-verlauf.md` |
| E‑3 | **Unfallhilfsstellen** | Örtlichkeits-/Struktur-Stamm (Patientenablage, Behandlungsplatz, Verletztensammelstelle); Personen-Zuordnung | E‑1 | ✅ **DONE** — Plan `docs/superpowers/plans/2026-05-28-erfassung-unfallhilfsstellen.md` |
| E‑4 | **Tiere** | Eigener Stamm + Status (eigene Spec — Tiere kommen vor) | E‑1-Foundation | geplant |
| E‑5 | **Schäden** (allgemein) | Schadensobjekte/-stellen: Art, Ort, Ausmaß, Status (Sach-/Infrastruktur-/Umweltschäden); **kein** Karten-Rendering (→ T4), **keine** Gefahren-/Absperrzonen (→ Lage) | E‑1-Foundation | geplant |

**Bindendes Personen-Konzept (aus Navigations-Spec):** Personen = EIN Stamm mit
Status-Lebenszyklus; dieselbe physische Person wandert durch die Zustände (ein Modul
mit gefilterten Sichten, kein Modul je Status). Unfallhilfsstellen (Örtlichkeit) und
Tiere bleiben davon getrennt.

## Querschnittliche Folge-Idee — Daten-Retention abgeschlossener Einsätze (Backlog)

Idee (2026-05-25): Abgeschlossene Einsätze nach einer Frist (z. B. 24 h) auf das rechtlich/fachlich Nötige eindampfen — **ETB** (append-only) + **generierter PDF-Report** (selbsttragendes Rechtsdokument, inkl. Lagebild) — statt den vollen App-Zustand (Dispositionen, Listen, …) dauerhaft vorzuhalten. Spart Daten und umgeht die „welches Fahrzeug war das"-Frage, weil die Identität bereits in ETB/Report steht.

**Abhängigkeit:** setzt den PDF-/Druck-Report voraus (bereits als „priorisiert für T1.1/T2" vermerkt) → eigene, spätere Querschnitts-Spec. **Implikation für K&M‑1:** Dispositions-/Status-Ereignisse als ETB-Einträge mitschreiben (inkl. Fahrzeug-Identität), damit ETB+Report nach dem Eindampfen selbsttragend bleiben.

## Arbeitsweise / Konventionen

- **Ablauf je Plan:** writing-plans (Bite-Sized-TDD) → subagent-driven-development: pro Task ein Implementer-Subagent, danach Spec-Compliance-Review + Code-Quality-Review (mit Fix-Schleifen), am Ende ein finaler Gesamt-Review.
- **Pläne phasenweise schreiben** — jeweils erst vor der Umsetzung, damit Erkenntnisse einfließen.
- **Umsetzung in isoliertem Worktree** (nicht direkt auf `main`).
- **Commits** enden mit `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Fachsprache:** BOS-/Führungs-Begriffe verwenden (Einsatzleitung, Führungspersonal, Einsatztagebuch, Lage), keine generischen Dev-Namen wie „Schreiber".

## Dateien

- Spec (T1): `docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md`
- Plan 1 (DONE): `docs/superpowers/plans/2026-05-23-backend-fundament.md`
- Plan 2 (DONE): `docs/superpowers/plans/2026-05-23-auth-benutzer-org.md`
- Plan 3 (DONE): `docs/superpowers/plans/2026-05-23-einsatz-rollen.md`
- Plan 4 (DONE): `docs/superpowers/plans/2026-05-23-etb-kern-live-suche.md`
- Plan 5 (DONE): `docs/superpowers/plans/2026-05-23-frontend-react-antd-pwa.md`
- Plan 6 (DONE): `docs/superpowers/plans/2026-05-24-backup-restore-packaging.md`
- Betriebsdoku: `docs/betrieb/packaging.md`, `docs/betrieb/backup-restore.md`
- Diese Roadmap: `docs/superpowers/PROGRESS.md`

## So startest du einen neuen Chat

Minimaler Einstieg, z.B.:

> „Lies `docs/superpowers/PROGRESS.md` und die T1-Spec. Schreibe als Nächstes **Plan 6 (Backup/Restore + Packaging)** im writing-plans-Bite-Sized-TDD-Format und setze ihn anschließend subagent-getrieben um."

Der aktuelle Code-Stand: Pläne 1–3 auf `main`; Pläne 4–6 auf Branch `worktree-feat+einsatz-rollen` (Merge nach `main` ausstehend). **Teilprojekt 1 ist damit funktional vollständig** (Server, Auth, Einsatz, ETB-Kern, Frontend, Backup/Restore, Single-Binary mit eingebettetem Frontend). Backend-Tests grün; `scripts/build-release.sh` erzeugt erfolgreich eine ~8,4 MB Single-Binary mit eingebettetem Frontend. **Nächster Schritt: Merge nach `main`, danach Spec + Pläne für Teilprojekt 2 (Fahrzeug-/Einsatzmittelverwaltung).** Nach jedem fertigen Plan diese Tabelle hier aktualisieren.
