# Proposal

## Why

Seit LLH-1641 (45d383b8) ist ein Einsatz, den eine andere Instanz führt, hier ein Spiegel. Die
Specs `instanz-fuehrung` und `einsatz-spiegel`, das Anwenderkapitel „Instanzkopplung“ und das
Glossar beschreiben dagegen noch die eigene Führungssperre („Nur Ansicht · Führung liegt bei …“),
einen wartenden Zustand nach der Abgabe per Code und Spiegel, die nach einem Widerruf gesperrt
bleiben. Die Gegenprüfung LLH-1676 fand außerdem zwei Lücken im Verhalten: Das Paneel bietet der
Einsatzleitung eine Unterschrift an, die der Server ihr verweigert, und Gerätekonten lesen den
Verlauf der Führung mit Namen und Gründen.

## What Changes

- **Spec `instanz-fuehrung` an den Code angleichen:** Ein fremdgeführter Einsatz ist ein Spiegel.
  Das Schreiben dort scheitert mit dem 409 des Spiegels, die Oberfläche zeigt „Spiegel von …“.
  Die Abgabe per Code steht im Verlauf als „Abgabe per Code“, ohne wartenden Zustand. Der Alarm
  heißt „Ungültige Übernahme der Führung“.
- **Neue Anforderung „Widerruf holt die Führung zurück“:** Endet eine Org-Zuordnung, führt diese
  Instanz jeden Einsatz der Org mit der nächsten Epoche selbst weiter, den sie bisher als Spiegel
  des widerrufenen Gegenübers hielt. Der Verlauf zeigt dabei eine Notübernahme mit dem Grund
  „Kopplung widerrufen“; Bruchstelle ist der Zeitpunkt, zu dem die Instanz vom Widerruf erfährt.
  Offene Übernahmen dieses Gegenübers verfallen. Das beschreibt den bestehenden Code (`release_nach_widerruf`).
- **Leserkreis des Verlaufs festschreiben:** `GET /api/einsaetze/{id}/fuehrung` antwortet einem
  Gerätekonto mit 403. Personen mit Lesezugriff behalten Paneel und Verlauf. Beim Umsetzen zeigte
  sich, dass die Routenliste der Geräte das schon trägt (design.md D1); neu sind Spec und Test.
- **Notübernahme mit Beweis (Verhalten neu):** Das Paneel bietet „Eigene Unterschrift“ nur einem
  Admin der Einsatz-Org an. Die Einsatzleitung sieht nur „Code des Gegenübers“, und diese Wahl
  ist vorbelegt.
- **Spec `einsatz-spiegel`:** „Wer anlegt, führt“ gilt nur ohne Führung je Einsatz, und „Widerruf
  beendet den Abgleich, nicht den Spiegel“ bekommt die Ausnahme für eingeschaltete Führung.
- **Doku:**
  - Anwenderkapitel `instanzkopplung.md`: Einsatzkopf, wer den Code erzeugt, wer eine
    Notübernahme auslöst, Widerruf.
  - Glossar Kapitel 12: Epoche, Bruchstelle, Führungsakte, Notübernahme; der Eintrag „Führer“
    wird berichtigt.
  - `gilt_fuer` von ADR-0021 bekommt `src/routes/fuehrung.rs` und die Führungsdateien unter
    `frontend/src/instanz/`, ADR-0018 bekommt `src/routes/einsatz.rs` (design.md D3).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `instanz-fuehrung`: Die Anforderungen an die Schreibsperre, den Code zur Abgabe, die ungültige
  Übernahme, die Notübernahme gegen die meldende Seite und den Verlauf ändern sich; „Widerruf holt
  die Führung zurück“ ist neu.
- `einsatz-spiegel`: Die Anforderungen „Wer einen Einsatz anlegt, führt ihn, die anderen
  spiegeln“ und „Widerruf beendet den Abgleich, nicht den Spiegel“ gelten mit Verweis auf die
  Führung je Einsatz.

## Impact

- Backend: Integrationstest in `tests/instanz_fuehrung.rs` (Gerätekonto 403, Unterschrift ohne
  Admin-Rolle 403), Doc-Kommentar an `src/routes/fuehrung.rs::lesen`.
- Frontend: `frontend/src/instanz/FuehrungPaneel.tsx` und `fuehrungText.ts` (Beweiswahl nach
  Rolle) samt Test.
- Doku:
  - `docs/anwender/kapitel/instanzkopplung.md`
  - `docs/architektur/12-glossar.md`
  - `docs/architektur/entscheidungen/ADR-0021-…` und `ADR-0018-…` (nur `gilt_fuer`)
- Keine Migration, keine Änderung an DTOs oder Wire-Formaten.
