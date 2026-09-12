# LFH-46 — Modul „Stab" (S1–S6): Führungsorganisation und Lagebesprechung im Fükw

**Datum:** 2026-09-12
**Task:** LFH-46 (Entwicklungsboard) · Kategorie *Führung*, Registry-Key `stab`
**Status dieses Dokuments:** Design zur Freigabe; Umsetzung in neun Subtasks (Abschnitt 12)
**Vorgänger:** [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) — führt „Stab" als
einziges WIP-Modul der Kategorie Führung und nennt es als eigene Folge-Spec. Diese Spec ist die Einlösung.
**Entstanden aus:** vier konkurrierenden Entwürfen (Feld-MVP · Funktionsmodell zuerst · Sachgebiets-Cockpit ·
Lagebesprechung als Kernobjekt), bewertet von drei unabhängigen Bewertern (Einsatzleiter im Fükw ·
Fachlehrer FwDV 100 · Maintainer). Alle drei setzten den Feld-MVP mit deutlichem Abstand vorn
(8,4–8,9 gegen 6,1–6,9) und forderten dieselben Korrekturen. Was hier steht, ist die Synthese; die
verworfenen Alternativen stehen in Abschnitt 5 mit dem Grund, der sie gekippt hat. Danach ein
adversarialer Review über vier Dimensionen (Fachlichkeit · Konventionen · Datenmodell · Feldpassung):
39 Findings, jedes einzeln auf Widerlegung geprüft, **8 bestätigt und eingearbeitet** — darunter die
zwei Konstruktionsorte von `EinsatzAnzeige` (9.4), der idempotente DELETE (9.2), die tragfähige
Rollback-Probe (9.5) und die handgebauten Link-Ziele mit Gate-3-Nachweis (10, ST9).

> **Widerspruchsregel.** Wo dieses Dokument dem Ticket-Text widerspricht, gilt dieses Dokument; jede
> Abweichung steht in Abschnitt 4 mit Beleg. Das Ticket verlangt „durchbrainstormen, was S1–S6 konkret
> abbilden" — die Antwort ist Entscheidung 2, und sie lautet bewusst *nicht* „sechs Arbeitsplätze".

---

## 1. Problem

Das Modul `stab` ist seit dem Navigations-Redesign ein Platzhalter: `frontend/src/einsatz/modulRegistry.ts:61`
trägt `status: 'wip'` mit „Stabsarbeit (S1–S6). Wird später ausgearbeitet.", die Route
`/einsaetze/:id/stab` rendert `einsatz/ModulStub.tsx`. Backend-seitig existiert der Modul-Key
(`src/einsatz/modul.rs:15`), aber keine Tabelle, kein Handler, keine Route. Die Kommandopalette filtert
das Modul als unfertig heraus.

Was fehlt, ist nicht ein weiteres Erfassungsmodul. Der Bestand trägt die Sachgebiete inhaltlich schon
weitgehend (Abschnitt 3): Lagekarte, ETB, Lageberichte mit den Vorlagen „Lagevortrag zur Information /
zur Entscheidung", Befehle, Aufträge, Erinnerungen, Nachforderungen, Kräfteübersicht, Sprechgruppen. Was
kein Modul beantwortet, sind zwei Fragen, die in einem Führungsfahrzeug wiederkehren:

1. **Wer trägt gerade welches Sachgebiet** — oder liegt es bewusst bei der Einsatzleitung bzw. rückwärtig
   bei der Leitstelle? Heute steht das nur als Freitext „Führungsstelle" am Einsatzmitglied
   (`migrations/0100_mitgliedschaft_fuehrungsstelle.sql`, LFH-461) und als Freitext-Empfänger an
   Auftrag, Erinnerung und ETB, in drei Schreibweisen.
2. **Wann war die letzte Lagebesprechung, was wurde entschieden, wann ist die nächste?** Seit LFH-463
   gibt es den Termin (`einsatz.naechste_lagebesprechung_at`, `migrations/0101`), aber keinen Ort, an dem
   eine Besprechung abgeschlossen und ihr Entschluss dokumentiert wird — obwohl das ETB dafür seit
   Migration 0004 den Typ `entscheidung` führt, den heute **kein** Codepfad erzeugt (gemessen:
   `src/etb/mod.rs:16` ist die einzige Fundstelle außerhalb des Vokabulars).

## 2. Recherche-Grundlage

Die Fachgrundlage liegt als Rechercheergebnis vor (FwDV 100 im Volltext, DV 100 LSA 2011 und DRK-DV 100
sind in 3.2.2.2, 3.2.5 und Anlage 2 wortgleich; Länderunterlagen RLP FüRi, LFS-BW F5-I, HLFS). Die
Beweisregel der Bedien-Leitlinie gilt: jede Zahl trägt Quelle und Abschnitt, Gerechnetes `[abgeleitet]`,
Lehrmeinung `[sekundär]`. **Diese Spec ist die erste im Repo, die FwDV 100 abschnittsgenau zitiert** —
was hier steht, wird später als Norm gelesen.

### 2.1 Zielkontext: Führungsstufe B/C, nicht Stabsraum

| Aussage | Quelle |
|---|---|
| Vier Führungsstufen: A ohne Führungseinheit (bis zwei Gruppen) · B Zug/Verband an **einer** Einsatzstelle mit Führungstrupp/-staffel · C Verband mit Führungsgruppe · D mehrere Verbände mit Führungsgruppe/Führungsstab (Kreisebene). Kein Zahlenkriterium über Abschnitte; „Übergänge fließend". | FwDV 100 Abschn. 3.2.5, S. 26; HLFS Führungsorganisation Kap. 3, S. 7 |
| Führungstrupp = mindestens Führungsassistent + Melder + Fahrer, „mit einem Fahrzeug auszustatten". Führungsstab = Leiter des Stabes + S1–S4, bei Bedarf S5/S6 + Fachberater. | FwDV 100 Abschn. 3.2.2.2, S. 14–16 |
| ELW 1: Führen von Verbänden mit Führungsassistenten, „jedoch **ohne** stabsmäßige Führung"; „für eine Führungsgruppe grundsätzlich ein ELW 1". ELW 2: „mit stabsmäßiger Führung". | DIN 14507-2/-3, zitiert nach LFS-BW F5-I Abschn. 3.1.1, S. 9–10 `[sekundär: DIN-Text nicht frei zugänglich]` |
| Führungstrupp 1/1/2/4 mit MTF bzw. **FüKw** → Stufe B; Führungsstaffel 1/2/3/6 mit ELW 1 → Stufe B; Führungsgruppe TEL 2/3/4/9 mit ELW 2 → Stufe C/D. | RLP FüRi Abschn. III.1–III.3.1, S. 11–12 |
| Besetzung Führungsstaffel ELW 1: Einsatzleiter · **Führungsassistent S2-S3 „Lage und Einsatz"** · Führungsassistent S5 · Fahrer/Sprechfunker · drei Führungshilfskräfte (Sprechfunker/Lagekartenführer/Tagebuchführer). Rückwärtig (FEZ): Führungsassistent **S1-S4-S6**. | RLP FüRi Abschn. IV.2.1, S. 19; IV.2.2, S. 20 |
| Führungsgruppe BW im ELW 1: Führer · Lagezeichner (S2) · zwei Fernmelder. | LFS-BW F5-I Abschn. 3.2.2, S. 11–12 |
| Zusammenlegungsregel: **S4 mit S1 · S2 mit S3 · S5 zu S2 · S6 zu S3.** Sachgebietslisten sind „Anregung, Erinnerung und Unterstützung", kein Pflichtkatalog. | FwDV 100 Anlage 2, S. 54 |
| S1, S4 und S6 können „ganz oder teilweise" auf rückwärtige Einrichtungen (Leitstelle) übertragen werden. Mehrere Sachgebiete je Führungsassistent sind zulässig. | FwDV 100 Abschn. 3.2.2.2, S. 16 bzw. S. 15 |

