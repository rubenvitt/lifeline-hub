# Proposal

## Why

Nach dem Vollzug eines Löschersuchens (Art. 17) und nach einer fristbasierten Schwärzung
erfahren offene Clients nichts davon: Ein Tab, der einen abgeschlossenen Einsatz zeigt, trägt den
Namen einer geschwärzten Person bis zum Neuladen weiter, und das Offline-Lagebild eines Geräts
hält ihn bis zu 24 Stunden vor und zeigt ihn ohne Netz wieder an. Der Antrag verspricht
„unwiderruflich entfernt“, auf den Geräten stimmt das noch nicht. Das Design von LFH-751 hat
die Lücke als Non-Goal mit diesem Folgeticket offengelassen.

## What Changes

- **Schwärzungsstand am Einsatz:** Einsatzkopf und Einsatzliste tragen eine neue Zahl
  `teilschwaerzungen`, die zählt, wie oft an diesem Einsatz schon Werte geschwärzt wurden, ohne
  dass der Einsatz gesperrt wurde (vollzogene Personen-Anträge und geschwärzte
  Datenkategorien). Sie wird beim Lesen berechnet, es gibt keine Migration.
- **Purge-Lauf meldet:** Nach dem Vollzug eines Personen-Antrags und nach der Schwärzung einer
  Datenkategorie verteilt er `einsatz` an die Abonnenten des Einsatzes und `einsatzliste` an
  seine Leser. Nach dem Vollzug eines Einsatz-Antrags und nach der Vormerkung (Phase A), die den
  Einsatz sperren, verteilt er zusätzlich `einsatz`, damit offene Tabs den Kopf neu abrufen und
  am 404 räumen.
- **Client räumt bei neuem Schwärzungsstand:** Steigt `teilschwaerzungen` eines Einsatzes, verwirft
  das Gerät jeden älteren Stand dieses Einsatzes im Speicher und im Offline-Lagebild. Was gerade
  angezeigt wird, lädt neu.
- **Client räumt bei verschwundenem Einsatz:** Fehlt ein Einsatz in einer frisch geladenen
  Einsatzliste, in der er vorher stand, verwirft das Gerät seinen Stand wie beim 404 auf den
  Einsatzkopf. Das erreicht auch Geräte, die den Einsatz gerade nicht geöffnet haben.
- Die Offline-Queue und die ETB-Entwürfe bleiben unverändert (Beweissicherung,
  `frontend/src/offline/AGENTS.md`).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung-loeschersuchen`: Ein vollzogener Antrag muss offene Clients und Geräte-Caches
  erreichen.
- `aufbewahrung-kategorien`: Dasselbe für die Schwärzung einer Datenkategorie.
- `einsatzkopf-live`: Das Ereignis `einsatz` geht auch vom Purge-Lauf aus, nicht nur nach einer
  Nutzeraktion; der Kopf trägt `teilschwaerzungen`.
- `lagebild-offline-lesen`: Zwei neue Löschgründe für das Offline-Lagebild, ein gestiegener
  Schwärzungsstand und ein aus der Einsatzliste verschwundener Einsatz.

## Impact

- Backend: `src/einsatz/mod.rs` (`EinsatzAnzeige`), `src/einsatz/repo.rs` (`laden`,
  `liste_fuer`), `src/aufbewahrung/antrag.rs` (`vollziehe_faellige`),
  `src/einsatz/purge_scheduler.rs` (Phase A, K2), Typ-Codegen (`openapi.json`,
  `types.generated.ts`).
- Frontend: `frontend/src/offline/` (neuer Wächter, Filter für Speicher und Vorrat),
  `frontend/src/api/queryClient.ts` (Einhängen des Wächters), `frontend/src/offline/AGENTS.md`.
- Kein neues Live-Ereignis, keine neue Route, keine Migration.
