---
id: ADR-0040
titel: Ein Einsatz hat genau eine führende Instanz; über eine Direktkopplung gibt keine Seite ohne Beweis und ohne ihre Einsatzleitung ab
status: akzeptiert
datum: 2026-11-13
ersetzt: ADR-0033
gilt_fuer:
  - src/instanz/fuehrung/**
  - src/instanz/spiegel/fuehrung.rs
  - src/routes/fuehrung.rs
  - src/einsatz/berechtigung.rs
  - src/einsatz/repo.rs
  - src/einsatz/kontext.rs
  - frontend/src/einsatz/schreibrecht.ts
  - frontend/src/instanz/fuehrungText.ts
herleitung:
  - openspec/changes/archive/2026-11-13-gwcf2shk-fuehrungswechsel-vor-ort/design.md
  - openspec/changes/archive/2026-11-12-faq7l7m4-zwei-elw-unterlegene-seite/design.md
  - LLH-1678 (mit Ruben am 13.11.2026 abgestimmt), LLH-1707, LLH-1669, LLH-1641
---

# ADR-0040: Ein Einsatz hat genau eine führende Instanz; über eine Direktkopplung gibt keine Seite ohne Beweis und ohne ihre Einsatzleitung ab

## Regeln

- MUST: Die Akte (`einsatz_fuehrung`) entscheidet, wer führt; der Einsatz folgt ihr in derselben
  Transaktion (`repo::save` → `spiegel::fuehrung::richte_aus`). Allein der Spiegel sperrt.
- MUST NOT: Außerhalb der Übernahme legt kein Weg außer `spiegel::fuehrung` eine Zeile in
  `einsatz_spiegel` an oder entfernt sie. Akte und Spiegel tragen dieselbe Kennung.
- MUST: Übergabe und erfüllte Anfrage nur abgeglichen (`fordere_abgeglichen`), eine Notübernahme
  nur am Spiegel hier. Die Bedienung zieht `EinsatzFuehrungszugriff`, nie ein Schreib-Gate.
- MUST: Nach welcher Regel die Führung zu einem Gegenüber wechselt, sagt allein
  `instanz::wechselregel` (`nach_richtung`, `gleichrangig`, `gesperrt`).
- MUST: Eine Übernahme gegen die meldende Seite einer Standardkopplung und gegen jede Seite einer
  Direktkopplung (`gleichrangig`) gilt nur mit geprüftem Beweis und nach der Entscheidung eines
  Menschen dort, sonst wird sie verworfen (`austausch::entscheide`, `entscheide_vor_ort`). Ist ein
  Dritter beteiligt oder nennt die Erklärung einen anderen Führer eines anderen Stands, hält die
  meldende Seite ohne Alarm offen (`is_gegen_mich`, `ist_konflikt`; Konflikt: kein Widerspruch).
- MUST NOT: Über eine Direktkopplung gibt es keine Notübernahme ohne Beweis (422) und kein
  Erfüllen einer Anfrage ohne die Einsatzleitung.
- MUST: Widerspruch oder Verwerfen der eigenen Übernahme (unmittelbar folgende Epoche) nimmt die
  übernehmende Seite vor Ort mit Alarm an; jede andere Akte prüft sie wie eine Übernahme.
- MUST: Holt ein Widerruf die Führung zurück, trägt die Akte eine Erklärung ohne Beweis.
- MUST: Epochen werden als Paar (Zähler, Instanzkennung) verglichen; das größere gilt. Ausnahme:
  Die erreichte Seite lehnt die Epoche einer meldenden Seite ab, wenn die Führung weder bei ihr
  noch bei dieser liegt, außer der bisherige Führer bezeugt die Abgabe oder eine Notübernahme
  gegen ihn trägt eine hier gültige Unterschrift.

## Prüfung

```sh
verlange 'spiegel::fuehrung::richte_aus' src/instanz/fuehrung/repo.rs
verbiete 'fuehrung_bei' 'src/**/*.rs' 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx'
verbiete '(INSERT INTO|DELETE FROM) einsatz_spiegel' 'src/**/*.rs' ':(exclude,glob)src/instanz/spiegel/**' ':(exclude)src/einsatz/spiegel_filter.rs'
verlange 'fn fordere_abgeglichen' src/instanz/spiegel/fuehrung.rs
verlange 'pub struct EinsatzFuehrungszugriff' src/einsatz/kontext.rs
verlange 'pub fn entscheide\(' src/instanz/fuehrung/austausch.rs
verlange 'then_with\(\|\| self\.instanz\.cmp\(&other\.instanz\)\)' src/instanz/fuehrung/mod.rs
verlange 'pub fn ist_konflikt' src/instanz/fuehrung/austausch.rs
verlange 'austausch::ist_konflikt' src/instanz/fuehrung/dienst.rs
verlange 'pub fn is_gegen_mich' src/instanz/fuehrung/austausch.rs
verbiete 'fuehrer_alt (==|!=) ich' 'src/**/*.rs'
verlange 'pub fn wechselregel' src/instanz/mod.rs
verlange 'pub fn entscheide_vor_ort' src/instanz/fuehrung/austausch.rs
verlange 'kopplung\.wechselregel\(\)' src/instanz/fuehrung/austausch.rs
verbiete 'traegt\((crate::instanz::|super::)?Fluss::Fuehrungswechsel\)' src/instanz/fuehrung/dienst.rs src/instanz/fuehrung/austausch.rs
verlange 'regel == Wechselregel::NachRichtung' src/instanz/fuehrung/austausch.rs
```

## Kontext

Über eine Direktkopplung zwischen zwei ELW wechselte die Führung nicht; fiel der führende ELW aus,
übernahm der andere nicht. Die Regeln nach der Richtung passen dort nicht: Die erreichte Seite nähme
jede Epoche ohne Beweis an. Der Hub lehnte einen Wechsel zwischen zwei ELW ab.

## Konsequenzen

Beide Seiten einer Direktkopplung sind gleichgestellt. Bis ihre Einsatzleitung entscheidet, führen
für kurze Zeit beide, mit Bruchstelle im Verlauf. Eine Gegenstelle mit Protokoll 3 bleibt
gesperrt. Der Hub kennt die Schlüssel der ELW-Admins erst, wenn ein Admin dort sie bestätigt hat.
