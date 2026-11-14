# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/z6ds0ed9pn22tigiufohc8jh (LLH-1656)

## Why

Ein Fremdsystem erfährt seit LLH-1655 über den Abruf `GET /api/v1/events`, dass sich an einem
freigegebenen Einsatz etwas geändert hat. Dafür muss es aber selbst ständig nachfragen. Viele
Empfänger (Einsatzbuch, Alarmierungs- und Dokumentationssysteme) können oder wollen das nicht und
erwarten, dass die Instanz sie anstößt. Das Konzept zur öffentlichen API
(`docs/konzepte/2026-11-11-oeffentliche-api.md`, D4) und ADR-0022 sehen deshalb Webhooks als
zweiten Leser derselben Outbox vor: signiert mit dem Instanzschlüssel, ohne geteiltes Geheimnis,
und ohne der Instanz einen Weg in interne Netze zu öffnen.

## What Changes

- **Webhook am Maschinenzugang:** Je Zugang ein Webhook mit Ziel-URL (nur `https`) und den
  gewünschten Ereignisarten. Anlegen, Ändern, Entfernen und Wiederaufnehmen darf nur der
  System-Admin, je mit Eintrag in der Admin-Spur. Den Zustand lesen alle, die den Admin-Bereich
  sehen.
- **Zustellung aus der Outbox:** Ein Hintergrundlauf liefert je Webhook der Reihe nach die Zeilen
  des Zugangs aus `maschine_ereignis`, ein Ereignis je `POST`. Der Body ist genau das Ereignis des
  Abrufs (`{id, type, occurred_at, einsatz_id}`). Sichtbar sind nur Arten, die der Zugang nach
  seinen Scopes sehen darf. In die Outbox wird weiterhin nicht geschrieben (ADR-0038).
- **Signatur:** Jede Zustellung trägt im Kopf `Lifeline-Signature` ein losgelöstes JWS mit
  EdDSA und `typ lifeline-event+jwt`, signiert mit dem Instanzschlüssel. Claims: `iss`
  (Instanz), `aud` (Webhook-ID), `iat`, `exp` (höchstens 5 min), `jti`, `bh` (SHA-256 des Bodys).
  Kein HMAC.
- **Wiederholung:** Erfolg ist jede `2xx`-Antwort. Sonst wiederholt der Lauf dasselbe Ereignis
  mit Backoff von 1 min, verdoppelt bis höchstens 6 h. Nach 24 h ohne Erfolg hält er den Webhook
  an. Der Admin-Bereich zeigt den Zustand.
- **Wiederaufnahme:** Liegt der Rückstand noch in der Outbox, wird er der Reihe nach
  nachgeliefert. Ist er schon gelöscht, setzt der Webhook beim aktuellen Stand an, und die
  Ansicht sagt, dass der Empfänger den Stand über die Leserouten neu lesen muss.
- **Schutz vor internen Zielen:** Keine Weiterleitungen, kein Proxy, Zieladresse selbst aufgelöst
  und festgehalten. Interne Adressen werden abgelehnt. **LAN-Ausnahme:** Ein Schalter am Webhook
  erlaubt bewusst private Netze, mit Warnung und eigenem Eintrag in der Admin-Spur. Loopback,
  Link-Local (auch Metadatenadressen), Multicast und unbestimmte Adressen bleiben immer gesperrt.
- **Testzustellung:** Der Admin kann ein signiertes `ping` an das Ziel senden und sieht sofort
  das Ergebnis. Es läuft nicht über die Outbox und rückt den Cursor nicht vor.
- **Diagnose:** Die Ansicht zeigt den letzten Fehlschlag (Zeit, HTTP-Status oder Netzfehler),
  den nächsten Versuch und einen Verlauf der letzten 50 Zustellversuche.
- **Referenz-Clients:** Rust-Crate, TypeScript-Modul und Python-Beispiel bekommen eine
  Prüffunktion für Webhooks. Neue Testvektoren decken einen gültigen Webhook, einen fremden
  Schlüssel, einen geänderten Body, eine falsche `aud` und ein abgelaufenes `exp` ab.
- **Neue ADR** zu Signatur, Ziel-Schutz und LAN-Ausnahme der Webhooks.
- **Doku:** Anwender-Kapitel „Anbindungen“, Entwicklerdoku `docs/api/maschinenzugang.md`,
  Architektur (Bausteinsicht, Kontextabgrenzung), ein Abschnitt in `src/AGENTS.md`.

## Capabilities

### New Capabilities

- `webhook-zustellung`: Webhooks am Maschinenzugang: Anlage und Rechte, reihenfolgetreue
  Zustellung aus der Outbox, Signatur und ihre Prüfung, Wiederholung und Anhalten,
  Wiederaufnahme, Schutz vor internen Zielen samt LAN-Ausnahme, Testzustellung, Diagnose und
  Referenz-Prüfung in den Clients.

### Modified Capabilities

- `maschinenzugang`: Die Admin-Spur umfasst auch die Webhook-Aktionen (Anlegen, Ändern,
  Entfernen, LAN-Ausnahme, Wiederaufnahme), und die gemeinsamen Testvektoren decken auch die
  Webhook-Signatur ab.

## Impact

- **Backend:** neues Modul `src/public_api/webhook/` (Repo, Zustellung, Ziel-Schutz), neues
  Signaturprofil in `src/instanz/signatur.rs`, `Zweck::Webhook` in `src/ausgehend.rs`, ein
  Antwort-Deckel in `src/http_begrenzt.rs`, Admin-Routen in `src/routes/anbindungen.rs`,
  `AdminAktion`-Varianten in `src/auth/admin_audit.rs`, Start und Stopp des Laufs in
  `src/main.rs`, Aufräumen des Verlaufs im Purge-Lauf.
- **Migrationen:** neue Tabellen für Webhook und Zustellversuche, Neubau des `admin_audit`-CHECK.
- **Frontend:** Paneel „Webhook“ in `pages/einstellungen/AnbindungAnsicht.tsx`, API in
  `api/anbindungen.ts`, Query-Keys, Zustand in der Liste der Anbindungen.
- **Referenz-Clients und Vektoren:** `crates/lifeline-machine-client`,
  `docs/api/clients/typescript`, `docs/api/clients/python`, `docs/api/machine-auth-testvektoren.json`.
- **Typ-Codegen:** neue Response-DTOs und Enums (`scripts/check-typ-codegen.sh`).
- **Keine Änderung** an der Outbox, ihren Triggern, dem Abruf oder der öffentlichen v1-Route.
