# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/u131h4rq1mmfxoc8qq7xumv4 (LLH-1922, Folgeaufgabe aus
LLH-1722)

## Why

„Rückgängig“ nach dem Entlassen einer Person macht heute nur `…/reaktivieren`: Die Person ist
wieder aktiv, aber ohne Einheit, Fahrzeug, UHS, Führung der Einheit, Abschnittsleitung und
Einsatzleitung, ihr Status springt auf den Anfangsstatus, und die Zeitachse bekommt eine neue
Periode. Wer sich verklickt, muss alles von Hand wiederherstellen und behält eine falsche
Zeitachse. Beim Fahrzeug nimmt „Rückgängig“ das Entlassen seit LLH-1722 vollständig zurück; die
Person ist als bekannte Lücke stehen geblieben (`frontend/AGENTS.md`, „Beenden: Verb, Ort und
Sicherung je Art“; Spec `bedien-muster`, „Bekannte Lücke bei Personal und Material“).

## What Changes

- `POST …/personal/{ep}/entlassen` antwortet mit `{ personal, vorzustand }` statt nur mit der
  Person. Der Vorzustand nennt dieses Entlassen und die Bindungen davor. **BREAKING** für Clients
  der internen Route; die Route gehört nicht zur öffentlichen API v1, einziger Aufrufer ist
  `EinsatzkraftPage`.
- Neu `POST …/personal/{ep}/entlassen/zuruecknehmen` mit dem Vorzustand als Body: nimmt das
  Entlassen in einer Transaktion zurück. Nur die entlassende Person, nur dieses Entlassen,
  höchstens zehn Minuten danach, sonst 409.
- Status, Dispositionszeit, Stärke-Position und Storno-Sperre bleiben; die Zeitachse bekommt
  keine neue Periode, sondern das `entlassung`-Ereignis dieses Entlassens wird gestrichen. Ist
  die Zeitachse seitdem berichtigt, antwortet die Rücknahme mit 409 und nimmt nichts zurück.
- Einheit, Fahrzeug, UHS, Führung der Einheit, Abschnittsleitung und Einsatzleitung kommen
  einzeln zurück, nur wenn ihr Ziel frei ist und die Person das Schreibrecht des Zielmoduls hat;
  sonst stehen sie mit Grund in Worten in `ausgelassen`.
- ETB „Person «X»: Entlassung zurückgenommen[, ohne …]“ und Live-Meldungen an jede wieder
  gebundene Ansicht.
- Die Personal-Detailseite ruft beim Rückgängig die Rücknahme und zeigt Ausgelassenes und
  Ablehnungen im Seitenhinweis. „Erneut disponieren“ im Block „Entlassen“ bleibt `reaktivieren`.
- Die bekannte Lücke für Personal fällt aus Regel und Spec; Material (LLH-1923) bleibt dort.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `kraefte-entlassung`: neue Anforderung „Entlassung einer Person zurücknehmen“; „Rücknahme lässt
  Verändertes aus“ und „Rücknahme nur direkt nach dem Entlassen“ gelten für Fahrzeug und Person;
  „Erneut disponieren“ nennt das Rückgängig der Person nicht mehr.
- `bedien-muster`: „Eine Kraft entlassen“ nennt die bekannte Lücke nur noch für Material.

## Impact

- Backend: `src/personal/disposition_repo.rs` (Vorzustand aus `entlassen_tx`, neues
  `zuruecknehmen_tx`), `src/personal/mod.rs` (Typen, ETB-Text), `src/routes/einsatz_personal.rs`
  (Antwort von `entlassen`, neue Route, Live über `Betroffen`), `src/app.rs` (Route),
  `src/api_doc.rs`; Typ-Codegen (`scripts/check-typ-codegen.sh`).
- Frontend: `api/einsatzPersonal.ts`, `pages/EinsatzkraftPage.tsx`, generierte Typen.
- Regeln: `frontend/AGENTS.md` („Beenden: Verb, Ort und Sicherung je Art“),
  `frontend/src/kraefte/AGENTS.md` (Rücknahme als Weg, der ein Ereignis streicht).
- Keine Migration, keine neue Tabelle.
