# Proposal

## Why

ELW und Hub vergeben Einsatznummern unabhängig. Ein Spiegel trägt die Nummer der führenden
Instanz und ist von der Eindeutigkeit ausgenommen. Sobald eine Instanz die Führung eines
gespiegelten Einsatzes bekommt, wird der Spiegel zum eigenen Einsatz, und die Eindeutigkeit greift
wieder. Trägt die Instanz dieselbe Nummer schon an einem eigenen Einsatz, scheitert der Wechsel mit
409 „Ein Eintrag mit diesen Werten existiert bereits.“ (LLH-1703, Zunder `a36p545r`). Die
Notübernahme geht damit genau in dem Fall nicht, für den sie gedacht ist. Bei Übergabe und Anfrage
fällt derselbe Fehler im automatischen Abgleich: Die Meldung bricht in jedem Takt erneut ab, und
kein Mensch sieht eine Fehlermeldung. Gleiche Nummern sind der Normalfall, weil beide Seiten im
Jahr bei 0001 beginnen.

## What Changes

- **Beim Eigenwerden bekommt der Einsatz eine freie Nummer (abgestimmt am 12.11.2026).** Wird ein
  Spiegel zum eigenen Einsatz und ist seine Nummer an dieser Instanz belegt (eigener Einsatz oder
  Löschprotokoll), bekommt er die nächste freie Nummer dieser Instanz. Ist sie frei, bleibt sie.
  Das gilt für jeden Führungswechsel: Notübernahme (ohne Beweis, mit Unterschrift, mit Code),
  Übergabe, erfüllte Anfrage, Zurückholen nach einem Widerruf.
- **Die Umnummerierung steht im Einsatztagebuch** als Systemeintrag mit neuer und bisheriger
  Nummer, wie heute schon bei der Verwahrung.
- **Die Verwahrung nutzt dieselbe Nummernvergabe.** Ihr Verhalten bleibt, es steht jetzt aber als
  Anforderung in der Spec.
- **Die Spec `einsatznummer` nennt die Ausnahme.** „Unveränderlich“ gilt weiter für jede Bedienung;
  die einzige Änderung nach der Vergabe ist der Übergang vom Spiegel zum eigenen Einsatz.
- **Tests:** Der Umweg „Nummern ab 900“ im Setup von `tests/instanz_fuehrung_live.rs` entfällt.
  Neu sind Tests mit zwei gekoppelten Instanzen für Notübernahme, Übergabe und Anfrage bei
  gleicher Nummer.

Verworfen: eine sprechende Fehlermeldung statt der Umnummerierung. Sie hilft nur dort, wo ein
Mensch die Anfrage stellt, also nicht bei Übergabe und Anfrage auf der empfangenden Seite.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `einsatznummer`: „Unveränderlichkeit“ bekommt die Ausnahme für den Übergang vom Spiegel zum
  eigenen Einsatz. Neu ist die Anforderung, dass dieser Übergang bei belegter Nummer eine freie
  Nummer vergibt, statt zu scheitern, und das im Einsatztagebuch festhält.

## Impact

- Backend: `src/instanz/spiegel/fuehrung.rs` (`werde_fuehrer`), `src/instanz/spiegel/lebensende.rs`
  (`nummer_freimachen` wird gemeinsam genutzt).
- Tests: `tests/instanz_fuehrung_live.rs`, `tests/instanz_fuehrung.rs`; `tests/instanz_lebensende.rs`
  bleibt unverändert grün.
- Doku: Anwenderkapitel `docs/anwender/kapitel/instanzkopplung.md` (Abschnitt zu Einsatznummern),
  Risiko R30 in `docs/architektur/11-risiken-und-technische-schulden.md`, ein Satz in
  `src/AGENTS.md` („Führung je Einsatz“).
- Keine Migration, kein neues Feld auf der Leitung, keine Änderung an der Oberfläche, kein neuer
  Statuscode.
