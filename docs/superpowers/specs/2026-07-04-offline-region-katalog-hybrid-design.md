# Offline-Region-Katalog (Hybrid) + geführte Regions-Auswahl — Design (LFH-199)

## Kontext

`LFH-199` — „Offline-Region-Packs im Admin-UI bauen + Karten-Integration vereinfachen".
Nutzer-Bedürfnis: Nicht-CLI-Experten sollen **ohne CLI eine Offline-Region-Karte aufs Gerät
bringen**, und der Weg „wie kriege ich eine Region aufs Gerät" soll deutlich einfacher/klarer
werden.

**Vorentscheidung aus dem Brainstorming (entscheidet die ganze Architektur):**

1. **Richtung = kuratierter Download, KEIN serverseitiges In-App-Tiling.** Das Ziel-Bedürfnis
   ist „aus fertigen Regionen wählen", nicht „beliebige eigene Zuschnitte selbst bauen". Damit
   entfällt das schwere Tiling-Fass (JVM-Planetiler/Docker im Betrieb, Langläufer-Job-Queue,
   Mehr-GB-Zwischendaten, DoS/Ressourcen-Limits) vollständig — es bleibt beim Prinzip „alles
   in-App, kein Docker" (Serving) und der bau-zeitigen Toolchain (`karten-build/`).
2. **Granularität = grob & kuratiert (~5–20 Einträge):** DE gesamt + DACH/Nachbarländer +
   einzelne Bundesländer. Keine Landkreis-Ebene (~400) → einfache geführte Auswahl, keine
   Suche/Hierarchie nötig.
3. **Der Engpass ist „beides":** der Katalog ist zu dünn (nur DE) UND die Auswahl-UX ist
   unklar/nicht auffindbar.
4. **Katalog-Auslieferung = Hybrid** (kompiliert-in Default + optionales Remote-Manifest).

**Ausgangslage im Code (bereits vorhanden, wird wiederverwendet):**

- Vollständiger **Download-aus-Katalog/-URL-Manager**: Fortschritt/Abbruch (`src/karte/download.rs`,
  in-memory `FortschrittMap`), FSM + Persistenz (`src/karte/registry/repo.rs`,
  `karte_offline_karte`: `registriert/laedt/bereit/fehler`, partieller Unique-Index für genau
  eine aktive Basemap), In-Place-Hot-Swap, Crash-Recovery.
- Handler in `src/routes/karte.rs`: `offline_liste`, `offline_download`, `offline_registrieren`,
  `offline_aktivieren`, `offline_neu_laden`, `offline_abbrechen`, `offline_loeschen`,
  `offline_katalog`.
