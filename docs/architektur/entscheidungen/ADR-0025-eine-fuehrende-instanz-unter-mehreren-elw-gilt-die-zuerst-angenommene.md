---
id: ADR-0025
titel: Ein Einsatz hat genau eine führende Instanz; unter mehreren ELW gilt die zuerst angenommene
status: akzeptiert
datum: 2026-11-12
ersetzt: ADR-0021
gilt_fuer:
  - src/instanz/fuehrung/**
  - src/instanz/spiegel/fuehrung.rs
  - src/einsatz/berechtigung.rs
  - src/einsatz/repo.rs
  - src/einsatz/kontext.rs
  - frontend/src/einsatz/schreibrecht.ts
herleitung:
  - openspec/changes/archive/2026-11-12-faq7l7m4-zwei-elw-unterlegene-seite/design.md
  - openspec/changes/archive/2026-11-09-v6hj7xl2-fuehrung-epoche/design.md
  - LLH-1669 (mit Ruben am 12.11.2026 abgestimmt), LLH-1641
---

# ADR-0025: Ein Einsatz hat genau eine führende Instanz; unter mehreren ELW gilt die zuerst angenommene

## Regeln

- MUST: Die Akte (`einsatz_fuehrung`) entscheidet, wer führt; der Einsatz folgt ihr in derselben
  Transaktion (`repo::save` → `spiegel::fuehrung::richte_aus`). Nennt die Akte eine andere
  Instanz, ist der Einsatz hier ein Spiegel (ADR-0018), sonst nicht. Allein der Spiegel sperrt.
- MUST NOT: Außerhalb der Übernahme legt kein Weg außer `spiegel::fuehrung` eine Zeile in
  `einsatz_spiegel` an oder entfernt sie (Führer werden, Spiegel werden).
- MUST: Eine Akte und der Spiegel desselben Einsatzes tragen dieselbe Kennung (`einsatz.kennung`);
  ein Spiegel bekommt keine eigene Akte.
- MUST: Übergabe und erfüllte Anfrage nur, wenn das Gegenüber alles hat
  (`spiegel::fuehrung::fordere_abgeglichen`); eine Notübernahme nur, wenn der Einsatz hier als
  Spiegel liegt.
- MUST: Die Bedienung der Führung zieht `EinsatzFuehrungszugriff`, nie ein Schreib-Gate.
- MUST: Eine eingehende Akte, die der meldenden Seite die Führung nimmt, entscheidet
  `austausch::entscheide`. Die meldende Seite nimmt eine Epoche des Gegenübers nur mit geprüftem
  Beweis an (Unterschrift oder Abgabecode) und erst nach der Entscheidung eines Menschen, sonst
  verwirft sie sie. Ausnahme: Ist ein Dritter beteiligt (er führt, oder das Gegenüber führt mit
  seiner Epoche), hält sie die Akte ohne Alarm offen, bis ein Mensch entscheidet.
- MUST: Epochen werden als Paar (Zähler, Instanzkennung) verglichen; das größere gilt. Ausnahme:
  Die erreichte Seite lehnt die Epoche einer meldenden Seite ab, wenn die Führung weder bei ihr
  noch bei dieser meldenden Seite liegt; dann gilt die zuerst angenommene.
- MUST: Ob eine offene Übernahme ein Konflikt ist (ein nicht gekoppelter Dritter führt), sagt
  allein `austausch::ist_konflikt`. Einem Konflikt wird nicht widersprochen (422); Bestätigen
  übernimmt den Stand der erreichten Seite, auch mit kleinerer Epoche. Ein Konflikt erlischt,
  wenn die erreichte Seite keinen Dritten mehr nennt oder die Kopplung endet.

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
```

## Kontext

ADR-0021 ließ offen, was gilt, wenn mehrere ELW an einem Hub ohne Verbindung übernehmen. Der Hub
behielt die zuerst angenommene Führung (Schutz vor dem Diebstahl unter ELW), aber die unterlegene
ELW erfuhr nichts, und beide schrieben dauerhaft. Die größere Epoche gelten zu lassen, hätte eine
schon arbeitende ELW nachträglich abgelöst; still nachzuziehen hätte eine Notübernahme des Hubs
ohne Menschen zurückdrehen können.

## Konsequenzen

Nach dem nächsten Meldetakt weiß die unterlegene ELW, wer führt; ab da entscheidet ihre
Einsatzleitung, und bis dahin schreiben beide, sichtbar im Hinweisband. Was sie in dieser Zeit
erfasst hat, bleibt als Bruchstelle gesichert und erreicht die führende ELW nicht. Es braucht
kein neues Feld auf der Leitung und keine Migration.
