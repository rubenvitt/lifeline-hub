# Matrix-Versand „teilweise zugestellt“ (LLH-2146) — Design (kurz)

Zunder: https://zunder.rubeen.dev/#/aufgabe/c4tmpqw1xj8j0ig7es6qfek0

## Absicht

Matrix sendet einen Versand in Teilen: Text (Teil 0), dann jede PNG-Anlage (Teil 1 …), jeder
gelungene Teil steht in `ausgang_teil`. Scheitert nach dem Text eine Anlage endgültig, steht
heute im ETB „… nicht zugestellt: <Grund>“ und in der Versandliste „fehlgeschlagen: …“, obwohl
die Leitstelle den Text hat. Führungskräfte sollen sehen, dass der Text angekommen ist und wie
viele Anlagen fehlen.

## Ziele

- ETB und Versandliste nennen eine Teilzustellung mit fester Zahl:
  „teilweise zugestellt (Text ja, n Anlagen nein)“ (bei n = 1 „1 Anlage nein“), gefolgt vom
  festen Grund des Zustellers.
- Feste Texte, nie ein Text des Homeservers.

## Nicht-Ziele

- Kein neuer Zustand: der Versand bleibt `fehlgeschlagen`; „Erneut senden“ bleibt möglich und
  überspringt die gesendeten Teile (wie bisher, `Versandauftrag::gesendet`).
- Ein Absturz mitten im Senden (`schliesse_unterbrochen`, „unklar“) kennt die gesendeten Teile
  nicht und bleibt, wie er ist (bekannte Grenze, `src/AGENTS.md`).
- E-Mail und Fax unverändert; der eigene Wortlaut von `ungewiss` bleibt.
- Eine zu große Anlage bricht schon vor dem Text ab und ist keine Teilzustellung.

## Ansätze

- **a — Spalte `ausgang.anlagen_offen` (gewählt).** Der Lauf kennt beim endgültigen Fehlschlag die
  Anzahl der Anlagen und die gesendeten Teile (frühere Versuche ∪ dieser Versuch). Ist Teil 0
  gesendet, schreibt er die Zahl der nicht gesendeten Anlagen in die neue Spalte (NULL = keine
  Teilzustellung). ETB und Liste zeigen dieselbe Zahl.
- **b — Ableitung aus `ausgang_teil` ohne Migration (verworfen).** Die Liste wüsste nur „Text ja“,
  nicht n, denn die Gesamtzahl der Anlagen kennt nur der Lauf (aus der Quelle gerendert).
  Erfüllt das Kriterium nur knapp, ETB und Liste sprächen verschieden.

## Entscheidungen

- Migration `0392_ausgang_anlagen_offen.sql`: `ALTER TABLE ausgang ADD COLUMN anlagen_offen
  INTEGER CHECK (anlagen_offen IS NULL OR anlagen_offen > 0)`.
- `Ergebnis::Fehlgeschlagen` trägt `anlagen_offen: Option<i64>`; `save_ergebnis_tx` schreibt sie,
  `Uebergeben` und `retry_tx` setzen sie auf NULL.
- Wire: `Versand.attachments_missing: Option<i64>` (Typ ist englisch), Typ-Codegen.
- ETB: `<Quelle> per Matrix an <Stelle> (<Raum>) teilweise zugestellt (Text ja, n Anlagen nein):
  <Grund>` — ersetzt nur die Form „nicht zugestellt“, nicht „unklar“.
- Versandliste: „teilweise zugestellt (Text ja, n Anlagen nein): <Grund>“ in Alarmfarbe statt
  „fehlgeschlagen: …“.
- Regelzeile in `src/AGENTS.md`, „Matrix-Zustellung“.

## Dem Bauenden überlassen

Name und Ort der Hilfsfunktion, die aus Anlagenzahl und gesendeten Teilen `anlagen_offen`
bestimmt; Testzuschnitt (Einheitstest der Texte, Lauf-Test mit dem aufzeichnenden Zusteller,
Vitest der Versandliste).
