# Proposal

## Why

Wird eine gekoppelte Instanz aus einer Sicherung zurückgespielt, steht ihr Zähler der
Führungsakten (`instanz_identitaet.fuehrung_stand`) unter dem Stand, den das Gegenüber schon
quittiert hat (LLH-1708, Nachreview zu LLH-1672, Befund B3). Neue Akten des zurückgespielten Hubs
bekommen dann Stände, die der ELW für erledigt hält, und erreichen ihn nie, auch eine Übergabe oder
Notübernahme am Hub nicht. Umgekehrt schickt der ELW Akten, die der Hub mit der Sicherung verloren
hat, nie erneut, weil er seinen Sendestand nur vorwärts speichert. Beides geschieht ohne Hinweis.
Eine Sicherung einzuspielen ist der übliche Weg nach einem Ausfall, also gerade dann, wenn die
Führung zwischen den Instanzen stimmen muss.

## What Changes

- **Der Zähler folgt der Uhr (abgestimmt am 12.11.2026, Variante A).** Ein neuer Stand ist der
  größere Wert aus „bisheriger Stand + 1“ und den Unix-Sekunden jetzt. Nach dem Zurückspielen
  springt der Zähler damit über alles, was vor dem Ausfall vergeben war, solange die Uhr der
  Instanz stimmt. Die Werte (um 1,8 Mrd.) liegen weit unter der Grenze, die eine Gegenstelle annimmt
  (2⁴⁰, LLH-1672). Eine ältere Gegenstelle nimmt sie also an.
- **Die meldende Seite übernimmt eine kleinere Quittung.** Quittiert das Gegenüber weniger, als die
  meldende Seite als gesendet gespeichert hat, und mehr als null, setzt sie ihren Sendestand darauf
  zurück. So gehen Akten, die das Gegenüber mit der Sicherung verloren hat, erneut hinaus. Die
  erreichte Seite tut das schon heute: Sie sendet stets ab der Quittung der meldenden Seite.
- **Netz für eine falsche Uhr.** Quittiert das Gegenüber mehr, als der eigene Zähler je vergeben
  hat, hebt die Seite ihren Zähler über diese Quittung. Die erreichte Seite stempelt dazu die Akten
  der Kopplung neu, deren Stand über ihrem gespeicherten Sendestand liegt, damit auch die seit dem
  Zurückspielen vergebenen Stände hinausgehen. Eine unplausibel große Quittung hebt nichts.
- **Kein neues Protokollfeld, keine Migration.** Das Schema der Meldung bleibt, wie es ist.
- **Tests:** Integrationstests mit zwei Instanzen spielen je Seite eine Sicherung zurück (Zähler,
  Stände der Kopplung und verlorene Akten). Danach fließen neue Akten in beide Richtungen, und die
  verlorenen erreichen den zurückgespielten Hub erneut.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `instanz-fuehrung`: neue Anforderung, dass der Austausch der Führungsakten das Zurückspielen
  einer Sicherung an einer der beiden Seiten ohne Eingriff übersteht.

## Impact

- **Code:** `src/instanz/fuehrung/repo.rs` (`next_stand`, Stände der Kopplung, neues Stempeln
  nach Rückschritt), `src/instanz/melden.rs` (`melden_einmal`, `handle_meldung`).
- **Protokoll:** unverändert; nur die Bedeutung der Stände wird robuster. Gegenstellen auf älterem
  Stand bleiben verträglich.
- **Daten:** Bestehende Zähler springen mit der ersten Änderung nach dem Update auf die
  Unix-Sekunden. Die Gegenstelle quittiert danach entsprechend große Werte.
- **Nicht enthalten:** die Zähler der Unterschriftsschlüssel und der Stammdaten. Ob sie dieselbe
  Lücke haben, prüft eine eigene Folgeaufgabe.
