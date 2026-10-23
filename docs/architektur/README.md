# Architekturdokumentation

Stand: 23.10.2026 (alpha dcc500f5).

Diese Dokumentation beschreibt den Aufbau von Lifeline Hub nach [arc42](https://arc42.org):
welche Bausteine es gibt, wie sie zusammenspielen, wo sie laufen, welche Entscheidungen sie
tragen und welche Risiken offen sind. Sie richtet sich an Menschen und Agenten, die das System
ändern, und soll die Frage beantworten, *warum* der Code so aussieht, bevor jemand ihn anfasst.
Geschrieben und fortgeführt wird sie von Agenten (Zunder LLH-1435); jede Aussage ist an einer
Datei im Repo belegt.

## Kapitel

| Nr. | Kapitel | Inhalt |
| --- | --- | --- |
| 1 | [Einführung und Ziele](01-einfuehrung-und-ziele.md) | Aufgabenstellung, Qualitätsziele, Stakeholder |
| 2 | [Randbedingungen](02-randbedingungen.md) | Technische und organisatorische Vorgaben, Konventionen |
| 3 | [Kontextabgrenzung](03-kontextabgrenzung.md) | Nutzer, Geräte und Fremdsysteme an der Systemgrenze |
| 4 | [Lösungsstrategie](04-loesungsstrategie.md) | Zentrale Ansätze je Qualitätsziel |
| 5 | [Bausteinsicht](05-bausteinsicht.md) | Module des Backends, Verzeichnisse des Frontends, Teilprojekte |
| 6 | [Laufzeitsicht](06-laufzeitsicht.md) | Abläufe über mehrere Bausteine |
| 7 | [Verteilungssicht](07-verteilungssicht.md) | Auslieferung, Prozesse, Ports, Speicherorte, Release-Kanäle |
| 8 | [Querschnittliche Konzepte](08-querschnittliche-konzepte.md) | Übergreifende Konzepte mit Verweis auf die tragende Regel |
| 9 | [Architekturentscheidungen](09-architekturentscheidungen.md) | Verzeichnis der ADRs |
| 10 | [Qualitätsanforderungen](10-qualitaetsanforderungen.md) | Qualitätsbaum und Szenarien |
| 11 | [Risiken und technische Schulden](11-risiken-und-technische-schulden.md) | Offene Risiken, bekannte Schulden |
| 12 | [Glossar](12-glossar.md) | Fach- und Technikbegriffe |

Die Entscheidungen selbst liegen je Datei unter [`entscheidungen/`](entscheidungen/), Vorlage
[`entscheidungen/VORLAGE.md`](entscheidungen/VORLAGE.md).

## Pflege

- Form, Mitänderungsregel und ADR-Format stehen in [`AGENTS.md`](AGENTS.md) dieses
  Verzeichnisses. Sie gilt zusätzlich zur [Wurzel-`AGENTS.md`](../../AGENTS.md).
- Vor einer Änderung nennt `scripts/adr-fuer.sh <pfad>…` die ADRs, die für die geänderten
  Dateien gelten ([Skript](../../scripts/adr-fuer.sh)); ihre Regeln sind verbindlich.
- Der Wächter `scripts/check-architektur.sh` (Schritt im Sammel-Gate `scripts/check-all.sh`)
  prüft Vollständigkeit der Kapitel, die Bausteinsicht gegen die Module, die ADR-Köpfe und
  -Prüfungen und jeden relativen Link ([Skript](../../scripts/check-architektur.sh)).

## Abgrenzung zu anderen Dokumentationen

| Ort | Für wen | Inhalt |
| --- | --- | --- |
| [`docs/anwender/`](../anwender/README.md) | Menschen, die die App im Einsatz bedienen | Abläufe in Schritten; dieselben Kapitel zeigt die App unter „Hilfe“ |
| [`docs/betrieb/`](../betrieb/) | Betreiber einer Instanz | Packaging, Sicherung, Umgebungsvariablen, Desktop-App, Web Push, Beobachtbarkeit |
| [`openspec/specs/`](../../openspec/specs/) | Entwicklung | Fähigkeits-Specs (SHALL/MUST), je Fähigkeit eine Datei `spec.md` |
| [`openspec/changes/archive/`](../../openspec/changes/archive/) | Entwicklung | Abgeschlossene Changes mit `design.md` (Herleitungen) |
| [`docs/superpowers/`](../superpowers/) | Entwicklung | Eingefrorenes Archiv früher Entwürfe und Pläne; kann veraltet sein |
| [`docs/architektur-review-2026-07-11.html`](../architektur-review-2026-07-11.html) | Entwicklung | Befundbericht des Architektur-Reviews vom 11.07.2026 |
| [`AGENTS.md`](../../AGENTS.md) und Bereichs-`AGENTS.md` | Agenten | Verbindliche Regeln beim Code, den sie betreffen |

Diese Dokumentation wiederholt keine Regel und keine Spec. Sie ordnet ein und verweist; die
Regel steht genau einmal an ihrem Ort.