**Ableitung für den Zielkontext `[abgeleitet]`:** „Fükw" ist eine landes- und organisationsabhängige
Bezeichnung (RLP für Nicht-Feuerwehr-Fachdienste, THW-Planung seit 2022) und technisch der ELW-1-Klasse
zuzurechnen. Das Praxisbild dieser Klasse ist: ein Einsatzleiter, ein Führungsassistent „Lage und Einsatz"
(S2/S3 in Personalunion), ein bis zwei Fernmelder mit Lagekarten-/ETB-Führung. **S1, S4, S5 und S6 fallen
dort als Aufgaben an, ohne besetzte Rolle.** Die vom Auftrag vermutete Zuordnung „S6 = Fernmelder" ist
**nicht belegt**: der Fernmelder ist Führungshilfspersonal (FwDV 100 Anlage 1, Nr. 1.1.5 „Sprechfunk"),
kein Sachgebietsträger. Diese Formulierung darf in keiner Beschriftung, keinem Hilfetext und keinem Seed
auftauchen.

### 2.2 Die sechs Sachgebiete und was davon im Feld anfällt

Quelle für alle Aufgabenlisten: FwDV 100 Anlage 2, S. 55–60; Unterlagen Anlage 5, S. 64–66. Die
Spalte „Feld" ist `[abgeleitet]` aus 2.1.

| SG | Aufgaben (Wortlaut gekürzt) | Arbeitsprodukte | Feld (ELW-1-Klasse) | Bestand in Lifeline Hub |
|---|---|---|---|---|
| **S1 Personal / Innerer Dienst** (S. 55) | Alarmieren/Anfordern, Reserven, Lotsenstellen, Bereitstellungsräume einrichten, „führen von Kräfteübersichten", innerer Stabsdienst | Kräfteübersicht | Kräfteübersicht, Nachalarmierung, BR: ja · Ablösung/Schichtplan: erst Stab | Personal, Einheiten (Ist/Soll F/UF/M), Bereitstellungsräume, Kräfteübersicht/Meldebild |
| **S2 Lage** (S. 56) | Lagefeststellung, „führen einer Lagekarte", Einsatzübersichten, „vorbereiten von Lagebesprechungen und Lagemeldungen", Information, „führen des Einsatztagebuches", Abschlussbericht | Lagekarte, Lagemeldung, ETB, Abschlussbericht | **vollständig ja** — Kerngeschäft der Klasse | Lage-Dashboard, Lagekarte, Lageberichte (Vorlagen Lagevortrag), Lagemeldungen, ETB |
| **S3 Einsatz** (S. 57) | Beurteilen, Entschluss, Abschnittsleiter bestimmen, Schadengebiet ordnen, „durchführen von Lagebesprechungen", „erteilen der Befehle", Kontrolle | Befehle (Gliederung 3.3.3.1, S. 37), Führungsorganisation | ja — Einsatzleiter selbst bzw. FA S2/S3 | Einsatzabschnitte, Aufträge, Befehle (LAD/LADEF), Erinnerungen, Meldungen |
| **S4 Versorgung** (S. 58) | Einsatzmittel anfordern, Verbrauchsgüter (Wasser, Löschmittel, Atemschutz, Kraftstoffe), Verpflegung, Materialerhaltung, Unterkünfte | Nachforderung, Versorgungsorganisation | Nachforderung/Betriebsstoffe bei Langzeitlage: ja · Unterkunft: Stab | Material, Fahrzeuge, Nachforderungen, UHS-Material |
| **S5 Presse- und Medienarbeit** (S. 59) | Presse-/Medienlage, Presseinformationen, Pressekonferenzen, Informationstelefone, Warn-/Suchhinweise | Presseinformation | erst im Stab; im ELW höchstens Kontakt/Freigabe | **nichts** (0 Treffer im Repo) |
| **S6 Information und Kommunikation** (S. 60) | Ist-Zustand Fernmeldeorganisation, „absprechen der Führungsorganisation mit S 3", Kanäle aufteilen, „Kommunikationskonzept einschließlich Fernmeldeskizze", Nachweisung des Kommunikationsbetriebs | **Funkplan** tabellarisch (Anlage 5, S. 66), Fernmeldeskizze | Sprechgruppenzuweisung/Funkplan: ja ab Stufe B · Skizze/Konzept: Stab | Sprechgruppen (TMO/DMO, M:N Abschnitt/Einheit), Kommunikationsmittel/Erreichbarkeit, Chat |

### 2.3 Führungsvorgang und Lagebesprechung

| Aussage | Quelle |
|---|---|
| Führungsvorgang = Lagefeststellung → Planung (Beurteilung, Entschluss) → Befehlsgebung, „immer wiederkehrend". | FwDV 100 Abschn. 3.3, S. 27–28 |
| Entschluss-Inhalte: Maßnahmen, Kräfte/Mittel, Anforderungen, Abschnitte, Schwerpunkte, Reserven, BR. | FwDV 100 Abschn. 3.3.2.2, S. 36 |
| „Wichtige mündlich erteilte Befehle sind bei oder unmittelbar nach Erteilung zu dokumentieren." Gesamtbefehle „können mit notwendigen Lagebesprechungen kombiniert werden". | FwDV 100 Abschn. 3.3.3.2, S. 42; 3.3.3.3, S. 41 |
| Das ETB enthält Lagefeststellung, Befehle, besondere Vorkommnisse „und erforderlichenfalls Beurteilung und Entschluss"; es ist der Nachweis der Tätigkeit der Einsatzleitung. | FwDV 100 Anlage 5, S. 64 |
| **Die FwDV 100 regelt weder Ablauf noch Rhythmus der Lagebesprechung** — nur: S2 bereitet vor, S3 führt durch (Anlage 2, S. 56/57; Informationsübertragung 3.4.3, S. 49). | FwDV 100 |
| Vortragsreihenfolge S2 → jeder Abschnittsleiter → S1 → S4 → S6 → Fachberater → S3 → „Termin nächste Besprechung"; die Lagekarte wird **nach** der Besprechung angepasst. | HLFS „Aufgaben Sachgebiet S3", Kap. 4, S. 11 `[sekundär: Lehrmeinung]` |
| Dauer 10–15 Minuten, 5-Minuten-Vorsignal. | HCT Stabsschulung `[sekundär: kommerzielle Quelle, keine Norm]` |
| Lagevortrag-Gliederung I Allgemeine Lage · II Eigene Lage · III Medienlage, Zusammenfassung, Zeitpunkt der nächsten Besprechung; „nur Neuerungen vortragen"; unerledigte Aufträge „als Liste am Arbeitsplatz" überwachen. | DRK RLP „Führungsvorgang (Ablauf)", Folien 9–13 `[sekundär]` |

**Ableitung `[abgeleitet]`:** Der Termin der nächsten Besprechung ist die **Ausgabe** jeder Besprechung.
Das deckt sich mit LFH-463 („ein explizit gepflegter Termin; kein berechneter oder vorbelegter
Rhythmus", `migrations/0101`). Ein Vortragsschema, ein Rhythmus oder eine Vorlaufminute sind Lehrmeinung
und werden **nicht** als Datenmodell kodiert.

### 2.4 Rollen, Organisationen, Abgrenzung Verwaltungsstab

- **Führungsassistent** (FwDV 100 Anlage 1, Nr. 1.1.4, S. 51): unterstützt den Einsatzleiter innerhalb einer
  Führungseinheit; Beispiele Leiter des Stabes, Sachgebietsleiter S1–S6, Sichter. Er unterstützt, er
  entscheidet nicht.
- **Führungshilfspersonal** (Anlage 1, Nr. 1.1.5): Lagekartenführung, Botendienst, Einsatztagebuchführung,
  Sprechfunk — **keine Sachgebiete**.
- **Fachberater/Verbindungspersonen** (Abschn. 3.2.2.2, S. 16; Anlage 3, S. 61): eigene Kategorie, kein
  Sachgebiet.
- **Leiter des Stabes** und **Sichter**: Stufe D; auf B/C in keiner gefundenen Länderbesetzung vorhanden.
- **S1–S6 heißen organisationsübergreifend gleich** (DV 100 LSA 2011 und DRK-DV 100 wortgleich); Labelvarianten
  nur bei THW (S4 „Versorgung (Logistik)", S5 „Öffentlichkeitsarbeit", S6 „Fernmeldeeinsatz"); S7 PSNV ist
  keine FwDV-100-Kategorie (Bayern/THW ergänzend, BayZBE Übersicht Stabsfunktionen 03.03.2020, S. 2).
- **Verwaltungsstab ist nicht gemeint.** Er ist die administrativ-organisatorische Komponente neben dem
  Führungsstab (BBK-Glossar „Verwaltungsstab", IMK-Beschluss 08.07.2004; FwDV 100 Abschn. 3.2.4.3, S. 24–25)
  und gliedert sich in Verwaltungsstabsbereiche Vb 1–16 (LFS-BW VwS-Grundlagen 05.02.2026, Abschn. 4.5,
  S. 9), nicht in S1–S6. Dieses Modul bildet die **operativ-taktische** Komponente ab.

### 2.5 Stand der Technik

Fireboard, Eurocommand CommandX, edp, Alamos, Divera, ELStab/ELGroup, DISMA wurden geprüft. Der
gemeinsame Nenner ist ETB, Lagekarte, Kräfte-/Abschnittsbaum, Auftrags-/Anforderungsliste, Nachrichten
mit Quittung, Mehrplatz mit Rollen — alles im Bestand vorhanden. **Kein Produkt bewirbt öffentlich
Sachgebiets-Arbeitsplätze, einen Sichter-Postkorb, ein Lagevortragsschema oder einen
Lagebesprechungs-Timer** `[abgeleitet aus den Produktseiten]`. Enthaltsamkeit ist marktkonform; zugleich
gibt es für den Kern dieses Moduls keinen Feldbeleg — deshalb Entscheidung 17 (Abbruchkriterium).

## 3. Gesetzte Annahmen (übernommen, nicht neu verhandelt)

- **UI-Form nach LFH-19**, **Bedien-Leitlinie LFH-327** (Fükw primär, Prüfliste als eigene Datei),
  **Erfassungs-Norm B4** (`components/Erfassung.tsx`), Deeplinks nur über `routing/deeplinks.ts`,
  Query-Keys nur über `api/queryKeys.ts`, Typ-Codegen, Statuscode-Konvention LFH-267, Extractor-Vertrag,
  Schwärzungs-Registry, Aktionsbündelung ab drei, „Rot bedient nichts", Emoji ≠ Ikone.
- **Schreibrecht-Norm** aller Einsatzmodule: `darfImEinsatzSchreiben` (`frontend/src/einsatz/schreibrecht.ts:61`),
  backendseitig `EinsatzSchreibzugriff<M>` (`src/einsatz/kontext.rs`).
- **`einsatz.naechste_lagebesprechung_at`** bleibt der explizit gepflegte Termin ohne Rhythmus (LFH-463) und
  wird im ETB-Wiedervorlage-Modal als Schnellwahl konsumiert (`etb/WiedervorlageModal.tsx`).
- **`EINSATZ_KEYS.einsatz` steht in `NICHT_LIVE_KEYS`** (`frontend/src/api/queryKeys.ts:158`): der Einsatzkopf
  ist nicht live.
- **Eine Stärke wird einmal summiert** (`anzeige/staerke.ts:summiereStaerke`); Zahlen, die der Bestand
  verdichtet, werden nicht ein zweites Mal gerechnet.
- **Contentbreite im Fükw:** 1366 × 768 px mit offenem Modul-Panel ergibt **1022–1033 px** Contentbreite
  (gemessen: `2026-09-08-lfh-464-layoutmessung.csv`, Zeile `1366 → 1022`; `2026-08-21-lfh-342-pruefliste.md`
  nennt 1033 px). Die oft zitierten **693 px** sind das Budget der Gefahrenmatrix bei 1280 px *neben einer
  Gebietsliste* (`2026-07-30-gefahrenmatrix-bedienbare-bewertung.md:1052`) und gelten hier nicht. **Regelfall
  für alle Breitenaussagen dieser Spec ist 1366 px mit offenem Panel;** die Playwright-Messung fährt genau
  diesen Zustand.

## 4. Entscheidungen

Nummeriert, je mit Begründung im selben Absatz. Wo das Ticket etwas anderes nahelegt, steht es dabei.

1. **Zielkontext v1 ist die Führungsstufe B/C im Führungsfahrzeug der ELW-1-Klasse** (Fükw, ELW 1,
   KdoW mit Führungstrupp): zwei bis vier Personen, 1366 × 768 px, Tastatur und Maus, Nachtmodus als
   Regelfall. Der Stabsraum (Stufe D, ELW 2, Sichter, Leiter des Stabes, Postkörbe) ist ausdrücklich
   **kein** Ziel dieser Version (Quellen 2.1). Alles, was erst dort gebraucht wird, steht in Abschnitt 6 mit
   Fundstelle draußen.

2. **Was S1–S6 im Produkt SIND: Aufgabenzuordnungen, keine Arbeitsplätze.** Jedes Sachgebiet ist eine
   feste Zeile mit einem Besetzungszustand, einem Aufgaben-Kurztext aus Anlage 2, höchstens zwei
   Lücken-Kennzahlen und Deeplinks in die Module, in denen gearbeitet wird. Das nimmt Anlage 2, S. 54 beim
   Wort („Anregung, Erinnerung und Unterstützung"): eine Merkhilfe für die Einsatzleitung, keine
   Aufbauorganisation von Bildschirmen. Sechs Sektionsrouten oder Reiter je Sachgebiet würden genau das
   institutionalisieren, was Stufe B nicht hat (2.1: S1/S4/S5/S6 sind dort Aufgaben ohne Rolle) und was
   kein Marktprodukt anbietet (2.5). **Das ist die Antwort auf die Ticketfrage**, und sie ist eine
   Entscheidung, kein Nebenprodukt.

3. **Besetzungszustände je Sachgebiet:** *keine Zeile* = „nicht vergeben" · `einsatzleitung` = „liegt
   bewusst bei der Einsatzleitung" (Zusammenlegung, Anlage 2, S. 54) · `personal` = eine disponierte Person
   (`einsatz_personal`) · `extern` = Name ohne Disposition (Freitext) · `rueckwaertig` = eine Stelle
   („Leitstelle", „FEZ"; Übertragung nach Abschn. 3.2.2.2, S. 16). **Der Unterschied zwischen „nicht
   vergeben" und „bei der Einsatzleitung" ist die Anregungsfunktion** („haben wir S4 bedacht?") — er ist
   der Grund, warum vier leere Zeilen im Fükw kein Leerzustand sind, sondern eine Aussage. „Nicht vergeben"
   ist im Stufe-B-Normalfall keine Alarmfarbe: neutraler Tag mit Wort.

4. **Genau eine Zeile je Sachgebiet; Personalunion = dieselbe Person in mehreren Zeilen.** S2/S3 in
   Personalunion (RLP FüRi IV.2.1) sind zwei Zeilen mit derselben `personal_id`; „mehrere Sachgebiete je
   Assistent" (3.2.2.2, S. 15) ist damit abgebildet, „mehrere Personen je Sachgebiet" bewusst nicht — das
   ist Stufe D und würde die Zeile in eine Liste verwandeln. Deshalb `UNIQUE (einsatz_id, sachgebiet)`.

5. **Der Personenanker ist `einsatz_personal`, nicht `benutzer`.** Belegt am Bestand: `personal.benutzer_id`
   ist optional („Mehrheit der Kräfte hat kein Login", `migrations/0010`, mit partiellem UNIQUE-Index);
   Abschnittsleiter (`einsatzabschnitt.leiter_id`) und Einheitsführer (`einsatz_einheit.fuehrer_id`) zeigen
   bereits dorthin; `disposition_repo::liste_fuehrungskraefte` (`src/personal/disposition_repo.rs:356`)
   liest dieselbe Tabelle. Ein Konto-Zwang zwänge eine disponierte Einsatzkraft ohne Login — nach
   `migrations/0010` der Normalfall —, die S1 oder S4 übernimmt, in eine `extern`-Freitextzeile *neben*
   ihrem vorhandenen `einsatz_personal`-Datensatz: eine zweite Personenwahrheit, die das Repo an drei
   Stellen längst aufgelöst hat. **Fernmelder und Fachberater sind hier kein Beispiel** — sie bekommen
   nach Entscheidung 6 gar keine S-Zeile, in die sie gezwängt werden könnten. Die Benutzer-Kopplung für „meine Sachgebiete" entsteht
   **transitiv** über `personal.benutzer_id` (Entscheidung 11). `snap_name` wird beim Setzen eingefroren
   (Muster `einsatz_personal.snap_name`, `auftrag_empfaenger.snap_anzeige`): ein Führungsnachweis darf
   nicht mit der Disposition verschwinden.

6. **Führungshilfspersonal, Fachberater, Leiter des Stabes und Sichter werden in v1 nicht modelliert** — und
   sie werden auch **nicht in eine S-Zeile gefaltet**. Ein Fachberater ist kein Sachgebiet (Anlage 3, S. 61),
   ein Lagekartenführer trägt keines (Anlage 1, Nr. 1.1.5). Die Achse `art ∈ {leitung, fuehrungsassistent,
   fuehrungshilfspersonal, fachberater}` ist fachlich die sauberste Modellierung des Feldes und liegt als
   benannte Folgeentscheidung in Abschnitt 13; im Fükw der Stufe B trüge sie heute keine Bedienung.

7. **Keine Besetzungshistorie.** Ein Wechsel überschreibt die Zeile und schreibt einen System-ETB-Eintrag
   (Tier A, `etb::system_audit_tx`) mit Vorher/Nachher — das ETB ist der Nachweis der Tätigkeit der
   Einsatzleitung (Anlage 5, S. 64), und für Stufe B ist der Verlauf damit beweissicher rekonstruierbar,
   ohne abfragbar sein zu müssen. Ablösungsketten (`von_at/bis_at/vorgaenger_id`) sind Langzeit-/Stufe-D-Bedarf
   (THW-Ergänzung zu S1, **nicht** Teil der FwDV 100 Anlage 2 S. 55 — dort steht nur „führen von
   Kräfteübersichten"; Ablösung/Schichtdienst/Unterbringung stehen in der THW-Lernunterlage Zugtrupp,
   Abschn. 3.2, S. 14–15 `[sekundär]`, der Wortlaut der THW-DV 1-100 war nicht beschaffbar) und additiv
   nachrüstbar; `gesetzt_at` bleibt als Anker erhalten.

8. **Die Lagebesprechung ist ein schlankes Objekt, kein Lebenszyklus:** laufende Nummer, Zeitpunkt,
   **Entschluss (Pflicht)**, nächster Termin als Snapshot, Rückverweis auf den ETB-Eintrag. Kein Status
   „geplant/läuft", kein Vortragsschema, keine Teilnehmer, kein Protokoll, keine Vorbereitung aus acht
   Modulen. Begründung: die FwDV 100 regelt weder Ablauf noch Rhythmus (2.3); alles darüber hinaus wäre
   Lehrmeinung als Datenmodell. Der Entschluss ist Pflicht, weil er der Inhalt ist, den 3.3.2.2 (S. 36)
   der Planung zuschreibt und Anlage 5 (S. 64) ins ETB verlangt — „Lage unverändert, Maßnahmen fortführen"
   ist ein gültiger Entschluss, ein leerer Eintrag vom Typ `entscheidung` wäre semantisch leer.

9. **Der Abschluss ist EINE Transaktion:** ETB-Eintrag vom Typ `entscheidung` (Erfasser = aufrufender
   Benutzer, `ereigniszeit` = Zeitpunkt der Besprechung), Lagebesprechungszeile mit `etb_eintrag_id`,
   Aktualisierung von `einsatz.naechste_lagebesprechung_at` (Tri-State wie `routes/einsatz.rs:745`). Das
   ist 3.3.3.2 (S. 42, „bei oder unmittelbar nach Erteilung dokumentieren") in Code: der Beleg entsteht im
   Abschluss-Request, nicht nachgelagert. Muster: `src/lagebericht/repo.rs:freigeben` (ETB-Snapshot +
   Rückverweis in einer Transaktion).

10. **ETB-Typ des Belegs ist `entscheidung`, und das ist eine Vertragssetzung.** Der Typ existiert seit
    Migration 0004 und hat im gesamten Backend keinen Erzeuger; wer den ersten programmatischen baut, legt
    seine Bedeutung fest: *ein dokumentierter Entschluss der Einsatzleitung.* `lage` wäre falsch — den Typ
    trägt der freigegebene Lagebericht, und eine zweite Bedeutung desselben Typs kostete den ETB-Typfilter
    seine Aussage. Der Eintrag ist ein **fachlicher** Eintrag (kein `system`), weil er die Entscheidung der
    Einsatzleitung dokumentiert, nicht eine Systemhandlung.

11. **Terminwahrheit bleibt `einsatz.naechste_lagebesprechung_at`.** Der Stab **schreibt** sie beim Abschluss
    und **liefert sie im eigenen GET mit** — damit ist der Countdown auf beiden Fahrzeugschirmen live,
    obwohl der Einsatzkopf im `NICHT_LIVE`-Fach bleibt. `einsatz_lagebesprechung.naechste_at` ist der
    Snapshot des beim Abschluss gesetzten Termins (Beweiswert), keine zweite lebende Wahrheit. Die
    Einsatzdaten-Seite bleibt Pflegeort des Termins; sie zeigt den Wert bis zum nächsten Abruf ggf. veraltet
    — derselbe, dokumentierte Zustand, den LFH-463 mit dem Frischabruf im Wiedervorlage-Modal schon umgeht.
    **Kein zweiter Speicherort mit eigener Semantik, keine Spiegelregel nötig**, weil es nur eine Richtung gibt.

12. **Keine Rechte aus dem Sachgebiet.** Die einzige Schreibrechtachse bleibt `EinsatzRolle` /
    `darfImEinsatzSchreiben`, backendseitig `EinsatzSchreibzugriff<Stab>`. „S3 darf Aufträge erteilen" ist
    die naheliegendste und falscheste Fortschreibung (Anlage 1, Nr. 1.1.4: der Führungsassistent
    unterstützt, er entscheidet nicht). Im ELW 1 sitzt der Assistent am Gerät, die Einsatzleitung nicht
    (RLP FüRi IV.2.1) — Einsatzleitung *und* Führungspersonal pflegen Besetzung und Lagebesprechung,
    Beobachter lesen. Kein Registry-Default `benoetigteRolle`; der Modul-Override bleibt einsatzweise möglich.

13. **Vorrangregel Führungsstelle ↔ Besetzung** (die Zwei-Wahrheiten-Frage, die alle vier Entwürfe
    verschoben hatten): Die ETB-Empfänger-Vorbelegung liest **zuerst** die explizit gesetzte
    `einsatz_mitgliedschaft.fuehrungsstelle`, **sonst** das erste Sachgebiet, das die mit dem Benutzer
    verknüpfte Person (`personal.benutzer_id`) besetzt, **sonst** nichts. Eine getroffene Wahl gewinnt
    immer gegen eine Ableitung (dieselbe Regel wie bei der Dichtestufe, LFH-361). Das Führungsstellen-Modal
    in `pages/MitgliederAbschnitt.tsx` nennt den Vorrang im `extra`-Text. Die Ablösung des Freitextfelds ist
    Teil des Folge-Tickets „Funktionskatalog" (Abschnitt 13), nicht dieser Spec.

14. **Vorschläge statt Fremdschlüssel in den Freitext-Empfängerfeldern.** Zwei echte
    Funktions-Freitextspalten — `erinnerung.empfaenger_funktion` („noch kein FK; Stab-Modell folgt
    später", `migrations/0044_erinnerung.sql:14`) und `auftrag_empfaenger.funktion_text` (`0048`) —
    plus die beiden ETB-Metadatenfelder `etb_eintrag.von`/`an` (`migrations/0004_etb.sql`;
    **eine `etb_eintrag.empfaenger_funktion` gibt es nicht**) bekommen in ihren Masken Vorschläge der
    Form „S2 – Lage (Müller)" aus der Besetzung; der Freitext bleibt. Die ETB-Felder sind dabei
    semantisch etwas anderes: sie tragen heute Funkrufname/Stelle, nicht Sachgebiet — `useFunkrufnamen`
    (`etb/funkrufnamen.ts`) speist sie aus disponierten Fahrzeugen und Einheiten. Der Stabsvorschlag
    tritt dort **neben** die Funkrufnamen, er ersetzt sie nicht. Kein FK-Umbau in diesem Ticket: eine
    halbe Migration (zwei der vier betroffenen Tabellen `erinnerung`, `auftrag_empfaenger`,
    `etb_eintrag`, `einsatz_mitgliedschaft`) wäre der schlechteste Zwischenzustand, und keine Regex
    über Freitext — ein falsch geschriebenes „Versorgung" fiele still heraus, ohne roten Test und ohne
    Fehlerbild. Der FK-Umbau ist das Folge-Ticket, das den Kommentar in 0044 einlöst.

15. **Lücken-Kennzahlen, höchstens zwei je Zeile, ausschließlich aus vorhandenen Queries:** S1 „Einheiten
    ohne Führer" · S3 „Abschnitte ohne Leiter", „Aufträge ohne Quittung" · S4 „Nachforderungen ohne Zusage" ·
    S6 „Abschnitte ohne Sprechgruppe". S2 zeigt statt einer Lücke den Lagebesprechungs-Stand, S5 hat keine
    Datenquelle und zeigt keine Zahl. Das ist Anlage 2 als Datenfläche: das Dashboard zählt Bestände, der
    Stab zählt Lücken je Verantwortungsbereich. Gerechnet wird als Filter über die bereits geladenen Listen
    (`einsatzKeys.einheiten/abschnitte/auftraege/nachforderungen`), **nie** als zweite Verdichtung einer
    Zahl, die `lagebild.ts`/`kraeftebild.ts`/`summiereStaerke` schon liefern. Wo eine Zahl auf Dashboard
    und Stab steht, kommt sie aus derselben exportierten Funktion.

16. **UI-Form: eine Route, eine Vollseite, eine Liste, zwei Modale.** `/einsaetze/:id/stab` ist eine
    Vollseite aus `EinsatzSeite` mit zwei Sektionen (Lagebesprechung · Besetzung S1–S6); die Besetzung ist
    eine `components/Liste.tsx` mit sechs festen Zeilen — hier wird nichts verglichen, sortiert oder
    gefiltert (LFH-330/B2), also keine Tabelle, kein `Datensicht`, kein Guard-Inventar. Beide Masken nehmen
    `ErfassungsModal`. Kein Drawer, kein Sektionsrouting (zwei Sektionen auf einer Seite rechtfertigen
    kein Reiterband), keine Item-Route (eine Lagebesprechung hat keine Detailform > 5 Felder; ihr Beleg ist
    der ETB-Eintrag).

17. **Abbruch-/Rückbaukriterium.** Kein Entwurf hat einen Feldbeleg für seinen Kern (2.5), und „sechs Zeilen
    in unter einer Minute gepflegt" ist `[abgeleitet]`, nicht gemessen. Deshalb: nach der ersten Übung mit
    echter Fahrzeugbesatzung wird gezählt, ob (a) die Besetzung gepflegt und (b) mindestens eine
    Lagebesprechung über das Modul abgeschlossen wurde. Bleibt (a) aus, wird die Besetzungsliste auf die
    Lagebesprechung reduziert; bleibt (b) aus, wandert der Abschluss als Aktion ins ETB-Modul und das
    Stab-Modul geht zurück auf `wip`. Kein Ausbau (Abschnitt 13) vor diesem Befund.

18. **Registry-Freischaltung ist ein eigener Schritt mit gemessener Testmenge.** `stab` ist der **einzige**
    `wip`-Eintrag; nach dem Flip gibt es keinen WIP-Stellvertreter mehr. Gemessen betroffen (`grep 'stab'`
    über Testdateien, dann die Frage: hängt der Treffer am Status oder nur am Pfad?):
    `frontend/src/App.test.tsx:52-59, 75-77, 153-154` (Literal „🚧 Stab"), `einsatz/ModulStub.test.tsx`
    (liest `stab` aus der Registry, `:60-65` „stab = wip"), `einsatz/modulRegistry.test.ts:141`
    (`aufloeseStandardModul('stab')`). **Nicht** betroffen: `components/Platzhalter.test.tsx` (nur der
    Pfadstring), `command-palette/befehle.modulstatus.test.ts` (baut sich einen `personen`-Stub). Der Umzug
    dieser drei Dateien auf einen Registry-Stub ist ein eigener, verhaltensneutraler Subtask **vor** dem
    Flip — sonst ist an einem roten Test nicht unterscheidbar, ob er die Statusachse oder den Stub meldet.

## 5. Verworfene Alternativen

| Alternative | Warum verworfen |
|---|---|
| **Sachgebiets-Cockpit:** sechs Sektionsrouten S1–S6 mit Kachelflächen nach dem Dashboard-Bauplan | Doppelt Lage-Dashboard und Kommunikationsmodule (S2/S3), 5–8 Queries je Reiter, institutionalisiert Arbeitsplätze, die Stufe B nicht hat (2.1) und die kein Produkt anbietet (2.5). Die tragende Idee „Lücken statt Bestände" ist als Entscheidung 15 übernommen; der abgeleitete Funkplan als Folge-Ticket (Abschnitt 13). |
| **Funktionsmodell zuerst:** org-weiter Katalog `stabsfunktion_katalog`, Zeitachse mit Ablösungskette, zwölfte Admin-Stammdaten-Sektion, FK-Migration an Auftrag/Erinnerung | Nach 60 Sekunden statisch, Wert erst über drei Anschluss-Subtasks; Ablösungsverwaltung und Admin-Pflege sind Stufe-D-Arbeit; erzeugt eine dritte Personenwahrheit „Einsatzleitung" (Rolle vs. Funktion). Übernommen: Personenanker `einsatz_personal`, Snapshot-Disziplin, die `art`-Achse als Folgeentscheidung. |
| **Lagebesprechung als Kernobjekt:** Lebenszyklus geplant → läuft → abgeschlossen, acht Vortrags-Slots, serverseitige Vorbereitung aus acht Modulen, Autosave, Navigationsblocker, Checkliste Arbeitsaufnahme | 19 Felder für eine Absprache, die im Fükw drei Minuten dauert; Kern ist Lehrmeinung (Vortragsschema, 5-Minuten-Vorsignal); `vorbereitung.rs` wäre eine zweite Verdichtung neben `lagebild.ts`/`kraeftebild.ts`. Übernommen: Entschluss als Pflicht, Typ `entscheidung`, Snapshot im Abschluss-Request, deterministisches Rendern. |
| **Vierte Lagebericht-Vorlage „Lagebesprechung"** statt eigenem Objekt | Der Lagebericht trägt keinen Termin, keine Pflicht „Entschluss" (`validiere_freigabe` prüft nur Struktur) und keine Nummer je Besprechung; LFH-48 hat Auto-Aggregation als Nicht-Ziel gesetzt. Bleibt der ehrliche Rückfall, wenn das Budget für ST2/ST5 kippt — dann ohne Termin-Kopplung. |
| **Besetzung referenziert `benutzer`** (Konto) | Verlangt ein Login genau für das Personal, das keines hat (Anlage 1, Nr. 1.1.5; `migrations/0010`); kein Anschluss an Lagekarte und Kräfteübersicht. |
| **Regex-Postkorb** über die Freitext-Funktionsfelder (`^S\s?([1-6])\b`) | Ersetzt ein Datenmodell durch Schreibdisziplin; stiller Ausfall bei jeder Schreibvariante — die Fehlerklasse, gegen die das Repo sonst baut. |
| **Vorsignal-Erinnerung mit 5-Minuten-Vorlauf** als Konstante | Der Wert ist eine kommerzielle Quelle; die FwDV 100 nennt keinen. Wenn ST8 gebaut wird, ist die Fälligkeit der Termin selbst (Abschnitt 8). |

## 6. Scope-Abgrenzung

**Drin (v1):**
- Besetzung S1–S6 mit den vier Zuständen aus Entscheidung 3, Anlage-2-Kurztext und Deeplinks je Zeile.
- Lagebesprechung abschließen (Entschluss, nächster Termin) als eine Transaktion mit ETB-Beleg; Kopfblock
  mit nächstem Termin (Countdown/„überfällig" als Wort), letzter Besprechung (Nr., DTG, Entschluss-Kurz,
  Link zum ETB-Beleg) und Historie.
- Lücken-Kennzahlen (Entscheidung 15).
- Vorschläge in ETB an/von, Erinnerungs- und Auftragsempfänger; ETB-Vorbelegung nach Entscheidung 13.
- Modul-Freischaltung (`wip → fertig`), Kommandopaletten-Schnellaktion „Lagebesprechung abschließen".
- Prüfliste Einsatztauglichkeit als eigene Datei, Playwright-Nachweise (Abschnitt 11).

**Draußen (→ Ziel):**
- Kommunikationskonzept/Fernmeldeskizze (Anlage 2 S. 60 — Stab/ELW 2), tabellarischer **Funkplan**
  (Anlage 5 S. 66) → Folge-Ticket „Funkplan (S6)", Abschnitt 13.
- Presse-/Medienarbeit über die Besetzungszeile hinaus (Anlage 2 S. 59; 0 Treffer im Repo) → Folge-Spec.
- Verpflegung, Betriebsstoffe, Unterkunft, Materialerhaltung (Anlage 2 S. 58; 0 Treffer) → Folge-Spec
  „Versorgung Langzeitlage", Träger wäre das Material-/Nachforderungsmodul, nicht der Stab.
- Kräfte-Zeitachse (Alarmierung/Eintreffen), Ablösung, Schichtplan, Ruhezeiten (THW-Ergänzung zu S1) →
  Folge-Spec; braucht eine Statushistorie am Personal, die es nicht gibt (nur `br_belegung` trägt eine Zeitachse).
- Führungshilfspersonal, Fachberater, Leiter des Stabes, Sichter (Entscheidung 6) → Folgeentscheidung.
- Vortragsschema, Tagesordnung, Protokoll, Teilnehmer, Rhythmus, Timer, automatische Folgebesprechung
  (Entscheidung 8; LFH-463).
- FK-Umbau der Freitext-Funktionsfelder und Ablösung von `fuehrungsstelle` (Entscheidung 14) → Folge-Ticket.
- Zusammengelegte Sicht „Lage und Einsatz" (S2/S3) als eigene Fläche; mandantenkonfigurierbare Labels
  (THW/DRK), S7 PSNV → erst nach Feldbefund.
- Verwaltungs-/Krisenstab (Vb 1–16), Stabsverbund über Einsätze hinweg, Mehrplatz-Konfliktauflösung.
- Ein Einzel-GET je Lagebesprechung (die Listenform trägt alle Felder — LFH-346/H36); ein ETB-seitiger
  Rückverweis (`etb_eintrag.lagebesprechung_id`) — ein ETB-Chip ist ein ETB-Feature, eigenes Ticket.

## 7. Nicht-Ziele (YAGNI)

- Kein Arbeitsplatz je Sachgebiet, keine Postkörbe, keine Meldungsverteilung an S1–S6.
- Keine Rechte aus dem Sachgebiet (Entscheidung 12).
- Kein Nachbau von Lagekarte, ETB, Lagebericht, Befehl, Auftrag, Erinnerung, Nachforderung,
  Kräfteübersicht, Sprechgruppen — nur Deeplinks, Vorschläge, Filter über geladene Listen.
- Keine zweite Verdichtung einer Zahl, die der Bestand schon rechnet.
- Keine Migration an `etb_eintrag`, `auftrag_empfaenger`, `erinnerung`, `einsatz_mitgliedschaft`.
- Kein Druck-/PDF-Layout der Besprechung: der ETB-Eintrag ist das Dokument, der ETB-Druck existiert.
- Keine Offline-Queue mit `client_id`-Idempotenz für den Abschluss: er ist eine bewusste Online-Aktion am
  Fahrzeug; ein Doppelklick wird durch den `sendetRef`-Riegel der Hülle und die Server-Nummerierung
  abgefangen, ein Replay legte eine zweite Besprechung an — das ist im Fükw sichtbar und korrigierbar
  (Nummer n+1 mit gleichem Entschluss), anders als die stille Dublette einer Sichtung (LFH-340/C5).

## 8. Datenmodell — Migration `0102_stab.sql`

`0101_einsatz_lagebesprechung.sql` ist die letzte Migration; diese ist die nächste. Zeiten als UTC
`'YYYY-MM-DD HH:MM:SS'` wie im Bestand.

```sql
-- LFH-46: Führungsorganisation (Besetzung S1–S6) und Lagebesprechungen einer Einsatzleitung
-- der Führungsstufe B/C. Sachgebiete sind Aufgabenzuordnungen (FwDV 100 Anlage 2), keine
-- Rechte- und keine Arbeitsplatzachse. Keine Zeile = „nicht vergeben"; Wechsel werden
-- nicht historisiert, sondern als System-ETB-Eintrag nachgewiesen (Anlage 5).
CREATE TABLE einsatz_stabsfunktion (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    sachgebiet     TEXT    NOT NULL CHECK (sachgebiet IN ('s1','s2','s3','s4','s5','s6')),
    -- einsatzleitung = bewusst bei der EL (Zusammenlegung, Anlage 2 S. 54)
    -- personal       = disponierte Person (personal_id + snap_name)
    -- extern         = Person ohne Disposition (bezeichnung = Name)
    -- rueckwaertig   = rückwärtige Stelle, z. B. Leitstelle/FEZ (3.2.2.2 S. 16; bezeichnung = Stelle)
    besetzung_art  TEXT    NOT NULL CHECK (besetzung_art IN ('einsatzleitung','personal','extern','rueckwaertig')),
    personal_id    INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    snap_name      TEXT,           -- Name der Person zum Zeitpunkt des Setzens (Führungsnachweis)
    bezeichnung    TEXT,           -- extern/rueckwaertig: Name bzw. Stelle (≤ 200 Zeichen)
    gesetzt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    gesetzt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, sachgebiet)
);
CREATE INDEX idx_stabsfunktion_einsatz ON einsatz_stabsfunktion(einsatz_id);

-- Eine abgeschlossene Lagebesprechung. Der Entschluss steht im ETB (typ='entscheidung'); die
-- Zeile trägt Nummer, Zeitpunkt und den Termin-Snapshot. Die lebende Terminwahrheit bleibt
-- einsatz.naechste_lagebesprechung_at (LFH-463).
CREATE TABLE einsatz_lagebesprechung (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lfd_nr         INTEGER NOT NULL,
    abgehalten_at  TEXT    NOT NULL,
    entschluss     TEXT    NOT NULL,
    naechste_at    TEXT,           -- Snapshot des beim Abschluss gesetzten Termins
    etb_eintrag_id INTEGER NOT NULL REFERENCES etb_eintrag(id),
    erfasst_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erfasst_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, lfd_nr)
);
CREATE INDEX idx_lagebesprechung_einsatz ON einsatz_lagebesprechung(einsatz_id, abgehalten_at);
```

**Invarianten im Code** (kein Mehrspalten-CHECK, wie `auftrag_empfaenger`): `personal` ⇒ `personal_id`
gesetzt, Person gehört zu diesem Einsatz, `snap_name` gefüllt; `extern`/`rueckwaertig` ⇒ `bezeichnung`
nicht leer und ≤ 200 Zeichen (Länge wie `fuehrungsstelle`, `routes/einsatz.rs:577`); `einsatzleitung` ⇒
alle drei NULL. `lfd_nr` ist server-autoritativ und lückenlos je Einsatz (`COALESCE(MAX(lfd_nr)+1, 1)`
unter `write_retry!`, Muster `auftrag`/`etb`).

**Schwärzungs-Registry** (`src/einsatz/schwaerzung_registry.rs`, Pflicht — der Guard bricht sonst rot):
- `einsatz_stabsfunktion`, `Scoping::EinsatzId`: retain `id` (G_PK), `einsatz_id` (G_SCOPE), `sachgebiet`
  und `besetzung_art` (G_ENUM), `personal_id`, `gesetzt_von_id` (G_FK), `gesetzt_at` (G_ZEIT); **scrub**
  `snap_name` und `bezeichnung` (`Strategie::NullSetzen` — Name eines Externen ist PII; dieselbe Linie wie
  `einsatz_mitgliedschaft.fuehrungsstelle`, Zeile 727).
- `einsatz_lagebesprechung`, `Scoping::EinsatzId`: retain `id`, `einsatz_id`, `lfd_nr` (G_ZAEHLER),
  `abgehalten_at`, `naechste_at`, `erfasst_at` (G_ZEIT), `etb_eintrag_id`, `erfasst_von_id` (G_FK);
  `entschluss` **retain (G_FUEHRUNG)** — dieselbe Klassifikation wie `lagebericht.abschnitte` (Zeile 1018)
  und `befehl`, deren Inhalt derselbe Entschluss ist. Ein Alleingang auf `Scrub` für eine Tabelle wäre
  inkonsistent; falls die Linie „Führungs-Freitexte scrubben" kommt, dann für alle drei gemeinsam.

**Enums mit Wire-Kontrakt** (`tests/enum_wire_kontrakt.rs`, exhaustiver `match`, voll qualifizierte Pfade):
`Sachgebiet { S1..S6 }` → `'s1'..'s6'`; `BesetzungArt { Einsatzleitung, Personal, Extern, Rueckwaertig }`
→ snake_case. Beide in `src/api_doc.rs` registrieren; der Inventar-Guard verlangt je Enum einen Block.

**Response-DTOs** (`ToSchema`, `Option<T>` mit `skip_serializing_if`, Presence im Test per `contains_key`):

```
StabsfunktionAnzeige   { sachgebiet, besetzung_art, personal_id?, name? (snap_name bzw. bezeichnung),
                         personal_noch_disponiert: bool, gesetzt_von_id, gesetzt_at }
LagebesprechungAnzeige { id, einsatz_id, lfd_nr, abgehalten_at, entschluss, naechste_at?,
                         etb_eintrag_id, erfasst_von_id, erfasst_at }
StabAnzeige            { besetzung: Vec<StabsfunktionAnzeige>  (nur belegte Zeilen; Reihenfolge s1..s6),
                         letzte_lagebesprechung: Option<LagebesprechungAnzeige>,
                         anzahl_lagebesprechungen: i64,
                         naechste_lagebesprechung_at: Option<String> }   // aus einsatz, s. Entscheidung 11
EinsatzAnzeige        += meine_sachgebiete: Vec<Sachgebiet>  (#[schema(required)], leer statt absent)
```

**Request-DTOs** (FE-lokal in `frontend/src/api/types.ts`): `BesetzungSetzen { besetzung_art, personal_id?,
bezeichnung? }`, `LagebesprechungAbschluss { entschluss, abgehalten_at?, naechste_at?: string | null }`
(Tri-State: fehlt = Termin unverändert, `null` = Termin löschen, Wert = setzen).

## 9. Backend — `src/stab/{mod.rs, repo.rs}` + `src/routes/stab.rs`

**Verdrahtung:** `modul_marker! { …, Stab => "stab" }` und `PFAD_KEY += ("/api/einsaetze/{id}/stab", Some("stab"))`
in `src/einsatz/modul.rs`; `MODUL_KEYS` bleibt bei 25 (`stab` existiert). Routen in `src/app.rs` (flache
Kette). Handler ausschließlich über `JsonBody`, `PfadParam`, `EinsatzLesezugriff<Stab>` /
`EinsatzSchreibzugriff<Stab>`; das neue Modul kommt **nicht** in `DEFERRED_MODULE`
(`tests/einsatz_kontext_guard.rs`).

| Route | Gate | Verhalten |
|---|---|---|
| `GET /api/einsaetze/{id}/stab` | Lese | `StabAnzeige`. Termin aus `einsatz` mitgeliefert (Entscheidung 11). |
| `PUT /api/einsaetze/{id}/stab/besetzung/{sachgebiet}` | Schreib + `fordere_aktiv` | Upsert (`INSERT … ON CONFLICT(einsatz_id, sachgebiet) DO UPDATE`). In einer `write_retry!`-Transaktion: Vorherstand lesen, Person-Zugehörigkeit prüfen, `snap_name` aus `einsatz_personal.snap_name`, Zeile schreiben, System-ETB Tier A („S2 Lage: Besetzung → Müller (vorher: nicht vergeben)"), danach `LiveEvent::Stab`. Antwort `StabAnzeige`. |
| `DELETE /api/einsaetze/{id}/stab/besetzung/{sachgebiet}` | Schreib + `fordere_aktiv` | Zeile entfernen = „nicht vergeben"; System-ETB; `LiveEvent::Stab`. **Idempotent:** keine Zeile = bereits „nicht vergeben" → **204 ohne ETB-Eintrag und ohne Live-Ereignis** (Begründung 9.2). |
| `GET /api/einsaetze/{id}/stab/lagebesprechungen` | Lese | Liste absteigend nach `lfd_nr`; kein Cursor in v1 (Fükw-Einsatz: Dutzende, nicht Tausende `[abgeleitet]`; Paginierung ist Stufe-D-Bedarf). |
| `POST /api/einsaetze/{id}/stab/lagebesprechungen` | Schreib + `fordere_aktiv` | **Eine Transaktion** (`write_retry!`): `lfd_nr` = MAX+1; `etb::repo::anlegen_tx` mit `typ = TYP_ENTSCHEIDUNG`, `ereigniszeit = abgehalten_at`, `veranlassung = "Lagebesprechung"`, Inhalt deterministisch gerendert (Abschnitt 9.1); Zeile mit `etb_eintrag_id`; bei vorhandenem Schlüssel `naechste_at`: `UPDATE einsatz SET naechste_lagebesprechung_at` — geführt als `WHERE id = ? AND status = 'aktiv'` mit ausdrücklichem Rollback bei `rows_affected == 0` (Muster `lagebericht/repo.rs:256-262`); das ist keine Redundanz zu `fordere_aktiv`, sondern der **einzige anfahrbare Rollback-Zweig** dieser Transaktion und damit der Träger der Atomaritäts-Zusicherung aus 9.5. Publiziert `LiveEvent::Stab` und den ETB-Kurzruf `live.publiziere(einsatz_id, etb_id)`. Antwort: `StabAnzeige`, **nach** dem Schreiben frisch geladen (die Quittung trägt keinen Zustand, den es nie gab — LFH-340/C5). |

**9.1 Snapshot-Text** (deterministisch, zweimal rendern ist gleich — Test wie `lagebericht/mod.rs:238`):

```
Lagebesprechung Nr. {n} ({DTG abgehalten_at})
Entschluss: {entschluss}
Nächste Lagebesprechung: {DTG naechste_at} | kein Termin
```

Leere Angaben werden ausgelassen („nur Neuerungen", DRK RLP `[sekundär]`); der Erfasser ist der
aufrufende Benutzer, nicht die als S3 besetzte Person (das Konto belegt die Urheberschaft, die Besetzung
nicht).

**9.2 Statuscodes** (LFH-267): unbekanntes `sachgebiet` im Pfad, unbekannte `besetzung_art`, `bezeichnung`
> 200 Zeichen, leerer `entschluss`, nicht parsebares `abgehalten_at`/`naechste_at` → **400** (Feld isoliert).
`personal` ohne `personal_id`, `extern`/`rueckwaertig` ohne `bezeichnung`, `einsatzleitung` mit Person
(bedingte Pflicht = Zusammenhang, Referenzpaar `einsatz_tier.rs`/Status), `personal_id` nicht in diesem
Einsatz (referenzielle Zuordenbarkeit, `src/sprechgruppe/repo.rs:216-243` — `pruefe_zuordenbar`, Fehler bei `:234`), `naechste_at` ≤ `abgehalten_at` →
**422**. Abgeschlossener Einsatz → Code von `fordere_aktiv` aus dem Bestand. Fremde Org/fremder Einsatz →
404 aus dem Extractor; Beobachter → 403.

**Der DELETE ist idempotent, und das ist eine Setzung gegen die Bestandskonvention.** Rund dreissig
DELETE-Repos im Bestand (`uhs/platz_repo.rs:183`, `bereitstellungsraum/repo.rs:149`, …) liefern bei
`rows_affected() == 0` einen 404 — dort adressiert der Pfad eine gelistete Entität, deren Fehlen ein
Irrtum ist. Hier nicht: das Sachgebiet ist eine der **sechs festen** Zeilen, der Pfad existiert immer,
und *dieselbe* Adresse trägt einen PUT-**Upsert**, der ohne Zeile gerade keinen 404 liefert. Nach
Entscheidung 3 ist „keine Zeile" zudem der dokumentierte **Normalzustand** von S1/S4/S5/S6 im Fükw der
Stufe B — ein 404 auf „nicht vergeben" wäre ein Fehler für den Zustand, der bereits gilt. Deshalb: keine
Zeile → **204**, und zwar **ohne** System-ETB-Eintrag und **ohne** `LiveEvent::Stab` (ein Eintrag
„Besetzung → nicht vergeben (vorher: nicht vergeben)" wäre ETB-Rauschen und widerspräche Entscheidung 7).
Unverändert bleiben: fremde Org/fremder Einsatz → 404 aus dem Extractor, unbekanntes `sachgebiet` im
Pfad → 400 (Feld isoliert), Beobachter → 403, abgeschlossener Einsatz → Code von `fordere_aktiv`.

**9.3 Live:** `LiveEvent::Stab`, Wire `"stab"`, `ALLE` 26 → 27 (Länge **und** `contains` im Wire-Kontrakt),
`modul_keys → &["stab"]` (nur das Modul des Datenobjekts, Füll-Regel `src/live/mod.rs:121`). FE:
`EINSATZ_KEYS.stab = 'einsatz-stab'`, `EINSATZ_STREAM_EVENTS.stab = [EINSATZ_KEYS.stab]`; Byte-Pin als
Literal; die Lagebesprechungs-Historie hängt als Sub-Key `[stab, einsatzId, 'lagebesprechungen']` unter
demselben Prefix — **kein** eigener Singular-Key (Silent-Gap-Falle, `queryKeys.ts:61-68`). `einsatz` bleibt
`NICHT_LIVE`; `meine_sachgebiete` wird beim nächsten Einsatz-Abruf frisch.

**9.4 `meine_sachgebiete` — ZWEI Pfade, zwei Abfrageformen** (`src/einsatz/repo.rs`). `EinsatzAnzeige`
wird an genau zwei Stellen gebaut, und sie holen ihre Benutzer-Annotation schon heute verschieden — wer
nur eine bedient, bricht den Build (das Feld ist `Vec<Sachgebiet>`, kein `Option`, kein Default):

**(a) Detail-Pfad — `Einsatz::anzeige` (`src/einsatz/mod.rs:205-233`).** Die Signatur wächst auf **drei**
Argumente: `anzeige(&self, meine_rolle, meine_fuehrungsstelle, meine_sachgebiete: Vec<Sachgebiet>)`. Neben
`fuehrungsstelle_von` (`repo.rs:136`) tritt `sachgebiete_von(pool, einsatz_id, benutzer_id)`:
`SELECT s.sachgebiet FROM einsatz_stabsfunktion s JOIN einsatz_personal ep ON s.personal_id = ep.id
JOIN personal p ON ep.personal_id = p.id WHERE s.einsatz_id = ? AND p.benutzer_id = ? ORDER BY s.sachgebiet`.
Nachzuziehen sind **alle sieben** Aufrufstellen: `src/routes/einsatz.rs:87` (`anlegen` — der frische
Einsatz hat keine Besetzung, `Vec::new()` als Literal), `:110`, `:129`, `:177`, `:196`, `:775` (je
zusätzlich `sachgebiete_von` neben dem bestehenden `fuehrungsstelle_von`) sowie
`src/lage_snapshot/repo.rs:242` (`anzeige(None, None, Vec::new())` — der Snapshot hat keinen abfragenden
Benutzer, dieselbe Begründung wie für `None` bei Rolle und Führungsstelle dort).

**(b) Listen-Pfad — `einsatz::repo::liste_fuer` (`repo.rs:154-246`).** Hier ist `Einsatz::anzeige`
**nicht** beteiligt: die Funktion baut `EinsatzAnzeige` als Struct-Literal (`repo.rs:220`) und zieht
`meine_fuehrungsstelle` als `m.fuehrungsstelle` aus dem bestehenden `LEFT JOIN einsatz_mitgliedschaft`
(`repo.rs:194-199`). **Die Abfrage aus (a) je Zeile zu rufen ist verboten** — das wäre N+1 auf
`GET /api/einsaetze`, der Route hinter der Einsatzauswahl; `liste_fuer` liest bewusst alles in EINER
Abfrage und filtert danach in Rust (`darf_lesen`). Stattdessen eine **zweite, ebenfalls einmalige**
Abfrage über alle Einsätze des Benutzers (`SELECT s.einsatz_id, s.sachgebiet … WHERE p.benutzer_id = ?
ORDER BY s.einsatz_id, s.sachgebiet`) → `HashMap<i64, Vec<Sachgebiet>>`, im Literal per
`.remove(&r.id).unwrap_or_default()`. Bewusst **kein** `GROUP_CONCAT` im bestehenden Join: das erzwänge
ein `GROUP BY` über alle selektierten Spalten, und ein clientseitig gesplitteter String umginge den
Enum-Wire-Kontrakt. Zwei Abfragen bleiben O(1) in der Zahl der Einsätze — das ist die Zusicherung.

**Leer ist `[]`, in BEIDEN Pfaden — nie `absent`, nie `null`.** Das Feld trägt `#[schema(required)]` und
kein `skip_serializing_if`; der generierte TS-Typ ist `Sachgebiet[]`. Ein Pfad, der auslässt, während der
andere `[]` schickt, wäre nach der Optionalitäts-Norm ab LFH-265 eine Wire-Lüge in die andere Richtung.
Ad-hoc-Personal (`personal_id IS NULL`) hat kein Konto und fällt aus beiden Abfragen korrekt heraus.
**Test in 9.5 als Paar:** einmal gegen `GET /api/einsaetze/{id}`, einmal gegen `GET /api/einsaetze` mit
zwei Einsätzen, in denen derselbe Benutzer verschiedene Sachgebiete trägt — nur die Listen-Hälfte fängt
den stillen `Vec::new()`-Platzhalter im Struct-Literal; dazu ein Zähl-Test, dass `liste_fuer` bei n
Einsätzen konstant **zwei** Statements absetzt.

**9.5 Tests `tests/stab.rs`** (`common::setup_mit_pool_und_live`; `fremde_org_anlegen` ist Pflicht):
Cross-Org 404 auf jeder Route; Beobachter 403; abgeschlossener Einsatz; Modul-Override `sichtbar=false`
→ Gate greift und kein SSE-Event; 400/422-Paare je Zeile aus 9.2; Upsert setzt Vorherstand in den
ETB-Text; DELETE auf eine unbesetzte Zeile ist **204 und ein No-op** — als Paar mit dem belegten Fall:
auf besetzter Zeile 204 + ETB-Eintrag + SSE-Ereignis, auf leerer Zeile 204 + **kein** ETB-Eintrag +
**kein** SSE-Ereignis (gezählt, nicht bloss „kein 404"); zweimaliges DELETE hintereinander liefert
zweimal 204 und genau einen ETB-Eintrag; Personalunion (zwei Zeilen, eine Person); `snap_name` überlebt das Entfernen der Disposition
(`personal_noch_disponiert=false`); **Abschluss schreibt ETB-Eintrag, Zeile und Termin atomar — und die
Rollback-Probe hängt ausdrücklich NICHT an einem ungültigen `naechste_at`.** Der Weg wäre gemessen keiner:
9.2 lehnt den Wert im Handler ab (nicht parsebar → 400, `naechste_at` ≤ `abgehalten_at` → 422), und der
Bestand normalisiert jede Zeitangabe vor dem Schreiben — `crate::etb::normalisiere_zeit` steht
ausschließlich in `src/routes/*.rs`, nie in einem Repo. Der Request erreicht die Transaktion also nie; der
Test bliebe auch dann grün, wenn ETB-Eintrag, Zeile und Termin-Update drei getrennte Aufrufe wären. Ein
DB-seitiger Auffangpunkt existiert ebenfalls nicht (kein CHECK an `naechste_at`, keiner an
`einsatz.naechste_lagebesprechung_at`). Die Probe hängt deshalb an einem Fehler **nach** dem ETB-Insert:
der Termin-Schritt läuft als `UPDATE einsatz SET naechste_lagebesprechung_at = ? WHERE id = ? AND
status = 'aktiv'` und rollt bei `rows_affected == 0` ausdrücklich zurück — Muster
`src/lagebericht/repo.rs:256-262`. Der Test ruft die Repo-Funktion **direkt** gegen einen zwischenzeitlich
abgeschlossenen Einsatz, weil `fordere_aktiv` den Zweig auf der Route verdeckt, und prüft **drei** Dinge:
kein `etb_eintrag` mit `typ='entscheidung'`, keine `einsatz_lagebesprechung`-Zeile,
`einsatz.naechste_lagebesprechung_at` unverändert. **Mutationsprobe im AK: die eine Transaktion durch drei
Einzelaufrufe ersetzt → dieser Test wird rot.** Der 400/422-Fall des `naechste_at` bleibt eine eigene
Zeile bei den Paaren aus 9.2 — er belegt „Validierung vor jedem Schreiben", nicht Atomarität. **Nicht
gangbar und deshalb benannt:** eine vorbelegte Zeile gegen `UNIQUE (einsatz_id, lfd_nr)` erzeugt keinen
Konflikt, weil `lfd_nr = COALESCE(MAX(lfd_nr)+1, 1)` in derselben Transaktion gelesen wird. Tri-State des
Termins (fehlt/null/Wert);
Snapshot-Determinismus; `lfd_nr` lückenlos bei parallelem POST; Schwärzung nullt `snap_name`/`bezeichnung`
nur im betroffenen Einsatz und lässt `entschluss` stehen; `meine_sachgebiete` über `personal.benutzer_id`;
`LiveEvent::Stab` im Replay-Ring. Guards: `einsatz_kontext_guard`, `json_extractor_guard`,
`path_extractor_guard`, `enum_wire_kontrakt`, `openapi_spec_aktuell`, Registry-Drift in `tests/einsatz.rs`
bleibt grün.

## 10. Frontend

**Route und Registry.** `/einsaetze/:id/stab`; Builder `stabPfad(einsatzId, { neu?: boolean })` in
`routing/deeplinks.ts` (`?neu=1` fokussiert den Abschluss, apply-then-clean wie ETB). `MODUL_ELEMENTE.stab
= <StabPage />` in `App.tsx`; Registry `status: 'fertig'`, Beschreibung „Führungsorganisation (S1–S6) und
Lagebesprechungen der Einsatzleitung" — **erst nach ST3** (Entscheidung 18).

**Seite `pages/StabPage.tsx`** (`EinsatzSeite`, Titel „Stab", `breite` schmal):

- **Kopf-Slot:** genau eine Primäraktion „Lagebesprechung abschließen" — sie *öffnet* ein Modal, gehört also
  in den Kopf (LFH-346/C11). Ohne Schreibrecht gesperrt mit `RechteHinweis`, nicht versteckt (C10/M16).
  `neueZeile` der Kommandopalette trägt denselben Riegel.
- **Sektion „Lagebesprechung":** `Descriptions` mit drei Zeilen — *Nächste* (`anzeige/ZeitAnzeige` (`dtgVoll`) +
  `StatusTag`: „in 23 min" neutral, „seit 5 min überfällig" `achtung`, „kein Termin" neutral; das Wort ist der
  zweite Kanal; reine exportierte Funktion `lagebesprechungZustand(termin, jetzt)` mit Test beidseits beider
  Sommerzeitgrenzen; Aktualisierung alle 30 s ohne Blinken und ohne Toast — EEMUA-Budget), *Letzte* (Nr., DTG,
  Entschluss gekürzt, Link `etbPfad(einsatzId, { eintrag })`), *Anzahl*. Darunter `Liste` der Historie
  (gelesen: „was ist passiert?"), je Eintrag Titel „Nr. 3 · 14:30", ≤ 3 Sekundärfelder, keine Aktion.
- **Sektion „Besetzung S1–S6":** `components/Liste.tsx` mit **sechs festen Zeilen** in Anlage-2-Reihenfolge
  (Konstante `stab/sachgebiete.ts`: Kürzel, Label nach FwDV 100, Kurztext mit Seitenangabe, Werkzeug-Deeplinks,
  Lücken-Definition). Je `ListenEintrag`: Titel „S2 · Lage"; Status-Slot = Besetzung als `StatusTag`
  (neutral: „Müller", „Leitstelle (rückwärtig)", „Einsatzleitung", „nicht vergeben"; bei
  `personal_noch_disponiert=false` Zusatzwort „nicht mehr disponiert"); Sekundärfelder (≤ 3): Kurztext,
  Lücken-Kennzahlen als Text „2 Einheiten ohne Führer" mit Deeplink, Werkzeugzeile (Modul-Labels aus
  `modulRegistry`, **nur** freigegebene Module per `istModulFreigegeben`); genau eine Aktion „Besetzung
  ändern" (`Button`, erbt `controlHeight`). Die Zeile selbst ist kein Klickziel (kein nacktes `<div onClick>`).
  Kennzahl- und Werkzeug-Deeplinks sind handgebaute Bedienziele und tragen `zeilenzielStil` (Bedienkontexte
  unten); dasselbe gilt für den ETB-Link der Zeile *Letzte* im Kopfblock.
- **Datenzustände:** Fehler ≠ leer je Sektion (`SeitenFehler`/`SeitenLeer`); eine Lücken-Kennzahl, deren
  Quellmodul der Benutzer nicht lesen darf, zeigt „—" mit Grund statt 0 (Rechte-Weiche, Entscheidung 15).
- **Live:** `stab`-Event invalidiert `einsatz-stab`; die sechs Zeilen sind fest, die Historie wächst unten —
  kein Sprung unter dem Cursor, kein Sammelbanner nötig.

**Masken (`ErfassungsModal`, Erfassungs-Norm B4):**
- *Besetzung ändern* — 2 Felder: Art (`Select`) und je nach Art Person (`Select` aus `einsatzKeys.personal`,
  Suchfeld; letzter Eintrag „Ad-hoc-Person anlegen …" öffnet die **bestehende** Personal-Schnellerfassung)
  oder Bezeichnung (`Input` ≤ 200). Da das erste Feld ein `Select` ist, wird die Struktur geprüft (kein
  `.ant-modal-footer`, Knopf im `<form>`), nicht „Enter sendet". Entfernen („nicht vergeben") ist eine
  Option der Art, kein eigener Knopf, und sie steht auf **allen sechs** Zeilen zur Wahl — auch auf den im
  Fükw regelmäßig leeren (Entscheidung 3); der Backend-DELETE ist dafür idempotent (9.2). Die Maske ist
  mit dem **aktuellen** Zustand vorbelegt und schickt bei **unverändertem** Wert gar keinen Request
  (Wertgleichheits-Riegel, dieselbe Regel wie an `BemerkungZelle`) — geprüft als Paar: „leere Zeile
  öffnen, ‚nicht vergeben' bestätigen → 0 Requests, kein Fehler, Modal schliesst" und „leere Zeile
  öffnen, Person wählen → genau ein PUT". Umkehrbar (erneut setzen) → keine Rückfrage. Kein Serienmodus.
- *Lagebesprechung abschließen* — 2 sichtbare Felder: Entschluss (`Input.TextArea`, Pflicht) und Nächste
  Lagebesprechung (`DatePicker showTime` + Schnellwahl-Knöpfe +30/+60/+120 min sowie „kein Termin"; die
  Schnellwahl-Logik wird aus `etb/WiedervorlageModal.tsx` in eine geteilte reine Funktion gehoben, nicht
  kopiert — die Zahlen sind `[abgeleitet]`, keine Vorschrift nennt einen Rhythmus); unter „Weitere Angaben"
  (`Collapse`, im Test mit `forceRender`): Zeitpunkt der Besprechung (Default jetzt). Budget ≤ 3 gehalten.
  Fehler des POST stehen **im** Modal (LFH-535, `FreigabeDialog`-Bauform), Erfolg als Toast mit Deeplink auf
  den ETB-Beleg. `onErfassen` mit `mutateAsync`.

**Vorschläge (Entscheidung 14):** Hook `useStabsfunktionen(einsatzId)` liefert Labels „S2 – Lage (Müller)";
Optionen in `etb/funkrufnamen.ts` (`useFunkrufnamen`, an/von), `erinnerung/ErinnerungFormular` (Empfänger `AutoComplete`),
`auftraege/AuftragFormular` (tags-Option ohne Präfix → `funktion_text`). Kein Datenmodell-Eingriff in den
drei Modulen; Test je Aufrufer: Vorschlag erscheint, Freitext bleibt möglich. ETB-Vorbelegung in
`etb/Schnellerfassung.tsx:86`: `meine_fuehrungsstelle` zuerst, sonst erstes Element aus
`meine_sachgebiete` als Kürzel — Paar-Test „mit Führungsstelle gewinnt sie / ohne greift die Besetzung /
ohne beides leer".

**Kommandopalette:** ein `SCHNELLAKTIONEN`-Eintrag „Lagebesprechung abschließen" → `stabPfad(id, { neu: true })`;
`schnellaktionen.guard.test.ts` prüft die Deckung gegen die Seite, die `?neu=1` liest.

**Bedienkontexte (LFH-327):** Fükw 1366 × 768 mit offenem Panel (≈ 1022 px Content, Abschnitt 3): Kopfblock
plus sechs Zeilen ohne Querlauf — in Playwright gemessen. Führungs-Tablet: Dichte `komfortabel`. Die Zeile
selbst ist kein Klickziel, und „Besetzung ändern" ist ein `Button` — der erbt `controlHeight` vom
`ConfigProvider`. **Handgebaute Bedienziele gibt es trotzdem, und zwar drei Sorten:** der ETB-Link in der
Zeile *Letzte*, der Deeplink an jeder Lücken-Kennzahl und die Modul-Deeplinks der Werkzeugzeile. Ein `<a>`
erbt **keine** Steuerhöhe — LFH-396 hat 17 px in JEDER Dichtestufe gemessen, und die Prüfliste von LFH-336
hatte genau diese Stelle als Annahme („Link erbt vom `ConfigProvider`") statt als Messung geführt; diese
Annahme wird hier nicht wiederholt. Die drei Sorten tragen deshalb die ZWEI Angaben aus LFH-365
(`minHeight: token.controlHeight` **plus** `padding` aus `token.paddingSM`/`token.padding`, aufgelöste
Tokens über `theme.useToken()`, nie `var(--lfh-*)`) aus **einer** reinen, exportierten Stilfunktion
`zeilenzielStil(token)` in `stab/zeilenziel.ts`, Schablone `bedienzielStil`
(`pages/lagekarte/Sidebar.tsx`); `display: inline-flex`, weil die Links innerhalb einer Textzeile stehen.
Rein und exportiert aus demselben Grund wie dort: `test/utils.tsx` montiert ein nacktes `ConfigProvider`
ohne unser Theme und jsdom rechnet kein Layout, prüfbar ist also der **Inline-Style** über zwei
Dichtestufen mit den Böden als **Literale** (30 / 48 / 72) — aus dem Token zurückgelesen prüfte der Test
den Token gegen sich selbst. Mobil 390 px: Liste stapelt, `Descriptions column=1`. Nachtmodus: keine
eigenen Farben, alles über `StatusTag`/Tokens. Kein `size="small"` auf Interaktivem, kein Emoji, kein
Popover.

## 11. Berechtigungen, Isolation, Lebenszyklus

- **Lesen:** alle Einsatzmitglieder inkl. Beobachter (`EinsatzLesezugriff<Stab>`). **Schreiben:**
  Einsatzleitung, Führungspersonal, System-Admin (`EinsatzSchreibzugriff<Stab>`, `darfImEinsatzSchreiben`).
- **Modul-Gate deckt den eigenen Pfad, nicht die Nachbarn** — in beide Richtungen benannt: (a) wer Stab lesen
  darf, aber z. B. `nachforderungen` nicht, sieht in der S4-Zeile „—" mit Grund; (b) Werkzeug-Deeplinks laufen
  durch `istModulFreigegeben`, sonst zeigte die Seite Wege in gesperrte oder unfertige Module.
- **Schreiben in fremde Module aus dem Stab:** der ETB-Eintrag trägt seinen Inhalt vollständig selbst (kein
  Rücksprung nötig, kein FK am ETB); wird das Stab-Modul per Override ausgeblendet, bleibt der Eintrag ein
  gewöhnlicher Entscheidungs-Eintrag. Für die Erinnerungs-Kopplung (ST8) fällt `BezugLink` bei unbekanntem
  Ziel auf ein linkloses Tag zurück (`erinnerung/ErinnerungKarte.tsx:27-31`) — der Fall ist zu testen.
- **Org-Isolation:** über den Extractor (`fordere_org_zugehoerigkeit`); `personal_id` wird gegen
  `einsatz_personal.einsatz_id` geprüft, nie nur gegen die Org.
- **Abgeschlossener Einsatz:** Seite read-only, Kopf-Slot gesperrt mit Hinweis; `fordere_aktiv` serverseitig.
- **Schwärzung/Purge:** Abschnitt 8.

## 12. Umsetzung in Subtasks (Reihenfolge ist Abhängigkeit)

| # | Titel | Umfang | Abhängig von |
|---|---|---|---|
| **ST0** | Design-Spec (dieses Dokument) | — | — |
| **ST1** | Backend Besetzung S1–S6 | Migration 0102 (beide Tabellen), Enums + Wire-Kontrakt, `modul_marker Stab` + `PFAD_KEY`, Schwärzungs-Registry, `src/stab`, `routes/stab.rs` GET stab + PUT/DELETE besetzung, System-ETB Tier A, `LiveEvent::Stab` (ALLE 27, `as_str`, `modul_keys`), `meine_sachgebiete` in **beiden** Pfaden (`Einsatz::anzeige` mit drittem Argument samt sieben Aufrufstellen · `liste_fuer` mit zweiter Sammelabfrage, kein N+1 — Abschnitt 9.4), `api_doc` + Codegen, `tests/stab.rs` (Teil Besetzung) | ST0 |
| **ST2** | Backend Lagebesprechung | POST/GET lagebesprechungen, `lfd_nr` unter `write_retry!`, ETB `entscheidung` in derselben Tx, Tri-State-Termin, `StabAnzeige` um letzte/anzahl/termin, Rollback-Probe am `rows_affected == 0`-Zweig des Termin-Updates (repo-nah, nicht über die Route; ein ungültiges `naechste_at` taugt dafür nicht — 9.5) **samt Mutationsprobe im AK: Tx durch drei Einzelaufrufe ersetzt ⇒ Test rot**, Determinismus-Test | ST1 |
| **ST3** | WIP-Stellvertreter umziehen | `App.test.tsx`, `ModulStub.test.tsx`, `modulRegistry.test.ts:141` auf einen Registry-Stub (Muster `befehle.modulstatus.test.ts:31-38`); verhaltensneutral, Registry bleibt `wip`, Suite grün **vor** dem Flip | — |
| **ST4** | Frontend Grundseite + Freischaltung | `api/stab.ts`, Query-Keys (+ Byte-Pin), `stabPfad`, `stab/sachgebiete.ts`, `StabPage` mit Besetzungsliste, `BesetzungModal`, `MODUL_ELEMENTE.stab`, Registry `wip → fertig` + Beschreibung; Vitest: Strukturtest der Maske, Rechte-Paar (Knopf gesperrt + Hinweis), sechs Zeilen auch ohne Daten, `istModulFreigegeben`-Filter der Deeplinks | ST1, ST3 |
| **ST5** | Frontend Lagebesprechung abschließen | `LagebesprechungModal` (2 + 1), geteilte Schnellwahl-Funktion mit `WiedervorlageModal`, `lagebesprechungZustand` (DST-Tests), Fehler im Modal, Erfolgs-Toast mit ETB-Deeplink, Historie, Kommandopaletten-Schnellaktion mit `?neu=1` | ST2, ST4 |
| **ST6** | Lücken-Kennzahlen | reine Funktionen `stab/luecken.ts` (Filter über geladene Listen, unit-getestet inkl. Leer-/Fehler-/Rechtefall), Einbindung in die sechs Zeilen mit Deeplinks | ST4 |
| **ST7** | Vorschläge und ETB-Vorbelegung | `useStabsfunktionen`, Optionen in ETB an/von, Erinnerung, Auftrag; Vorrangregel in `Schnellerfassung.tsx`; `extra`-Text im Führungsstellen-Modal; Paar-Tests | ST4 |
| **ST8** *(abwählbar)* | Termin ↔ Erinnerung | Nur nach eigener Entscheidung (Abschnitt 13, Punkt 3). Vorarbeit ist Teil des Subtasks: `anlegen_aus_frist` nimmt `&SqlitePool` und fährt `ON CONFLICT DO NOTHING` (`src/erinnerung/repo.rs:227-244`) — es braucht eine `_tx`-Variante nach dem Muster `schliesse_offene_auto_tx` (`:319`) und ein `verschiebe_auto_frist`. Fälligkeit = Termin (kein Vorlauf); `bezug_typ='lagebesprechung'`, `bezug_id=einsatz_id`; idempotent über `idx_erinnerung_auto_bezug`; auch der PATCH des Einsatzkopfs zieht die Erinnerung nach (beide Schreibpfade, beide getestet) | ST2 |
| **ST9** | Prüfliste, e2e, Gate | `docs/superpowers/specs/<datum>-lfh-46-pruefliste.md` (Abschnitt 11.1), `e2e/stab.spec.ts` (Besetzung setzen → Vorschlag im ETB → Abschluss → ETB-Beleg typ `entscheidung` → Termin im Wiedervorlage-Modal), Breitenmessung 1366 px mit offenem Panel, Kontrast der StatusTags im Nachtmodus; **Gate-3-Nachweis: die Stab-Route kommt in `e2e/gate3-trefflaeche.spec.ts` — dieselben vorhandenen Helfer (`alleHaltenStufe` u. a.), keine Kopie. Gemessen werden ETB-Link, Kennzahl-Deeplinks, Werkzeug-Deeplinks und der Aktions-`Button` über 30 / 48 / 72 px, Böden als Literale, Mengen über `alleHaltenStufe` mit gesäter Mindestzahl; Mutationsprobe „Stufe festgenagelt → rot" gefahren und im Kopfkommentar vermerkt.** Vitest daneben: `zeilenzielStil` über zwei Dichtestufen (30/48/72 als Literale, Ungleichheit zwischen den Stufen). `./scripts/check-all.sh` grün | ST5, ST6, ST7 |

Ohne ST6 und ST7 ist das Modul „eine Liste, die niemand öffnet" — sie sind wertbestimmend, nicht optional.
ST8 ist die einzige abwählbare Zeile.

### 12.1 Prüfliste Einsatztauglichkeit — Flächenarten

Gate 7 verlangt je Flächenart eine 15-Zeilen-Tabelle mit Verdikt je Zeile; sie entsteht in ST9 als
eigene Datei. Vier Flächenarten und was dort überhaupt greifen kann:

| Fläche | Stellvertreter | Greift nicht (→ „nicht anwendbar" mit Begründung) |
|---|---|---|
| Besetzungsliste (sechs feste Zeilen) | `pages/StabPage.tsx` Sektion Besetzung | 14 (keine Tabelle), 15 (keine Erfassungsmaske), 8 (Regler ist Rahmen-Thema) |
| Kopfblock Lagebesprechung (`Descriptions` + Historie) | dieselbe Seite, Sektion Lagebesprechung | 14, 15; 10/11 nur bezogen auf den 30-s-Zustandswechsel (kein Ton, kein Blinken) |
| Modal „Besetzung ändern" | `stab/BesetzungModal.tsx` | 14; 15 nur teilweise (kein Serienmodus — Begründung: Einzelvorgang) |
| Modal „Lagebesprechung abschließen" | `stab/LagebesprechungModal.tsx` | 14; 4 (zweite Handlung) ist **anwendbar**: der Abschluss ist nicht umkehrbar (ETB-Snapshot) und trägt deshalb den Pflicht-Entschluss als bewusste Eingabe statt einer Rückfrage |

Die S5-Zeile hat keine eigene Datenquelle; sie wird als Teil der Besetzungsliste gegen Trefffläche,
Kontrast, Nachtmodus und Leerzustand geprüft — „nicht anwendbar" gilt dort nur für Zeilen, die eine
Zahl voraussetzen. Das Verdikt zu Kriterium 1/2 (Trefflächen) stützt sich auf die **Messung** in
`e2e/gate3-trefflaeche.spec.ts`, nicht auf die Annahme, ein Link erbe die Steuerhöhe.

## 13. Offene Punkte / Folge-Tickets (beim Spec-Abschluss angelegt)

1. **Funkplan (S6), abgeleitet:** tabellarische Sicht Abschnitt → Einheit → Fahrzeug mit Rufname, Führer,
   TMO/DMO-Sprechgruppen, Kommunikationsmittel, Erreichbarkeit (Anlage 5, S. 66) — vollständig aus
   `0047/0073/0086` ableitbar, ohne neue Tabelle; Druck und „In Lagebericht übernehmen" nach dem Muster der
   Kräfteübersicht. Träger ist eine `Datensicht`-Tabelle (→ `datensicht.guard.test.ts`, `KONSUMENTEN`), Ort
   noch offen (Sprechgruppen-/Kräfte-Kontext oder Unterroute des Stabs). Fachlich das stärkste
   S6-Artefakt; nicht v1, weil es eine eigene Fläche ist und die Contentbreite dafür vor dem Bau zu messen ist.
2. **Funktionskatalog und FK-Umbau:** geschlossene Werte für `erinnerung.empfaenger_funktion` und
   `auftrag_empfaenger.funktion_text`; Ablösung/Deprecation von
   `einsatz_mitgliedschaft.fuehrungsstelle` (LFH-461); dabei die `art`-Achse nach Anlage 1 Nr. 1.1.4/1.1.5
   (Führungshilfspersonal, Fachberater) entscheiden. **`etb_eintrag.von`/`an` gehören ausdrücklich NICHT
   in diesen Umbau**: sie bezeichnen Absender/Empfänger einer Meldung (Funkrufname, Einheit, Stelle),
   nicht ein Sachgebiet — ein Funktionskatalog-FK darauf verengte ein Feld, das den Funkverkehr abbildet.
   Ob das ETB zusätzlich einen optionalen Stabsbezug bekommt, ist eine eigene Frage, kein Nebenprodukt
   des Katalogs. Erst nach dem Feldbefund aus Entscheidung 17.
3. **Termin ↔ Erinnerung (ST8):** LFH-463 hat „keine Kopplung" bewusst gewählt; eine einmalige Fälligkeit
   zum Termin ist kein Rhythmus, aber eine eigene Entscheidung — Pro: der einzige Nudge im Fükw ohne offene
   Stab-Seite; Contra: Alarmbudget und Nebenwirkung eines Einsatzdaten-Feldes in einem anderen Modul.
4. **Lage-Dashboard und Stab von einer Verdichtung lesen lassen** (serverseitig, EINE Quelle) — betrifft die
   Datenschicht von LFH-352, nicht hier zu entscheiden; Vorbedingung für jede „Vorbereitung" der Besprechung.
5. **Checkliste Arbeitsaufnahme der Führungseinheit** (LFS-BW F5-I Kap. 5, S. 33–34; HLFS Kap. 5, S. 12
   `[Bild, nicht wörtlich belegbar]`) — sieben Punkte, ohne System-ETB je Haken.
6. **Kräfte-Zeitachse und Ablösung (S1)**, **Versorgung Langzeitlage (S4)**, **Presse-Log (S5, Stabsraum)** —
   je eigene Spec, nicht vor dem Feldbefund.
7. **Kachel-Primitive** (`Kachel`, `Plakette`, `Zeichen`, `zustandVon`) aus `LageDashboardPage.tsx` nach
   `components/` heben — nur, falls eine Stab-Fläche je Kacheln braucht; heute nicht.
8. **`LiveEvent::Einsatz` / Einsatzkopf live** — eigenes Ticket; v1 lebt mit dem dokumentierten Nachlauf
   auf der Einsatzdaten-Seite.
9. **Mandanten-Labels** (THW „Fernmeldeeinsatz" u. a.) und **S7 PSNV** — Labelmap ist eine Konstante, die
   Konfigurierbarkeit ist später eine Zeile.

## 14. Risiken

- **Formular ohne Nutzer.** Im Fükw ist die Besprechung oft eine Drei-Minuten-Absprache; ein Objekt kann
  wie Stabsraum-Ballast wirken. Gegenmaßnahmen: zwei Felder, vorbelegter Termin, ein Klick aus der
  Kommandopalette — und Entscheidung 17.
- **Zwei Wahrheiten für „Einsatzleitung"** sind bewusst vermieden: das Modul kennt keine Zeile „EL"; die
  Einsatzleitung bleibt die Mitgliedschaftsrolle. `besetzung_art='einsatzleitung'` sagt „Aufgabe bei der
  EL", nicht „wer die EL ist".
- **Zwei Caches für den Termin** (`einsatz` nicht live, `stab` live): dokumentierter Nachlauf, kein Fehler.
- **Kein WIP-Stellvertreter nach dem Flip:** ST3 muss vor ST4 grün sein.
- **Dritter Erzeuger von ETB-Einträgen aus einer Transaktion** neben Lagebericht und Befehl: die
  `etb_startwert`-Übergabe und die Reihenfolge Commit → SSE sind nach deren Muster zu bauen.
- **Contentbreite:** alle Breitenaussagen gelten für 1366 px mit offenem Panel; ein anderer Regelfall
  (Panel zu, Tablet 1024 px) ist in ST9 mitzumessen, nicht anzunehmen.

## 15. Quellen

- **FwDV 100** „Führung und Leitung im Einsatz – Führungssystem", Stand 1999, HLFS-Fassung: Abschn. 3.2.2.2
  (S. 14–16), 3.2.4.3 (S. 24–25), 3.2.5 (S. 26), 3.3 (S. 27–28), 3.3.2.2 (S. 36), 3.3.3.1 (S. 37), 3.3.3.2
  (S. 42), 3.3.3.3 (S. 41), 3.4.3 (S. 49); Anlage 1 Nr. 1.1.4/1.1.5 (S. 51); Anlage 2 (S. 54–60); Anlage 3
  (S. 61); Anlage 5 (S. 64–66). <https://hlfs.hessen.de/sites/hlfs.hessen.de/files/2022-09/FwDV%20100%20-%20Homepage.pdf>
- **DV 100 Sachsen-Anhalt** (2011) und **DRK-DV 100** (Westfalen-Lippe, 2001): in den zitierten Abschnitten
  wortgleich mit der FwDV 100 (Volltextvergleich).
- **RLP Führungsrichtlinie (FüRi)**, Abschn. II, III.1–III.3.1 (S. 11–12), IV.2.1 (S. 19), IV.2.2 (S. 20),
  IV.3.1 (S. 20). <https://www.hik-rlp.de/fileadmin/Download/Fuehrungskraefte/FueRi.pdf>
- **LFS Baden-Württemberg, Lernunterlage F5-I**, Abschn. 3.1.1 (S. 9–10), 3.2.1 (S. 11), 3.2.2 (S. 11–12),
  Kap. 5 (S. 33–34). <https://www.lfs-bw.de/fileadmin/LFS-BW/themen/lernunterlagen/dokumente/F5_I.pdf>
- **HLFS „Aufgaben Sachgebiet S3"**, Kap. 4 (S. 11), Kap. 5 (S. 12) `[sekundär]`; **HLFS Führungsorganisation**,
  Kap. 3 (S. 7–8).
- **DRK RLP „Führungsvorgang (Ablauf)"**, Folien 9–13 `[sekundär]`. **HCT Stabsschulung**, Lagebesprechung
  `[sekundär: kommerziell]`.
- **BBK-Glossar „Verwaltungsstab"** (IMK-Beschluss 08.07.2004); **LFS-BW VwS-Grundlagen** (05.02.2026),
  Abschn. 4.5 (S. 9). **BayZBE Übersicht Stabsfunktionen** (03.03.2020), S. 2.
- **DIN 14507-2/-3** nur sekundär (LFS-BW, Wikipedia „Einsatzleitwagen").
- **THW-Lernunterlage Basisausbildung II Zugtrupp** (Abschn. 2.1.2.4, S. 8–10; 3.2, S. 14–15)
  `[sekundär]` — Wortlaut der THW-DV 1-100 nicht beschaffbar; nicht tragend für eine Entscheidung.
- **Repo-Belege:** `migrations/0100`, `0101`, `0044:14`, `0048`, `0013`, `0010`; `src/einsatz/modul.rs`,
  `src/einsatz/kontext.rs`, `src/live/mod.rs`, `src/etb/mod.rs`, `src/lagebericht/repo.rs`,
  `src/erinnerung/repo.rs:227-244, 319`, `src/einsatz/schwaerzung_registry.rs:720-730, 1008-1028`;
  `frontend/src/einsatz/modulRegistry.ts`, `App.tsx`, `api/queryKeys.ts`, `etb/Schnellerfassung.tsx:86`,
  `etb/WiedervorlageModal.tsx`, `components/Liste.tsx`, `command-palette/befehle.ts`;
  `docs/superpowers/specs/2026-09-08-lfh-464-layoutmessung.csv`, `2026-08-21-lfh-342-pruefliste.md`,
  `docs/superpowers/plans/2026-07-30-gefahrenmatrix-bedienbare-bewertung.md:1052`.
