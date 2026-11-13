## ADDED Requirements

### Requirement: Der Führungswechsel vor Ort verlangt Protokoll 4

Eine Instanz SHALL über eine Direktkopplung die Führung nur wechseln lassen, wenn sie und die
Gegenstelle Protokoll 4 oder neuer sprechen; maßgeblich ist die Version, die die Gegenstelle in
ihrer letzten Nachricht genannt hat. Die Seite „Instanzkopplung“ MUST bei einer Direktkopplung mit
älterer Gegenstelle zeigen, dass für den Führungswechsel vor Ort ein Update nötig ist.

#### Scenario: Gegenstelle spricht Protokoll 3
- **WHEN** ELW 1 Protokoll 4 spricht und ELW 2 über die Direktkopplung zuletzt Protokoll 3 genannt hat
- **THEN** zeigt die Kopplungskarte an ELW 1 „Führungswechsel vor Ort erst nach Update von ELW 2“, und Akten, Spiegel und Anträge laufen weiter
