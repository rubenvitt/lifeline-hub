# Proposal

## Why

Der Verbleib „Notunterkunft“ einer betroffenen Person (LFH-613) nennt sein Ziel nur als
Freitext. Seit LFH-639 gibt es Betreuungsstellen als Entität. Wer eine Person in die
Notunterkunft „Turnhalle Nord“ schickt, tippt den Namen heute ein zweites Mal. Die Stelle
erfährt dabei nicht, dass jemand namentlich zu ihr unterwegs ist. LFH-639 hat die
Verknüpfung als Non-Goal vertagt, und LFH-674 holt sie nach. Die Entscheidung des
Auftraggebers vom 23.09.2026 bleibt dabei stehen: Betroffene und Evakuierte sind getrennte
Mengen und werden nie verrechnet.

## What Changes

- **Verbleib → Stelle:** Ein Verbleib der Art `notunterkunft` kann optional auf eine
  Betreuungsstelle desselben Einsatzes verweisen (`betreuungsstelle_id`). Für andere
  Verbleib-Arten ist der Verweis unzulässig.
- **Die Person trägt den Verweis ihres jüngsten Verbleibs** als weiteres Cache-Feld neben
  Art, Ziel und Status (`aktuelle_verbleib_betreuungsstelle_id`). Ein späterer Verbleib ohne
  Stelle leert es.
- **Den Verweis setzen darf nur, wer das Modul Betreuung lesen darf.** Ohne dieses Recht
  antwortet der Server mit 403. Die Auswahl der Stelle steht im Frontend nur dann zur
  Verfügung.
- **Der Stellenname wird vom Client vorbelegt, nicht vom Server kopiert.** Wählt man eine
  Stelle, steht ihr Name sichtbar und änderbar im Feld „Ziel“. Gespeichert wird, was dort
  steht (Entscheidung vom 24.09.2026). Der Server liest keinen Stellennamen in den Verbleib.
- **Geschlossene Stellen sind wählbar** und in der Auswahl als „geschlossen“ markiert
  (Entscheidung vom 24.09.2026). Stornierte Stellen sind es nicht (409).
- **„davon namentlich n“ an der Stelle:** Die Betreuungsübersicht zeigt je Stelle, wie viele
  nicht stornierte Personen als jüngsten Verbleib `notunterkunft` an dieser Stelle haben.
  Das gilt nur für Lesende, die zusätzlich das Modul Personen sehen dürfen. Die Zahl geht
  **nie** in Belegung, Kopfzahl, Summe oder Kennzahl ein. Führend bleibt die
  Mengenmeldung.
- **Verbleib-Dialog** auf der Personen-Detailseite: Er zieht auf die Erfassungs-Hülle
  `ErfassungsModal` um (Erfassungs-Norm, die Stelle wird ohnehin angefasst). Welche Felder
  er zeigt, hängt von der Art ab, damit das Feldbudget nicht wächst.
- **Live:** Ein Personen-Ereignis frischt auch die Betreuungsübersicht auf, weil sich
  „davon namentlich“ mit jedem Verbleib ändern kann.
- Migration `0121` (zwei `ADD COLUMN`), Schwärzungsregeln (Verweise bleiben erhalten),
  Codegen und Tests.

## Capabilities

### New Capabilities
- `verbleib-betreuungsstelle`: der Verweis eines Notunterkunft-Verbleibs auf eine
  Betreuungsstelle, seine Rechte und Statuscodes, der Cache an der Person, die Zahl
  „davon namentlich“ an der Stelle mit ihrer Trennung von der Mengenmeldung, und die
  Schwärzung.

### Modified Capabilities
<!-- Die berührten Fähigkeiten (betroffene-lagedaten aus LFH-613, betreuung-evakuierung
     aus LFH-639) liegen noch nicht unter openspec/specs/, sondern nur in ihren
     unarchivierten Changes. Ein MODIFIED-Delta hätte keinen Hauptstand, gegen den es
     läuft. Deshalb eine eigene, neue Fähigkeit. -->

## Impact

- **Datenbank:** `migrations/0121_verbleib_betreuungsstelle.sql` mit
  `person_verbleib.betreuungsstelle_id` und `einsatz_person.aktuelle_verbleib_betreuungsstelle_id`,
  beide `REFERENCES betreuungsstelle(id) ON DELETE SET NULL`. `betreuungsstelle` ist damit
  kein Leaf mehr.
- **Backend:** `src/person/verbleib_repo.rs`, `src/person/mod.rs` (`PersonAnzeige`),
  `src/person/repo.rs` (SELECT), `src/routes/einsatz_person.rs` (`VerbleibBody`, Prüfungen),
  `src/routes/betreuung.rs` + `src/betreuung/{mod,repo}.rs` (Zählung, Antwortfeld),
  `src/einsatz/schwaerzung_registry.rs`, OpenAPI.
- **Frontend:** `pages/PersonenDetailPage.tsx` (Dialog), `api/einsatzPerson.ts`,
  `api/queryKeys.ts` (Live-Fan-out), `betreuung/StellenBlock.tsx` (Anzeige), generierte
  Typen.
- **Nicht berührt:** Kopfzahl-Endpunkt (`…/betreuung/belegung`), Verpflegung, Lagestände
  (`lage_snapshot`), Lagekarte, Evakuiert-Kennzahl.
