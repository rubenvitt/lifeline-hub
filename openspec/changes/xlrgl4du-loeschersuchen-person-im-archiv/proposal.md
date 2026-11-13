# Proposal

## Why

Nach dem Archivieren (LLH-1494) ist ein Einsatz am Hub geschwärzt. Die Klartexte stehen dann nur
noch in den age-verschlüsselten Blöcken des Archivs. Ein Löschersuchen nach Art. 17 DSGVO für
**eine Person** geht dort heute nicht: Der Server lehnt es mit 409 ab und verweist auf das
Ersuchen für den ganzen Einsatz, das alle Blöcke löscht. Damit verliert die Organisation für ein
einzelnes Ersuchen die ganze Dokumentation. Der Server hat dabei keinen privaten Archiv-Schlüssel
und kann die Blöcke deshalb nicht selbst öffnen (LLH-1712, Nachzug zu K8 aus LLH-1494).

Dazu kommt ein Fehler in der Oberfläche: Die Archivakte bietet an einem archivierten Einsatz gar
keinen Antrag an, auch nicht den für den ganzen Einsatz, den Server und Anwenderdoku vorsehen.

## What Changes

- **Antrag:** An einem archivierten Einsatz nimmt der Server auch einen Personen-Antrag an. Das
  Ziel lässt sich dafür statt per ID auch per Kennung angeben (`R-042`, `EK-17`, `IT-5`).
- **Purge-Lauf:** Er vollzieht einen Personen-Antrag an einem archivierten Einsatz nicht mehr. Der
  Antrag bleibt offen; heute würde er still als „bereits geschwärzt“ erledigt.
- **Neuer Befehl `lifeline-hub archiv loeschersuchen --identitaet … [--einsatz …] [--org …]`:**
  Er vollzieht die fälligen Personen-Anträge an archivierten Einsätzen:
  - Jeder Block des Einsatzes wird entschlüsselt, die Person darin nach der Klassifikation
    geschwärzt und der Block an die geprüften Archiv-Schlüssel der Organisation neu
    verschlüsselt.
  - Die Blöcke ersetzen die alten. Nummer und Frist bleiben gleich, `sha256`, Größe und
    Schlüssel-Fingerabdrücke ändern sich.
  - Eingespielte Kopien der alten Blöcke werden zum Abräumen vorgemerkt.
  - Ältere Downloads lassen sich an dieser Installation danach nicht mehr einspielen, weil ihr
    `sha256` nicht mehr im Archiv steht.
  - Antrag, ETB-Vermerk und Admin-Spur entstehen in einer Transaktion, alle ohne Namen.
- **Neuer Befehl `lifeline-hub archiv personen --einsatz … --identitaet … --suche …`:** Er sucht
  im gültigen Block nach Name oder Kontakt. Die Ausgabe mit Kennungen und Namen steht nur im
  Terminal; die Admin-Spur hält die Suche ohne Suchtext fest. So findet der Admin die Kennung
  für den Antrag.
- **Archivakte:** An einem archivierten Einsatz bietet sie beide Wege an, „Einsatz und Archiv
  löschen“ und „Person per Kennung schwärzen“. Ein offener Personen-Antrag zeigt dort, dass er auf
  den Befehl mit dem Archiv-Schlüssel wartet. Damit ist auch der Oberflächenfehler behoben.
- **Admin-Spur:** zwei neue Aktionen, `archiv_person_geschwaerzt` und `archiv_durchsucht`, samt
  Migration für den CHECK.
- **Doku:** Anwenderkapitel „Aufbewahrung“, Betriebsdoku „Backup und Restore“ und die Regel
  „Archiv am Hub“ in `src/AGENTS.md`.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung-loeschersuchen`: Ein Antrag ist an einem archivierten Einsatz auch für eine Person
  zulässig, und eine Person lässt sich als Ziel per Kennung angeben. Ein solcher Antrag vollzieht
  sich nicht im Purge-Lauf, sondern per Befehl mit dem Archiv-Schlüssel, in allen Blöcken. Eine
  Personensuche im Archivblock läuft per Befehl. Die Archivakte bietet die Antragswege am
  archivierten Einsatz an; deren Rückfrage nimmt die Kennung zugleich als Bestätigung.
- `aufbewahrung-archiv`: Geschwärzt wird außer im Purge-Lauf auch durch den Befehl, der eine
  Person in den Blöcken eines Archivs schwärzt.

## Impact

- **Backend:**
  - `src/aufbewahrung/antrag.rs`: Stellen, Fälligkeit und Vollzug.
  - `src/routes/aufbewahrung.rs`: Zieleingabe per Kennung.
  - `src/einsatz/archiv.rs` und `src/einsatz/archiv/`: neues Modul für Vollzug und Suche im Block.
  - `src/auth/admin_audit.rs`: zwei Aktionen.
  - `src/config.rs` und `src/main.rs`: zwei Unterbefehle von `archiv`.
  - Neue Migration für den CHECK von `admin_audit`.
- **Frontend:**
  - `frontend/src/aufbewahrung/Loeschersuchen.tsx`, ein Dialog zur Eingabe der Kennung und
    `SchwaerzungsantragDialog.tsx`.
  - Die Beschriftung der neuen Aktionen im Zugangsprotokoll.
  - Die generierten Typen (`AdminAktion`).
- **API:** `POST /api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege` nimmt optional
  `ziel.kennung` statt `ziel.id` an. Nicht brechend.
- **Betrieb:** Für den Vollzug muss jemand mit Zugriff auf den Server und auf den privaten
  Archiv-Schlüssel den Befehl ausführen. Bis dahin bleibt der Antrag offen.
- **Grenze:** Heruntergeladene Blöcke und Kopien an anderen Installationen erreicht der Vollzug
  nicht. Die Doku nennt das wie bisher.