- Kompilierter Katalog `src/config.rs::default_offline_katalog()` (Vec, aktuell **ein** Eintrag
  „Deutschland (Shortbread)", sha256-pinbar — Pin-Mechanik seit LFH-197 vorbereitet).
- Admin-UI `frontend/src/karten/`: `OfflineKartenVerwaltung.tsx`, `OfflineDownloadKatalogModal.tsx`,
  `OfflineDownloadUrlModal.tsx`, API-Seam `frontend/src/api/offlineKarten.ts`.
- **Eigen-Mirror** (LFH-183, shipped) als Hosting-/Vertrauensanker-Grundlage.

Kern-Erkenntnis: „Region wählen → laden → aktivieren" **funktioniert mechanisch bereits** für
N Katalog-Einträge. Der Dev-Anteil von LFH-199 ist deshalb **Katalog erweitern (hybrid)** +
**Auswahl-UX führen/auffindbar machen** — nicht ein neuer Download- oder Bau-Subsystem.

## Architektur — Hybrid-Katalog (bewusst schlank)

Ziel: die Flexibilität des Remote-Manifests ohne die „maximale Komplexität".

### Zwei Quellen, eine Liste

- **Compiled-in Default** = `default_offline_katalog()`. Die sichere Baseline: immer präsent,
  jeder Eintrag sha256-gepinnt im Binary, funktioniert **ohne Netz**. Enthält nach diesem Task
  die ~5–20 kuratierten Regionen (als Platzhalter-Einträge, bis der Operator baut+hostet+pinnt
  — analog zum heutigen DE-Platzhalter, siehe LFH-197-Pin-Mechanik).
- **Optionales Remote-Manifest** = eine JSON-Datei **derselben Struktur** (`Vec<OfflineKatalogEintrag>`)
  an einer **kompilierten, gepinnten Mirror-URL** (Konstante, baut auf dem Eigen-Mirror LFH-183
  auf; **nicht** admin-konfigurierbar → keine SSRF-/Config-UI-Fläche). Der Server holt sie
  **best-effort** (nur wenn online), cached sie, und liefert die **Vereinigung** compiled-in ∪
  remote aus.

### Merge-Semantik

- Der `offline_katalog`-Handler gibt **compiled-in ∪ remote** zurück.
- **Override per `name`:** ein Remote-Eintrag mit gleichem `name` wie ein compiled-in Eintrag
  **ersetzt** diesen (erlaubt dem Operator, den DE-Platzhalter durch den echten Pin zu ersetzen,
  ohne App-Release). `name` ist die stabile, eindeutige Identität eines Katalog-Eintrags (der
  grobe `region`-Code darf sich über Einträge wiederholen und taugt daher nicht als Schlüssel).
  Remote-Einträge mit neuem `name` **ergänzen**.
- **Offline-Fallback:** schlägt der Fetch fehl (offline, 404, Timeout, Parse-Fehler, ungültiges
  Schema) → **nur** compiled-in ausliefern. Der Katalog/Offline-Betrieb bricht **nie** wegen des
  Manifests.
- **Cache:** das zuletzt erfolgreich geholte Manifest wird gecached (in-memory reicht; optional
  auf Platte im `karten_dir` für Neustart-Robustheit), damit `offline_katalog` nicht bei jedem
  Aufruf neu fetcht und ein kurzzeitiger Netz-Ausfall den Remote-Teil nicht sofort verliert.
  Cache-TTL klein halten (z. B. wenige Minuten) — der Katalog ändert selten.

### Trust-Modell (minimal)

- **Anker = Binary:** die Manifest-URL ist kompiliert (kein User-Input) → HTTPS-Transport vom
  vertrauenswürdigen Eigen-Mirror.
- **Download-Integrität bleibt per-Eintrag-`sha256`** (bestehende Mechanik in `download.rs`): der
  eigentliche Mehr-GB-MBTiles-Download wird gegen den Hash aus dem Katalog-Eintrag verifiziert —
  egal ob der Eintrag compiled-in oder aus dem Manifest kam. **Kein Manifest-Signing nötig.**
- **Konsistenz-Regel** (wie LFH-197): ein Eintrag ist entweder ungepinnter Platzhalter
  (`sha256: None`, TODO-URL) oder vollständig gepinnt (64-hex + echte URL). Halb-gepinnte
  Remote-Einträge werden beim Merge **verworfen** (nicht ausgeliefert), damit kein
  Eintrag-ohne-Integritätsprüfung ins UI gelangt.

### Reuse

Der gesamte Download-/Progress-/Registry-/Aktivierungs-/Hot-Swap-Pfad bleibt **unverändert**.
Betriebsnutzen: neue Region = Pack bauen+hosten + eine Manifest-Zeile am Mirror — **ohne
App-Release**.

## UX — geführte Regions-Auswahl

- Den bestehenden Katalog-Download-Weg (`OfflineDownloadKatalogModal`) in einen **geführten,
  auffindbaren Regions-Picker** ausbauen:
  - **Gruppierte** Darstellung (Liste/Karten): DE / DACH / Bundesländer. Gruppierung aus einem
    leichten Feld am Katalog-Eintrag (Vorschlag: `gruppe`/`tier`, optional; Fallback = ungruppiert).
  - Pro Region: Name, **Größe**, **Lizenz**, Status-Hinweis (verfügbar / schon geladen / Update
    verfügbar — Daten kommen aus `offline_liste`/Katalog), klare Aktion **„aufs Gerät laden"**
    (reuse `starteOfflineDownload`).
  - Kurze **Erklärung** „Was ist eine Offline-Karte / wann brauche ich sie" (ein, zwei Sätze,
    ausklappbar) für die Auffindbarkeit/Verständlichkeit.
