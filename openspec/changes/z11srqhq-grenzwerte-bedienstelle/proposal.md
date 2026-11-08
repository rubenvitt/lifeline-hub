## Why

Seit LLH-730 stuft die Kräfte-Zeitachse Meldebild und Personalliste gegen Höchstdienst und Mindestruhe des Einsatzes ein, und der Plan-Befund `dienst` prüft gegen dieselben Werte. Setzen lassen sie sich aber nur über die API (`PATCH …/abloesungen/schichtplan/grenzwerte`). Deshalb gelten praktisch überall die Vorgaben 12 h und 8 h, auch wo ein Einsatz andere Werte braucht (Zunder LLH-1603).

## What Changes

- Die Einstellungen des Einsatzes bekommen im Reiter „Ablösung“ unter „Schichtmodell des Einsatzes“ ein Paneel „Dienst und Ruhe“. Es zeigt die wirksamen Werte und kennzeichnet eine geltende Vorgabe, etwa „12 h (Vorgabe)“.
- „Werte ändern“ öffnet einen Dialog mit zwei Dauerfeldern: „Höchstdienst“ (1 h bis 24 h) und „Mindestruhe“ (0 min bis 24 h). Eingabe und Anzeige folgen der Dauerform der Ablösung („8 h“, „7:30 h“, „90 min“). Ein leeres Feld heißt Vorgabe.
- Den Knopf „Vorgaben wiederherstellen“ gibt es nur, solange ein eigener Wert gilt. Er setzt beide Werte ohne Rückfrage auf die Vorgabe zurück und bietet „Rückgängig“ an.
- Die Ansicht „Schichtplan“ der Ablösung nennt die wirksamen Werte in einer Lesezeile, etwa „Höchstdienst 12 h (Vorgabe) · Mindestruhe 8 h (Vorgabe)“. Wer schreiben darf, springt von dort mit „ändern“ in die Einstellungen.
- Ein gespeicherter Wert wirkt ohne Neuladen im Plan, im Meldebild und in der Personalliste. Die übrigen Sitzungen erreicht er über die bestehenden Live-Ereignisse.
- **Nicht:** keine neue Route, keine Migration, kein neuer Typ. PATCH, Rechte, ETB-Systemsatz und die Live-Ereignisse `abloesung`, `einheit` und `personal` bestehen seit LLH-1552/LLH-730. Es gibt keine zweite Bedienstelle im Schichtplan.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `kraefte-schichtplan`: Neue Anforderung „Grenzwerte bedienen“. Die Oberfläche zeigt, ändert und setzt die Grenzwerte des Einsatzes zurück, und der Schichtplan nennt sie. Die Anforderung „Grenzwerte des Einsatzes“ bleibt unverändert.

## Impact

- **Frontend:** `pages/einstellungen/EinsatzAbloesung.tsx` (neues Paneel), ein neuer Dialog unter `abloesung/` für die zwei Dauerfelder, eine reine Textfunktion für „wirksamer Wert (Vorgabe)“, `abloesung/schichtplan/SchichtplanAnsicht.tsx` (Lesezeile). Der Aufruf von `api/schichtplan.ts:setzeSchichtplanGrenzwerte` (bisher ohne Aufrufer) und die Query-Keys `schichtplan` und `kraefteZeitachseGrenzwerte` bleiben unverändert.
- **Backend:** keiner.
- **Regeln und Doku:** `frontend/src/kraefte/AGENTS.md` (Absatz Ablösung bzw. Schichtplan: wo die Grenzwerte bedient werden), die Anwenderkapitel `einsatz-einstellungen.md`, `abloesung.md` und `meldebild.md` (bei Bedarf `personal.md`), dazu ein Bild des Paneels im Bildlauf.
