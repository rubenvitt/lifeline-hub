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
  hat, hebt die Seite ihren Zähler über diese Quittung. Die Instanz stempelt dazu die Akten jeder
  Kopplung neu, in der sie erreichte Seite ist, jeweils über deren gespeichertem Sendestand. So
  gehen auch die seit dem Zurückspielen vergebenen Stände hinaus, an jede Gegenstelle (Review,
  12.11.2026). Eine unplausibel große Quittung hebt nichts.
- **Ein additives Feld, keine Migration (Review, 12.11.2026).** Die Meldung trägt zusätzlich den
  Sendestand der meldenden Seite (`fuehrung_gesendet_bis`). Liegt der Empfangsstand der
  erreichten Seite darunter, hat sie Akten verloren. Sie quittiert dann ihren alten Stand, damit die
  meldende Seite erneut sendet, auch wenn dieselbe Meldung schon eine neue Akte bringt. Ohne das
  Feld bliebe dieser Fall unerkannt: Die neue Akte höbe die Quittung über den Sendestand.
- **Tests:** Integrationstests mit zwei Instanzen spielen je Seite eine Sicherung zurück (Zähler,
  Stände der Kopplung und verlorene Akten). Danach fließen neue Akten in beide Richtungen, und die
  verlorenen erreichen den zurückgespielten Hub erneut.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `instanz-fuehrung`: zwei neue Anforderungen. Der Austausch der Führungsakten übersteht das
  Zurückspielen einer Sicherung an einer der beiden Seiten ohne Eingriff, und verlorene Akten kommen
  erneut.

## Impact

- **Code:** `src/instanz/fuehrung/repo.rs` (`next_stand`, Stände der Kopplung, neues Stempeln
  nach Rückschritt), `src/instanz/melden.rs` (`melden_einmal`, `handle_meldung`).
- **Protokoll:** `MeldenAnfrage` wächst additiv um `fuehrung_gesendet_bis`. Eine Gegenstelle
  älteren Stands ignoriert das Feld oder schickt es nicht; dann wirkt nur dessen Erkennung nicht, der
  Rest schon.
- **Daten:** Bestehende Zähler springen mit der ersten Änderung nach dem Update auf die
  Unix-Sekunden. Die Gegenstelle quittiert danach entsprechend große Werte.
- **Nicht enthalten:** die Zähler der Unterschriftsschlüssel und der Stammdaten. Ob sie dieselbe
  Lücke haben, prüft eine eigene Folgeaufgabe.