- **UI-Form:** bleibt **Modal/Dialog** — bounded Auswahl aus ~5–20 Optionen, kurze blockierende
  Aktion, passt zur CLAUDE.md-UI-Form-Leitlinie (kein eigener Vollseiten-Onboarding-Flow nötig).
- **Auffindbarkeit:** den Einstieg im Offline-Manager klar benennen (statt eines generischen
  „Katalog"-Buttons ein sprechendes „Region aufs Gerät bringen").

## Subtask-Schnitt

- **A (Dev, Backend) — Hybrid-Katalog:** Remote-Manifest-Fetch (gepinnte Mirror-URL,
  best-effort, Cache), Merge/Override per Region-Key, Offline-Fallback, Halb-Pin-Verwerfen; im
  `offline_katalog`-Handler verdrahtet. `default_offline_katalog()` um die ~5–20 kuratierten
  Platzhalter-Einträge + optionales `gruppe`-Feld erweitert. TDD mit **Mock-Manifest** (kein
  echter Netz-Call im Test).
- **B (Dev, Frontend) — geführter Regions-Picker:** Gruppierung + Erklärung + sprechender
  Einstieg, reuse `starteOfflineDownload`/`listeOfflineKarten`. Nutzt A, ist aber **nicht
  blockiert** (funktioniert schon gegen den compiled-in Katalog).
- **C (Operator/Content, Nicht-Dev):** ~5–20 Region-Packs bauen (`karten-build`) + hosten +
  pinnen + Manifest am Eigen-Mirror pflegen. Nutzt das LFH-197-Operator-Runbook pro Region;
  **hängt an den LFH-197-Operator-Schritten** (erst muss der Bau/Host/Pin-Weg einmal real
  gelaufen sein). Blockiert die Dev-Subtasks A/B nicht.

## Testing

- **Backend (A):** Merge (compiled-in ∪ remote), Override per Region-Key, Offline-Fallback bei
  Fetch-Fehler/ungültigem Schema, Halb-Pin-Verwerfen — alles mit **injiziertem Mock-Manifest**
  (Fetch hinter einem Trait/einer Funktion, im Test gestubbt; kein echter HTTP-Call).
  Katalog-Konsistenz (sha256-Pin-Regel, https-only, Größe > 0) wie in LFH-197.
- **Frontend (B):** Picker-Component-Tests — Gruppierung rendert, Auswahl triggert
  `starteOfflineDownload` mit dem richtigen Eintrag, Erklärung sicht-/ausklappbar, Status
  (geladen/Update) korrekt gespiegelt.

## Bewusst NICHT in Scope (YAGNI / verschoben)

- **Serverseitiges In-App-Tiling** / eigener Region-Bau im UI (die ursprünglich in LFH-199
  angedachte „(A) bauen"-Variante) — durch die Richtungsentscheidung ausgeschlossen.
- **Admin-konfigurierbare Manifest-/Mirror-URL** — bewusst kompiliert-gepinnt (Trust/SSRF).
  Kann später nachgezogen werden, wenn ein echter Bedarf besteht.
- **Landkreis-Granularität (~400)** + Suche/Hierarchie-UX — spätere Ausbaustufe.
- **Manifest-Signing** — nicht nötig, solange Manifest-URL gepinnt + Download per-Eintrag-sha256
  verifiziert ist.

## Abhängigkeiten / Reihenfolge

- Dev A/B sind **jetzt umsetzbar** (Platzhalter-Katalog, Mock-Manifest) und nicht blockiert.
- Operator C hängt an LFH-197 (Bau/Host/Pin-Runbook muss real laufen) und liefert den echten
  Inhalt, der A/B mit Leben füllt.
- Baut auf: LFH-181 (Download-Manager), LFH-183 (Eigen-Mirror), LFH-195 (Shortbread/MBTiles),
  LFH-197 (Pin-Mechanik + Operator-Runbook).
