# Spec Delta

## ADDED Requirements

### Requirement: Jede Stammdatenzeile hat eine Ursprungskennung

Jede verteilbare Stammdatenzeile, auch ein Konto, SHALL eine instanzübergreifende
Ursprungskennung haben: Kennung der Instanz, die sie angelegt hat, und ihr Schlüssel dort. Eine
lokal angelegte Zeile MUST die eigene Instanz nennen. Die erreichte Seite MUST die
Ursprungskennung jeder gelieferten Zeile mitliefern, und die meldende Seite MUST sie für die
übernommene Zeile speichern, auch wenn sie sich ändert.

#### Scenario: Konto vom Hub an zwei ELW
- **WHEN** der Hub das Konto „Anna Berg“ an ELW 1 und an ELW 2 liefert
- **THEN** trägt das Konto an beiden ELW dieselbe Ursprungskennung, die den Hub nennt

#### Scenario: Ergänzung vor Ort
- **WHEN** an ELW 2 ein Spontanhelfer als Personal „nur hier“ angelegt wird
- **THEN** nennt seine Ursprungskennung ELW 2

#### Scenario: Zeile kam schon vor dieser Änderung
- **WHEN** ein ELW nach dem Update die nächste Lieferung des Hubs übernimmt
- **THEN** tragen auch die früher übernommenen Zeilen die Ursprungskennung, die der Hub liefert

### Requirement: Eine Direktkopplung verteilt keine Stammdaten

Über eine Direktkopplung MUST keine Seite Stammdaten oder Geheimnisse von Konten liefern oder
übernehmen. Eine Direktkopplung MUST NOT Stammdaten-Quelle einer Org werden und MUST eine Org
nicht zur verteilenden machen; die Passkey-Pflicht für Admins einer verteilenden Instanz entsteht
durch sie nicht. „ELW verloren“ MUST für eine Direktkopplung fehlen.

#### Scenario: Erst vor Ort, dann Hub
- **WHEN** ELW 2 sich zuerst als Direktkopplung bei ELW 1 und danach als Standardkopplung beim Hub meldet
- **THEN** bezieht ELW 2 die Stammdaten seiner Org vom Hub, und von ELW 1 kommen keine

#### Scenario: Admin an ELW 1 mit Passwort
- **WHEN** ELW 1 nur von ELW 2 als Direktkopplung erreicht wird und ein Admin von ELW 1 mit Passkey sich dort mit Passwort anmelden will
- **THEN** gelingt die Anmeldung wie an einer ungekoppelten Instanz

#### Scenario: Kein „ELW verloren“ vor Ort
- **WHEN** ein Admin an ELW 1 die Direktkopplung mit ELW 2 öffnet
- **THEN** bietet die Seite „Instanzkopplung“ dort „ELW verloren“ nicht an, und die Route antwortet mit 409
