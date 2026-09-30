# Proposal

## Why

Ohne Netz fällt heute das **Lesen** des Lagebilds aus: Die App-Shell kommt zwar aus dem
Precache, aber jeder API-Abruf scheitert. Nach einem Neuladen landet die Person auf `/login`,
weil `/api/auth/me` ohne Netz als „anonym“ gilt, und die Einsatzseite bleibt leer. Offline
gibt es bisher nur das **Schreiben** über die Offline-Queue (ETB, Personen, Meldungen, Stand
und Belegung) sowie die Karten. LFH-723 ist eine Vorstufe von Phase 3 der Roadmap
(LFH-128), hängt nicht an Tauri und nützt schon jetzt im Feld: Wer im Funkloch steht, soll
den letzten bekannten Stand seines Einsatzes weiter lesen können, und zwar erkennbar als
Stand von damals.

## What Changes

- Eine **Allowlist von Query-Keys** aus `api/queryKeys.ts` wird geräteseitig in IndexedDB
  vorgehalten, gebunden an den angemeldeten Benutzer. Umfang:
  - **ETB**: Liste und Zähler.
  - **Meldebild**: Einheiten, Personal, Fahrzeuge, Material, Abschnitte, Aufträge,
    Rückmeldungen.
  - **Betroffene**: Personen und UHS.
  - **Aufträge**: Aufträge und Befehle.
  - **Lagekarte**: die Datenebenen des Einsatzes.
  - **Rahmen**: dazu die Queries, ohne die diese Seiten gar nicht rendern (Einsatzkopf,
    Modulfreigaben, Einstellungen, Modulzähler, Einsatzliste, Kartenkonfiguration,
    Organisation, Fahrzeugstatus-Katalog).
- Nicht gelistete Queries werden **nie** geschrieben. Ein Guard-Test über alle verwalteten
  Prefixe hält das fest.
- **Offline-Identität:** Der zuletzt vom Server bestätigte Benutzer wird mitgespeichert. Er
  gilt nur, wenn `/api/auth/me` an einem **Netzfehler** scheitert. Eine 401 oder eine andere
  Server-Antwort löscht ihn und den Stand sofort. Offline ist damit ein reiner Lesezustand,
  denn Schreiben läuft weiter ausschließlich über die bestehende Offline-Queue.
- **Höchstliegezeit 24 h**, gezählt ab der letzten erfolgreichen Server-Antwort, nicht ab dem
  letzten Speichern. Ist sie überschritten, wird der Stand beim Start verworfen.
- **Löschen:** Beim Abmelden, bei Sitzungsablauf (401), bei der Anmeldung eines anderen
  Benutzers und bei Rechteentzug wird gelöscht. 403/404 auf den Einsatz räumt alles zu diesem
  Einsatz, 403 auf ein Modul räumt dessen Daten in diesem Einsatz. Gelöscht wird im Speicher
  der Seite und in der IndexedDB. Die Offline-Queue bleibt unberührt, sie ist
  Beweissicherung.
- **Sichtbar veraltet:** Der Datenstand im Seitenkopf lautet ohne Verbindung
  „Stand HH:MM · offline“ statt „Stand HH:MM“. Das gilt auf ETB, Meldebild, Betroffenen,
  Aufträgen und in der Lagekarte.
- **Lagekarte unter Vorbehalt:** Sie gehört nur dazu, wenn der e2e-Nachweis zeigt, dass sie
  offline ihre Ebenen tatsächlich zeichnet. Sonst fällt sie im selben Change aus der Allowlist
  heraus und wird Folgeticket.
- Neue Abhängigkeit `@tanstack/query-persist-client-core`, exakt auf die installierte
  TanStack-Version gepinnt. Als IndexedDB-Schicht dient das schon vorhandene `idb`.

## Capabilities

### New Capabilities

- `lagebild-offline-lesen`: Geräteseitige Vorhaltung ausgewählter Einsatzdaten zum Lesen ohne
  Netz. Dazu gehören Allowlist, Offline-Identität, Höchstliegezeit, Löschpflichten und die
  Offline-Kennzeichnung.

### Modified Capabilities

_keine_

## Impact

- **Frontend:**
  - `main.tsx` (Provider) und `api/queryClient.ts` (Fehler-Seam für 403/404, Liegezeit der
    Allowlist-Queries).
  - `api/queryKeys.ts` (Allowlist als Teil der Registry).
  - `auth/AuthContext.tsx` (Offline-Identität, Löschen bei Abmelden, Benutzerwechsel und 401).
  - Neues Modul unter `offline/` (Speicher, Persister, Bestätigungszeitstempel).
  - `components/Datenstand.tsx` mit `EinsatzSeite.tsx` sowie der Kopf der Lagekarte
    (Offline-Kennzeichnung).
  - Die fünf Zielseiten nur, soweit sie ihren Datenstand noch nicht durchreichen.
- **Tests:**
  - Vitest-Guard auf die Allowlist mit Mutationsprobe.
  - Löschtests, die die IndexedDB selbst prüfen, nicht den Speicher-Cache.
  - Neuer e2e-Spec nach dem Muster von `e2e/lagekarte-offline-precache.spec.ts` (Prod-Bundle
    vom Backend, Service Worker aktiv, `setOffline`, Neuladen).
- **Backend:** keine Änderung. Kein neuer Endpunkt, kein neues Live-Ereignis.
- **Abhängigkeiten:** ein TanStack-Paket, `check-deps.sh` läuft mit.
- **Bekannte Lücke, nicht Teil dieses Change:** Weitere PII liegt schon heute ohne Räumung auf
  dem Gerät, nämlich die Personen-Quittungen der Offline-Queue, ETB-Entwürfe, der Ortscache
  und `localStorage`. Das wird als Folgeticket erfasst.
