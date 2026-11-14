# Proposal

## Why

Einen Archivblock wieder ansehen kann heute nur, wer eine Shell am Server hat
(`lifeline-hub archiv einspielen`, LLH-1494). Ein System-Admin der Organisation hat den Block
(Download in der Archivakte) und den privaten Archiv-Schlüssel, aber keinen Weg ohne den Betrieb.
Zunder LLH-1711 (Nachzug aus LLH-1494, K7).

## What Changes

- Neuer Schreibweg für den System-Admin: Archivblock und privaten Archiv-Schlüssel hochladen. Der
  Server ruft denselben Kern wie der Befehl (`einsatz::archiv::einspielen::einspielen`) auf. Der
  Einsatz erscheint wie beim Befehl als Spiegel „Aus dem Archiv · bis …“.
- Der Schlüssel wird nur für den Aufruf im Speicher gehalten. Er wird weder gespeichert noch
  geloggt und landet nie auf der Platte. Den Block, der verschlüsselt ist, schreibt der Server
  gestreamt in eine Zwischendatei, die nach dem Aufruf verschwindet.
- Die Funktion fehlt an einer Instanz, bei der sich eine andere Instanz meldet (Kopplung mit
  Richtung `wird_gemeldet`, angebahnt oder aktiv, instanzweit). Dort lehnt der Server ab, und die
  Oberfläche zeigt die Aktion nicht.
- Ziel ist immer die Organisation des Admins. Heißt die Organisation im Archiv anders, wird
  abgelehnt, wie beim Befehl ohne `--org`.
- Die Admin-Spur `archiv_eingespielt` nennt die Person als Akteur. Beim Befehl bleibt es bei
  „Befehl archiv einspielen“.
- Eigene Body-Grenze für die Route: 256 MiB. Gleichzeitig laufende Uploads zählen zur bestehenden
  Upload-Grenze. Größere Blöcke spielt weiter der Befehl ein.
- Oberfläche: Primäraktion „Archiv einspielen“ auf der Seite „Aufbewahrung“, ein Dialog mit Block,
  Schlüssel (Datei oder eingefügt) und optionaler Passphrase. Danach zeigt die Seite das Ergebnis
  mit Frist, Hinweisen und einem Sprung in den Einsatz.
- Doku: Anwenderkapitel „Aufbewahrung“ und Betriebsdoku „Archiv eines Einsatzes einspielen“.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `aufbewahrung-archiv`: neue Anforderung „Archivblock in der Verwaltung einspielen“. Sie regelt
  Recht, Hub-Sperre, Ziel-Organisation, den Umgang mit dem Schlüssel, die Grenzen, die Admin-Spur
  und die Bedienung. Der Archiv-Namensraum `/api/aufbewahrung` bleibt lesend: die neue Route
  liegt unter `/api/admin/archiv/…`.

## Impact

- Backend:
  - `src/einsatz/archiv/einspielen.rs`: Akteur und Ziel-Org mit Namensprüfung als Parameter
  - `src/main.rs`: Aufruf des Befehls angepasst
  - neue Route in `src/routes/` mit Eintrag in `src/app.rs`
  - `src/auth/admin_audit.rs`: Eintrag mit Akteur in der Transaktion
  - `src/instanz/repo.rs`: Hub-Prüfung
  - OpenAPI und Typ-Codegen für die neuen Antwort-DTOs
- Frontend:
  - `frontend/src/aufbewahrung/AufbewahrungUebersicht.tsx`
  - `frontend/src/api/` und `queryKeys.ts`
  - Unit- und e2e-Tests
- Doku:
  - `docs/anwender/kapitel/aufbewahrung.md` mit Bildern
  - `docs/betrieb/backup-restore.md`
- Keine Migration, keine neue Abhängigkeit.
