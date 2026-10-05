# etb-volltextsuche Specification

## Purpose
Legt fest, welche Einträge des Einsatztagebuchs die Volltextsuche zu einem Suchbegriff trifft,
einheitlich für die Liste und die Zählungen.

## Requirements

### Requirement: Die Suche trifft Wortanfänge
Die ETB-Volltextsuche SHALL einen Eintrag treffen, wenn jedes Wort des Suchbegriffs der Anfang
eines Wortes in Inhalt, Von, An oder Veranlassung des Eintrags ist. Groß- und Kleinschreibung
MUST dabei keine Rolle spielen. Mehrere Wörter des Suchbegriffs SHALL alle zutreffen müssen.

#### Scenario: Wortanfang eines Kompositums
- **WHEN** ein Eintrag „Deichbruch gemeldet“ lautet und nach „Deich“ gesucht wird
- **THEN** ist dieser Eintrag ein Treffer

#### Scenario: Ganzes Wort trifft weiterhin
- **WHEN** ein Eintrag „Deich hält“ lautet und nach „deich“ gesucht wird
- **THEN** ist dieser Eintrag ein Treffer

#### Scenario: Wortmitte trifft nicht
- **WHEN** ein Eintrag „Deichbruch gemeldet“ lautet und nach „bruch“ gesucht wird
- **THEN** ist dieser Eintrag kein Treffer

#### Scenario: Mehrere Wörter
- **WHEN** nach „Funk Nord“ gesucht wird
- **THEN** treffen nur Einträge, in denen ein Wort mit „Funk“ und ein Wort mit „Nord“ beginnt

### Requirement: Sonderzeichen werden nicht als Suchsyntax gelesen
Zeichen wie `"`, `*`, `:` oder die Wörter `AND`/`OR`/`NOT` im Suchbegriff MUST als gewöhnlicher
Text behandelt werden und dürfen keinen Fehler auslösen. Ein Wort ohne Buchstaben oder Ziffern
SHALL nicht zum Filter beitragen; besteht der ganze Suchbegriff aus solchen Wörtern, SHALL die
Liste ungefiltert bleiben.

#### Scenario: Sonderzeichen im Suchbegriff
- **WHEN** nach `Status: "alles" AND *` gesucht wird
- **THEN** antwortet die Suche ohne Fehler

#### Scenario: Nur Sonderzeichen
- **WHEN** der Suchbegriff nur aus `* :` besteht
- **THEN** liefert die Liste dieselben Einträge wie ohne Suchbegriff

### Requirement: Liste und Zählungen treffen dieselben Einträge
Die Liste, die Gesamtzahl der Treffer und die Zählung je Typ SHALL zu einem Suchbegriff dieselbe
Treffermenge zugrunde legen.

#### Scenario: Trefferzahl zur Wortanfangssuche
- **WHEN** nach „Deich“ gesucht wird und 3 Einträge ein Wort enthalten, das mit „Deich“ beginnt
- **THEN** liefert die Liste diese 3 Einträge und die Zählung meldet 3 Treffer
