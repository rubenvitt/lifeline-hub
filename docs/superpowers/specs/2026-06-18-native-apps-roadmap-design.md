# Native Apps (Desktop + Mobile) — Roadmap & Architektur-Entscheidung

**Datum:** 2026-06-18
**Typ:** Roadmap-/Entscheidungs-Dokument (kein Implementierungs-Spec)
**Status:** Festgehalten, noch nicht in Umsetzung

## Ziel

Langfristig native Apps für **Windows, macOS, iOS und Android** anbieten — aus
möglichst einer Codebasis und unter Wiederverwendung des bestehenden Stacks.

## Ausgangslage (Ist-Stack)

- **Backend:** Rust (axum) + SQLite (sqlx), Frontend per `rust-embed` ins Binary kompiliert
- **Frontend:** React + Vite + antd + TanStack Query, MapLibre für Karten,
  bereits als **PWA** aufgesetzt (`vite-plugin-pwa`, Workbox, `idb`/IndexedDB),
  SSE für Live-Updates
- Daten sind teils **event-natured**, insbesondere ist das **ETB ein append-only Log**

## Vom Nutzer bestätigte Rahmenentscheidungen

1. **Daten-Modell:** Offline-first mit Sync (jedes Gerät hat lokale Daten und
   synchronisiert, wenn Netz da ist). Begründung: am Schadensort oft kein Netz.
2. **Sync-Topologie:** Langfristig **Peer-to-Peer**. Falls ohnehin ein Sync-Server
   nötig ist, evtl. **beides** (server-vermittelt + P2P). → Architektur P2P-fähig halten.

## Plattform-Entscheidung: Tauri 2

**Gewählt: Tauri 2** — eine Codebasis für Desktop + Mobile, Rust-nativ, nimmt
vorhandenen Rust-Code mit.

- **Trade-off:** Capacitor (Web → iOS/Android) + Electron wäre auf Mobile reifer
  und plugin-reicher, wirft aber den Rust-on-Device-Vorteil weg und bedeutet zwei
  Verpackungs-Tools. Für diesen Stack überwiegt Tauri.
- **Caveat:** Tauris **Desktop**-Story ist ausgereift (risikoarmer Near-Term-Win),
  die **Mobile**-Story ist jünger/rauer. Reihenfolge: Desktop zuerst, Mobile danach.

## Zwei Korrekturen zu naheliegenden Fehlannahmen

### Korrektur 1: „Backend einfach einbetten" gilt nur für Desktop
- **Desktop:** axum-Server kann lokal im App-Prozess mitlaufen.
- **iOS:** localhost-HTTP/SSE-Server im App-Prozess kollidiert mit
  Background-Execution-Limits und App-Store-Review. Idiomatisches Tauri-Mobile-Muster
  sind **IPC-Commands**, kein eingebetteter HTTP-Server.
- **Konsequenz:** Wiederverwendbar ist der **Domain-/Datenkern in Rust**, nicht die
  axum-HTTP-Schicht 1:1. Der HTTP-Layer ist auf Mobile austauschbar.

### Korrektur 2: Event-Log ≠ CRDT
- Append-only Logs (ETB) mergen trivial — echter Glücksfall.
- **Veränderlicher Zustand** (Patient-Status, Ressourcen-Zuordnung,
  Wartebereich/Transport) braucht unter P2P **explizite Konflikt-Semantik**
  (LWW-Register / CRDT).
- Event-Log ist das **Substrat**, CRDT die **Merge-Schicht** obendrauf — beides.

## Offene Weiche (Entscheidung für später, kein Blocker)

**Sync selbst bauen vs. Sync-Engine adoptieren** — der eigentliche Kostentreiber:
- **Automerge** — Rust-native CRDT-Bibliothek, passt in den Stack, volle Kontrolle.
- **Ditto** — P2P-Mesh-Sync-Engine, real im Notfall-/Verteidigungsumfeld im Einsatz;
  kauft das schwere Sync-Problem ab, dafür Abhängigkeit/Kosten.
- Weitere Kandidaten für server-vermittelten Sync: ElectricSQL, PowerSync.
- Nutzer-Tendenz („langfristig P2P, evtl. beides") lehnt sich Richtung P2P-fähig.

## Der Move für JETZT (billige Versicherung)

Im React-Frontend eine **Datenzugriffs-Abstraktion** einziehen, damit Komponenten
nicht hart auf `fetch`/SSE verdrahtet sind, sondern gegen ein Interface reden.
Dann lässt sich derselbe Frontend-Code später gegen HTTP **oder** Tauri-IPC **oder**
einen lokalen Store laufen lassen, ohne jeden Screen anzufassen. Verhindert die
teuerste Lock-in-Ecke und blockiert nichts am laufenden Web-Projekt.

## Phasen-Roadmap

„Nativ Desktop + Mobile + Offline-first + P2P" ist ein Mehr-Quartals-Programm,
kein einzelnes Design-Doc. Reihenfolge:

0. **Jetzt:** Datenzugriffs-Abstraktion im Frontend einziehen. Kostet wenig,
   blockiert nichts, hält alle Türen offen. → erster konkreter, separat zu
   spezifizierender Schritt.
1. **Phase 1 — Desktop verpacken:** Tauri-2-Shell um bestehendes Frontend,
   axum lokal/remote. Risikoarm, schnell vorzeigbares natives Win/Mac-Ergebnis.
   Hier auch Auto-Update & Signierung klären.
2. **Phase 2 — Mobile:** Tauri-Mobile, Frontend über die Abstraktion auf IPC
   umstellen. Hier die rauen Kanten.
3. **Phase 3 — Offline-first/Sync:** lokaler Store pro Gerät, server-vermittelter
   Sync auf Basis des Event-Logs + LWW/CRDT für mutablen State.
4. **Phase 4 — P2P:** Automerge oder Ditto als Merge-/Mesh-Schicht vor Ort.

## Nächster Schritt

Jede Phase bekommt bei Umsetzung ihren eigenen Spec. Empfohlener Einstieg: Schritt 0
(Datenzugriffs-Abstraktion) sauber zu einem umsetzbaren Spec ausbrainstormen, sobald
die native-App-Arbeit konkret wird.
