---
id: ADR-0098
titel: Adapter rufen für ihre eigenen Routen auch außerhalb des Laufs ab, mit entschlüsseltem Zugang je Abruf
status: vorgeschlagen
datum: 2026-11-25
gilt_fuer:
  - src/adapter/live.rs
  - src/adapter/lauf.rs
  - src/routes/**/*.rs
herleitung:
  - docs/superpowers/specs/2026-11-24-incls23v-drohnenbild-suchlage-design.md
  - https://zunder.rubeen.dev/#/aufgabe/lkz50cn5ifzkvitvj88qvzao
---

# ADR-0098: Adapter rufen für ihre eigenen Routen auch außerhalb des Laufs ab, mit entschlüsseltem Zugang je Abruf

Nachtrag zu ADR-0077: dort entschlüsselt nur der Lauf (`adapter::lauf`) Geheimnisse.

## Regeln

- MUST: Außer dem Lauf entschlüsselt nur `adapter::live` (`live_kontext`) Geheimnisse eines
  Adapters, und nur für die eigenen Routen der Art, deren Zugang es ist (Videosegmente, Fotovorschauen).
- MUST: Ein `LiveKontext` lebt für genau einen Abruf; sein Zugang wird je Abruf entschlüsselt und
  nirgends zwischengespeichert (kein Cache, kein `static`, kein Zustand der Anwendung).
- MUST: Ein Live-Abruf geht über den `AbrufKontext` des Rahmens (Zielschutz, kein Redirect,
  gedeckelte Antworten); kein eigener Client.
- MUST: `live_kontext` verweigert bei unbekanntem Adapter oder unbekannter Art, bei einem von
  einem Admin angehaltenen Adapter, bei einem, der einen Eingriff braucht
  (`zustand::braucht_eingriff`), bei gesperrtem Geheimnisspeicher und bei einer Org, die sich bei
  einem Hub meldet.
- MUST: `live_kontext` nimmt die Org der Anfrage und liefert für fremde Adapter `Unbekannt`
  (nicht von einem fehlenden zu unterscheiden); es gibt keinen org-blinden Weg zum Zugang.
- MUST: `live_kontext` nimmt die Art, deren Route ihn baut, und liefert für einen Adapter einer
  anderen Art `Unbekannt`; eine Route bekommt nie den Zugang einer fremden Art.
- MUST: Den Zugang bereitet `lauf::prepare` auf, derselbe Weg wie im Lauf; `adapter::live`
  entschlüsselt nicht selbst.
- MUST NOT: Ein Geheimnis, ein Token oder eine Seriennummer steht in Antwort, Log oder Fehler
  einer Route, die einen `LiveKontext` nutzt; sie meldet nur die Verweigerung als Code.

## Prüfung

```sh
verlange 'pub async fn live_kontext\(' src/adapter/live.rs
verlange 'load_in_org' src/adapter/live.rs
verlange 'is_org_am_hub' src/adapter/live.rs
verlange 'braucht_eingriff' src/adapter/live.rs
verlange 'lauf::prepare' src/adapter/live.rs
verlange 'a\.art == art' src/adapter/live.rs
verbiete 'static .*LiveKontext|Cache.*LiveKontext|LiveKontext.*Cache' 'src/**/*.rs'
verbiete 'tracing::[a-z]+!\(.*(wert|geheimnis|secret|token)' src/adapter/live.rs
```

## Kontext

Videosegmente und Fotovorschauen der Drohnenquelle werden zur Anfragezeit eines Clients geholt,
nicht im Takt des Laufs; ohne Zugang zum Token ginge das nicht, und ein Zwischenspeicher des
Tokens würde ADR-0077 aushöhlen. Die Verweigerungsfälle entsprechen dem, wann der Lauf selbst
nicht abruft.

## Konsequenzen

Die Routen der Art bekommen den Zugang kurzlebig und über denselben Weg nach draußen wie der
Lauf. Jeder Live-Abruf kostet eine Entschlüsselung und eine Datenbankabfrage; dafür bleibt das
Geheimnis außerhalb von Speicher, der länger lebt als ein Abruf. Ob der Adapter zur Org der
Anfrage gehört, prüft `live_kontext` selbst; eine Route kann das nicht vergessen.
