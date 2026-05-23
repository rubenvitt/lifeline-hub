# lifeline-hub — Teilprojekt 1: Fundament + ETB-Kern (Design)

**Datum:** 2026-05-23
**Status:** Entwurf zur Freigabe
**Teilprojekt:** 1 von 4 (siehe „Einordnung ins Gesamtsystem")

---

## 1. Überblick & Ziel

**lifeline-hub** ist ein All-in-One-System für die Einsatzverwaltung weißer Hilfsorganisationen — sowohl im Katastrophenschutz als auch im täglichen Bereitschaftsdienst. Vergleichbar mit Command X oder Fireboard.

**Teilprojekt 1** liefert das gemeinsame Fundament plus den ersten nutzbaren vertikalen Schnitt: ein **elektronisches Einsatztagebuch (ETB)**. Nach diesem Teilprojekt kann eine Hilfsorganisation:

1. den Server starten (lokal im ELW oder in der Cloud),
2. sich anmelden,
3. einen Einsatz anlegen,
4. zeitgestempelte, manipulationssichere ETB-Einträge live auf mehreren Geräten erfassen und lesen.

Das Fundament (Server, Authentifizierung, Einsatz-Modell, Live-Updates) trägt anschließend die weiteren Module.

## 2. Kontext & Rahmenbedingungen

- **Echtes Einsatzprodukt** für die eigene Organisation (perspektivisch für andere weiße HiOrgs nutzbar). Anforderungen an Zuverlässigkeit und Nachvollziehbarkeit sind hoch.
- **Self-hostbar & server-agnostisch:** Die HiOrg entscheidet selbst, wo der Server läuft (lokaler Mini-PC/ELW *oder* Cloud). Der Client verbindet sich zu einer **konfigurierbaren Server-Adresse**. Es gibt keine Multi-Server-Synchronisierung.
- **Betrieb ohne DevOps:** Eine Freiwilligen-Organisation muss den Server ohne Fachpersonal betreiben können — idealerweise eine einzige Binary, eine Datei als Datenbank.
- **Offline-fähiger lokaler Betrieb:** Im lokalen Modus (z.B. Mini-PC im ELW, Geräte über lokales WLAN) funktioniert alles **ohne Internet**.

## 3. Tech-Stack (final)

| Schicht | Wahl | Begründung |
|---|---|---|
| **Backend** | Rust + Axum | Robustes Single-Binary, winziger Footprint (läuft auf Mini-PC/Raspberry Pi), ideal fürs Self-Hosting |
| **Datenbank** | SQLite (WAL-Modus) | Eine Datei, null Administration, extrem robust; reicht für Orga/Einsatz locker. Postgres als optionales späteres Upgrade |
| **Frontend** | React + **Ant Design v5** (PWA) | Modern und gut nutzbar, datendichte Tabellen/Formulare sofort verfügbar, hohes Tempo bei CRUD; via Design-Tokens dezent brandbar |
| **Auslieferung Frontend** | In die Rust-Binary eingebettet | Ein Artefakt, kein separater Webserver nötig |
| **Live-Updates** | SSE (Server→Client) + POST (Client→Server) | Einfach, HTTP-basiert, proxy-freundlich; WebSockets erst später falls nötig |
| **Karte** | MapLibre GL (später, Modul 4) | Open Source, offline-fähige Tiles, DSGVO-freundlich |
| **Desktop/Mobile** | Tauri / Capacitor (später) | Beide framework-agnostisch; wrappen die bestehende Web-/PWA-Codebasis |

**Anmerkung Styling:** Ant Design bringt sein eigenes Styling mit; Theming erfolgt über antd Design-Tokens (Primärfarbe, Radius). Standing-out ist kein Ziel — Klarheit und Bedienbarkeit unter Stress zählen.

## 4. Scope von Teilprojekt 1

**In Scope (MVP):**
- Server-Skelett (Single-Binary, eingebettetes Frontend, konfigurierbare DB-/Port-Einstellungen)
- Lokale Benutzerkonten + Anmeldung
- Org-Stammdaten (minimal: Organisation, Benutzerverwaltung durch Admin)
- Einsatz-Entität (mehrere, parallel aktiv) + Lebenszyklus (aktiv → abgeschlossen)
- Rollen & Rechte (Admin / Einsatzleitung / Führungspersonal / Beobachter)
- ETB: append-only Einträge mit Berichtigungs-Mechanismus, Live-Updates
- **Suche & Filter** im ETB (Volltext, Typ/Zeitraum/Person)
- **Client-Offline-Puffer** bei kurzem Verbindungsabriss
- Backup/Restore (Hot-Backup auf USB + Restore-Pfad)

**Bewusst NICHT in Teilprojekt 1** (dokumentiert, nicht vergessen):
- **PDF-/Druck-Export des ETB** — erste reale Einsatznachbereitung wird das brauchen → **priorisiert für T1.1 oder T2**
- OIDC/SSO-Anbindung, MFA
- Schnellbausteine / Eintragsvorlagen
- Server-Discovery (QR-Code / mDNS) — in T1 manuelle URL-Eingabe
- Module 2–4 (Fahrzeuge, Patienten, Lagekarte)

## 5. Architektur

```
┌──────────────────────────────────────────────────────────┐
│  Rust-Binary (Axum)                                        │
│   • HTTP-API (REST/JSON) + SSE-Stream                      │
│   • eingebettetes React/antd-Frontend (statisch serviert)  │
│   • SQLite (WAL) als eingebettete DB-Datei                 │
│   • eingebautes Backup/Restore                             │
└──────────────────────────────────────────────────────────┘
        ▲ HTTPS/HTTP (LAN oder Internet)
        │  POST (Einträge, Aktionen)  ·  SSE (Live-Stream)
        ▼
┌──────────────────────────────────────────────────────────┐
│  React-PWA (Ant Design)                                    │
│   • konfigurierbare Server-URL                             │
│   • lokale Offline-Queue (IndexedDB)                       │
│   • SSE-Client für Live-Aktualisierung                     │
└──────────────────────────────────────────────────────────┘
```

- **Ein Deployment-Artefakt:** Die Rust-Binary liefert API *und* Frontend aus. Start = Binary ausführen.
- **Konfiguration:** DB-Pfad, Port, Bind-Adresse, optional TLS-Zertifikat über Config-Datei/CLI-Flags/ENV.
- **Client-Konfiguration:** Server-URL wird im Client einmalig eingegeben und lokal gespeichert.

## 6. Datenmodell (Kern)

```
Organisation 1──* Benutzer
Organisation 1──* Einsatz
Einsatz      1──* Einsatz-Mitgliedschaft (Benutzer + Rolle im Einsatz)
Einsatz      1──* ETB-Eintrag
ETB-Eintrag  0──1 berichtigt → ETB-Eintrag  (Berichtigungs-Verknüpfung)
```

### Entitäten (Felder, nicht erschöpfend)

**Organisation:** `id`, `name`, Stammdaten (minimal in T1).

**Benutzer:** `id`, `org_id`, `anzeigename`, `benutzername`, `passwort_hash` (Argon2), `system_rolle` (Admin/keiner), `aktiv`, `erstellt_at`.

**Einsatz:** `id`, `org_id`, `bezeichnung`, `stichwort/typ` (optional), `status` (`aktiv` | `abgeschlossen`), `begonnen_at`, `abgeschlossen_at`, `abgeschlossen_von`.

**Einsatz-Mitgliedschaft:** `einsatz_id`, `benutzer_id`, `einsatz_rolle` (Einsatzleitung/Führungspersonal/Beobachter).

**ETB-Eintrag:**
- `id`
- `einsatz_id`
- `lfd_nr` — **server-autoritativ**, lückenlos fortlaufend pro Einsatz
- `typ` — Meldung | Anordnung | Lage | Entscheidung | System | Berichtigung
- `inhalt` — Pflicht (Freitext)
- optional: `von`, `an`, `meldeweg` (Funk/Telefon/persönlich/sonstige), `veranlassung`
- `erfasser_id`
- **Zeitfelder** (siehe Abschnitt 11): `ereigniszeit`, `received_at`, `erfasst_lokal_at`
- `berichtigt_eintrag_id` — bei `typ = Berichtigung`: Verweis auf den berichtigten Eintrag

### Integrität (Append-only)

- ETB-Einträge sind nach dem Anlegen **unveränderlich**; kein Löschen, kein Editieren.
- Korrekturen erfolgen ausschließlich als **neuer Berichtigungseintrag**, der den fehlerhaften Eintrag referenziert. Der Originaleintrag bleibt sichtbar.
- `lfd_nr` ist lückenlos und wird vom Server vergeben.
- Vollständiger Audit-Trail über die Unveränderlichkeit der Tabelle.

## 7. Rollen & Rechte

| Rolle | Ebene | Rechte |
|---|---|---|
| **Admin** | System/Orga | Benutzerkonten anlegen/deaktivieren, Org-Stammdaten verwalten (serverweit) |
| **Einsatzleitung** | pro Einsatz | Voller Zugriff **+** Einsatz-Verwaltung: anlegen, abschließen, Personen & Rollen zuweisen |
| **Führungspersonal** | pro Einsatz | Voller Zugriff auf alles im Einsatz — alle Inhalte lesen/schreiben, ETB erfassen. Keine Einsatz-Administration |
| **Beobachter** | pro Einsatz | Nur lesend |

- Rollen werden **pro Einsatz** zugewiesen (eine Person kann in verschiedenen Einsätzen unterschiedliche Rollen haben).
- Admin ist eine System-Rolle, unabhängig von der Einsatz-Mitgliedschaft.

## 8. Authentifizierung

- **Lokale Benutzerkonten** (Benutzername + Passwort), vom Admin verwaltet. Funktioniert vollständig **offline** (kein externer Identitätsanbieter nötig) — Voraussetzung für den ELW-Betrieb.
- Passwörter mit **Argon2** gehasht.
- Session-Verwaltung über Server-seitige Sessions oder signierte Tokens (Detail im Implementierungsplan).
- **Erster Start / Bootstrap:** Anlegen eines initialen Admin-Kontos (erste Aufgabe der Admin-Rolle: weitere Benutzer einrichten).
- OIDC/SSO und MFA sind später nachrüstbar (out of scope T1).

## 9. Einsatz-Lebenszyklus

```
[aktiv] ──(Einsatzleitung schließt ab)──▶ [abgeschlossen]
```

- Neu angelegte Einsätze sind **aktiv**. Mehrere Einsätze können gleichzeitig aktiv sein.
- **Abgeschlossene Einsätze sind read-only:** keine neuen Einträge, keine Berichtigungen, **keine Wiedereröffnung in T1**.
- Nur die **Einsatzleitung** kann einen Einsatz abschließen.

## 10. ETB-Eintrag im Detail

- **Erfassung (Hybrid):** Pflicht sind nur `typ` und `inhalt` — schnelle Erfassung im Chaos. Optional ausklappbar: `von`/`an`, `meldeweg`, `veranlassung`, abweichende `ereigniszeit`.
- **Eintragstypen:** Meldung, Anordnung, Lage, Entscheidung, System (automatisch — Platzhalter für spätere Module), Berichtigung.
- **System-Einträge:** In T1 nicht aktiv erzeugt, aber der Typ existiert, damit spätere Module (Fahrzeugstatus, Patientenereignisse) automatisch ins ETB protokollieren können.

## 11. Live-Updates & Offline-Puffer

### Live

- Clients abonnieren pro Einsatz einen **SSE-Stream**. Neue Einträge werden an alle verbundenen Clients gepusht und erscheinen sofort.
- Eintragserfassung erfolgt per **POST**; der Server vergibt `lfd_nr` und `received_at` beim Eingang und broadcastet den fertigen Eintrag über SSE.

### Zeitmodell (der subtilste Teil von T1 — explizit spezifiziert)

Drei Zeitstempel mit klaren Rollen:

| Feld | Quelle | Bedeutung | Verwendung |
|---|---|---|---|
| `ereigniszeit` | Client (Default = jetzt, manuell überschreibbar) | Wann das Ereignis tatsächlich stattfand | **Anzeige-Sortierung** des Tagebuchs |
| `received_at` | **Server**, beim Eingang | Wann der Server den Eintrag entgegennahm | **Autoritativ** für `lfd_nr`-Vergabe & Integrität |
| `erfasst_lokal_at` | Client | Wann lokal getippt/abgesendet (relevant bei Offline-Puffer) | Beratend / Audit |

**Konfliktregel:** Bei überlappenden/identischen `ereigniszeit`-Werten entscheidet die `lfd_nr`-Reihenfolge (= `received_at`-Reihenfolge). Die UI zeigt bei Abweichung zwischen `ereigniszeit` und `received_at` einen Hinweis (z.B. ⧖-Markierung), damit nachgetragene/gepufferte Einträge erkennbar sind.

### Offline-Puffer (Client)

- Bei kurzem Verbindungsabriss kann weiter erfasst werden; Einträge landen in einer lokalen **IndexedDB-Queue** mit `erfasst_lokal_at` und (Default-)`ereigniszeit`.
- Bei Reconnect sendet der Client die Queue in Erfassungsreihenfolge per POST. Der Server vergibt erst dann `lfd_nr` und `received_at`.
- Konsequenz: `lfd_nr` spiegelt die Server-Empfangsreihenfolge wider, nicht die lokale Tippreihenfolge — das ist für die Integrität korrekt und durch die angezeigten Zeitstempel transparent.

## 12. Suche & Filter

- **Volltextsuche** über Eintragsinhalte mittels SQLite **FTS5**.
- **Filter:** nach `typ`, Zeitraum (`ereigniszeit`), Erfasser/Person.
- Suche/Filter wirken innerhalb des gewählten Einsatzes.

## 13. UI/UX

- **React + Ant Design v5**, modern und auf hohe Bedienbarkeit unter Stress ausgelegt; responsive (Tablet/Laptop), als PWA installierbar.
- **ETB-Ansicht** (validiertes Layout, vgl. Wireframe in `.superpowers/brainstorm/.../etb-layout.html`):
  - Topbar: aktiver Einsatz + Statusanzeige (Live/aktiv), angemeldeter Nutzer mit Rolle.
  - Such-/Filterleiste.
  - Chronologische ETB-Tabelle: `Nr.`, `Ereigniszeit`, `Typ` (farbcodiert), `Von → An`, `Inhalt`, `Erfasser`; Berichtigungen optisch hervorgehoben und mit dem Originaleintrag verknüpft.
  - **Schnellerfassung** dauerhaft sichtbar (Typ + Inhalt + Absenden), optionale Felder ausklappbar.
- Themeing über antd Design-Tokens (Primärfarbe, Radius) für dezentes Branding.

## 14. Betrieb: Backup/Restore & Datenschutz

**Backup/Restore (Feature, kein DevOps-Thema):**
- SQLite im **WAL-Modus**.
- **Eingebautes Hot-Backup:** Endpoint und/oder CLI-Kommando erzeugt eine konsistente Sicherungskopie (z.B. auf einen USB-Stick) — auch während laufendem Einsatz.
- Dokumentierter, einfacher **Restore-Pfad** (Binary stoppen, DB-Datei ersetzen/zurückspielen, starten).
- Motivation: Self-hosted SQLite auf einem Mini-PC im ELW darf bei Hardware-/SD-Karten-Ausfall nicht zum Datenverlust mitten im Einsatz führen.

**Datenschutz (T1, proportional):**
- Passwörter Argon2-gehasht.
- Transport: TLS empfohlen; im vertrauenswürdigen lokalen LAN auch HTTP möglich (Hinweis in der Betriebsdoku).
- Personenbezug in T1 begrenzt (Namen von Einsatzkräften, ggf. in Meldungstexten genannte Personen). Hochsensible Patientendaten kommen erst mit Modul 3 — dessen erhöhte Anforderungen (Verschlüsselung, strengere Zugriffskontrolle) werden dort gesondert spezifiziert.

## 15. Einordnung ins Gesamtsystem

```
FUNDAMENT (Server · Auth · Einsatz · Stammdaten · Live)
   └─▶ ① ETB-Kern            ◀── Teilprojekt 1 (dieses Dokument)
        ├─▶ ② Fahrzeug-/Einsatzmittelverwaltung   (Status → ETB)
        ├─▶ ③ Patienten-/Betroffenenverwaltung    (Ereignisse → ETB, sensible Daten)
        └─▶ ④ Lagekarte (MapLibre)                (visualisiert ①–③)
```

Jedes weitere Modul erhält seinen eigenen Zyklus (Spec → Plan → Umsetzung) und setzt auf dem hier gebauten Fundament auf. Die ETB-Typen `System` und die Modul-Hooks sind so angelegt, dass spätere Module ihre Ereignisse automatisch protokollieren können.

## 16. Teststrategie (Kurzüberblick)

- **Backend:** Unit-Tests für Domänenlogik (lfd_nr-Vergabe, Append-only-Garantie, Berichtigungs-Verknüpfung, Rollenrechte, Lebenszyklus-Regeln); Integrationstests für API + SSE.
- **Zeitmodell/Offline:** gezielte Tests für die Konfliktregel (überlappende Ereigniszeiten, Reihenfolge nach Reconnect).
- **Frontend:** Komponententests für Erfassungsformular und Offline-Queue; E2E für den Kernfluss (anmelden → Einsatz → Eintrag live sichtbar).
- **Backup/Restore:** Test des Hot-Backups während Schreiblast und des Restore-Pfads.

## 17. Annahmen & offene Punkte

- **Annahme:** Eine Server-Instanz bedient eine Organisation. Mehrmandantenfähigkeit (mehrere Orgs pro Server) ist nicht Ziel von T1.
- **Annahme:** Konkurrierende Last ist moderat (ein Einsatz: ~5–50 gleichzeitige Nutzer) — SQLite genügt deutlich.
- **Offen (Implementierungsplan):** genaue Session-/Token-Mechanik; konkrete Felder der Org-Stammdaten; Default-Theme/Branding-Tokens.
```
