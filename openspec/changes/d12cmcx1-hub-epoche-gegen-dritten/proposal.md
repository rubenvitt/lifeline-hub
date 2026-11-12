# Proposal

## Why

Mit drei Instanzen schlägt eine ELW Alarm, obwohl niemand etwas Unrechtes getan hat (LLH-1707,
Befund aus dem Review zu LLH-1669). ELW 2 erklärt ohne Verbindung eine Notübernahme gegen den Hub,
am Hub hat inzwischen ELW 1 übernommen, und der Hub holt sich die Führung von ELW 1 zurück: per
unterschriebener Notübernahme gegen ELW 1 oder per Widerruf der Zuordnung von ELW 1. Meldet sich
ELW 2 danach, prüft sie die Akte des Hubs wie eine Übernahme gegen sich selbst. Die Prüfung
scheitert, und ELW 2 verwirft mit Alarm „Ungültige Übernahme der Führung“ und Eintrag in der
Admin-Spur. Das Ergebnis gleicht dem Fall, den die Change `faq7l7m4-zwei-elw-unterlegene-seite`
(D7) ohne Alarm offen hält, nur mit Fehlalarm.

## What Changes

- Die meldende Seite hält eine Akte der erreichten Seite ohne Alarm offen, wenn deren Epoche ihr
  die Führung nimmt und deren Erklärung sich gegen eine andere Instanz richtet (bisheriger Führer
  in der Erklärung ist nicht sie selbst). Bestätigen und Widersprechen laufen wie bei D7 der
  Vorgänger-Change.
- Der Widerruf einer Org-Zuordnung, der die Führung zurückholt (`repo::release_nach_widerruf`),
  schreibt künftig eine Erklärung ohne Beweis: Grund „Kopplung widerrufen“, bisheriger Führer ist
  die widerrufene Instanz. Bisher trug diese Akte gar keine Erklärung und war am Draht nicht von
  einer Übernahme ohne Beweis zu unterscheiden.
- Unverändert: Eine Übernahme ohne Erklärung, mit unlesbarer Erklärung oder mit einer Erklärung
  gegen die meldende Seite ohne gültigen Beweis verwirft die meldende Seite weiter mit Alarm.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `instanz-fuehrung`: „Die meldende Seite prüft jede Übernahme gegen sie“ bekommt die Ausnahme
  für eine Erklärung gegen eine andere Instanz; „Widerruf holt die Führung zurück“ legt fest, dass
  die zurückgeholte Akte eine Erklärung mit dem Grund „Kopplung widerrufen“ trägt.

## Impact

- Backend: `src/instanz/fuehrung/austausch.rs` (`apply_eingang`, Zweig `Greater`),
  `src/instanz/fuehrung/repo.rs` (`release_nach_widerruf`), `src/instanz/repo.rs` (Aufrufer, gibt
  den Org-Schlüssel der widerrufenen Zuordnung mit), Tests in `tests/instanz_fuehrung.rs`.
- Kein neues Feld auf der Leitung, keine Migration, keine Codegen-Änderung. Die Erklärung nutzt das
  vorhandene Feld `erklaerung` der Akte.
- Architektur: ADR-0028 ist akzeptiert und damit unveränderlich; eine neue ADR ersetzt sie mit der
  erweiterten Ausnahme. Die Aufgabe nennt ADR-0025; die Entscheidung zur Führung ist heute ADR-0028.
- Anwenderdoku: `docs/anwender/kapitel/instanzkopplung.md`, Absatz zur Notübernahme gegen den Hub.
- Gemischte Versionen: Ein Hub ohne diese Änderung schickt den Widerruf weiter ohne Erklärung; eine
  neue ELW schlägt dann weiter Alarm, bis der Hub aktualisiert ist.
