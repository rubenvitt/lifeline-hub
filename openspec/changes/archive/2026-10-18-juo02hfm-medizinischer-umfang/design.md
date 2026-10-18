# Design

## Context

Was an einer Person heute medizinisch steht (`src/person/mod.rs`, `PersonAnzeige`):

- **Sichtung mit Verlauf:** append-only, mit „bestätigt von“ (`sichtung_repo.rs`).
- **Freitext `zustand`**
- **Verlaufsnotizen:** append-only, ohne ETB (`verlaufsnotiz_repo.rs`).
- **Verbleib:** Art, Ziel und Transportmittel als Freitext (`verbleib_repo.rs`).

Die Herleitung steht in E-2 (`docs/superpowers/specs/2026-05-27-erfassung-sichtung-medizinischer-verlauf-design.md`):

- Medizinisches ist append-only (Annahme 7).
- Es gibt keine Sanitätsrolle (E-1, Annahme 3).
- Es gibt keinen Krankenhaus-Stamm (Annahme 6).

Zur Aufbewahrung: Sichtung, Notiz und UHS-Belegung stehen in `BEHANDLUNGSBEZUG_TABELLEN`
(`src/einsatz/schwaerzung_registry.rs`), `zustand` in Kategorie „Behandlung“. Der Verbleib gehört
bewusst zum Personenstamm. Das Lagebild ohne Netz hält keine Freitexte der Betroffenen vor
(LFH-1095).

Fachlicher Bezug ist die Patientenanhängetasche (PAT, Papier im MANV). Sie führt:

- PAT-Nummer, Sichtung mit Zeit und Sichter
- Verletzungen im Körperschema, Verdachtsdiagnose
- Kurzbefund, wenige Vitalwerte
- Maßnahmen mit Uhrzeit
- Transportpriorität, Transportmittel, Zielklinik
- Kontamination

Das DIVI-Notfallprotokoll geht deutlich weiter.

## Goals / Non-Goals

**Goals:**
- eine begründete Grenze, was Lifeline Hub medizinisch führt
- Regeln für Aufbewahrung, offline, ETB und Schreibrecht
- ein klarer Schnitt der Folgearbeit

**Non-Goals:**
- Datenmodelle und Oberflächen selbst; die bauen die Folgetickets
- ein Krankenhaus-Stamm

## Decisions

1. **Umfang: PAT-Kern (Option A).** Die Führung braucht genau eine Antwort: Wer muss als Nächstes
   wohin, womit? Dafür reichen diese Angaben:

   | Angabe | Form |
   |---|---|
   | Verdachtsdiagnose | Freitext „Zustand / Verdacht“ |
   | Verletzungen | am Körperschema (LLH-1113, LLH-1120) |
   | Maßnahmen | fester Katalog mit Uhrzeit, append-only: Blutstillung/Tourniquet, Zugang, Infusion, Sauerstoff, Atemweg, Analgesie, Immobilisation, Wärmeerhalt, Dekontamination |
   | Transportpriorität | `sofort`, `dringlich`, `normal` |
   | Transportart | `liegend`, `sitzend`, `mit_notarzt` |
   | benötigte Fachrichtung | Katalog: Unfallchirurgie, Verbrennung, Kinder, Neurologie/Neurochirurgie, Innere, Geburtshilfe, Psychiatrie, sonstige |
   | Kontamination | ja/nein |
   | PAT-Nummer | Freitext kurz, zum Abgleich mit der Papierkarte |

   - Verworfen B (Kurzbefund und Vitalwerte): mehr Pflege und mehr Daten der besonderen
     Kategorie. Der Nutzen liegt beim Behandelnden, nicht bei der Führung.
   - Verworfen C (DIVI-Vollumfang): Er doppelt das RD-Protokoll (bzw. NIDA) und widerspricht der
     Datensparsamkeit (Art. 5 Abs. 1 lit. c DSGVO). Sobald die App aus Werten etwas ableitet,
     etwa eine SK aus Vitalwerten, droht die Einstufung als Medizinprodukt (MDR, Regel 11).
   - Grenze für alle Folgetickets: Die App leitet aus medizinischen Angaben **nichts** ab, keine
     Kategorie und keine Empfehlung. Sie zeigt, zählt und sortiert nur.
2. **„Zustand“ wird „Zustand / Verdacht“.** Es gibt kein zweites Feld „Verdachtsdiagnose“: zwei
   ähnliche Freitexte würden uneinheitlich befüllt. Wire-Name und Spalte bleiben `zustand`, die
   Oberfläche benennt um. Die Spec `betroffene-lagedaten` zieht
   `y18v58dt-patientenkopf-bezuege` nach.
3. **Katalog fest im Code** wie die Sichtung. Druck, Auswertung und Geräte sind einheitlich,
   Enum-Werte haben einen Wire-Kontrakt (`tests/enum_wire_kontrakt.rs`). Ein Katalog je
   Organisation in den Stammdaten wurde verworfen, weil die Auswertung über Einsätze hinweg
   uneinheitlich würde.
4. **Aufbewahrung: Kategorie „Behandlung“** für alles Neue: Maßnahmen, Verletzungen, Transport,
   Fachrichtung, Kontamination und PAT-Nummer. Jede neue Personentabelle steht in
   `BEHANDLUNGSBEZUG_TABELLEN` und `PERSONENBEZUEGE`. Ihre Scrub-Spalten (Freitexte, Koordinaten
   am Schema) sind in der Kategorie gepinnt (`kategorie_zuordnung_ist_gepinnt`). Die PAT-Nummer
   ist zwar suchbar, gehört aber zur Behandlung, weil sie eine Patientenkarte bezeichnet.
5. **Ohne Netz:** Im Lagebild stehen nur Enum-Werte, also Transportpriorität, Transportart und
   Kontamination ja/nein, keine Freitexte. Die Regel LFH-1095 gilt weiter. Offline-Schreiben
   folgt LLH-1138 (Welle 2).
6. **ETB:** Medizinische Details kommen nicht ins ETB. Die einzige Ausnahme ist die
   Transportpriorität, pseudonym als „R-012: Transportpriorität dringlich“, weil sie
   Führungsinformation für die Transportorganisation ist. Sie steht in der gepinnten
   Ausnahmeliste der Spec `aufbewahrung`, falls die Klassifikation sie als Scrub führt, sonst
   nicht.
7. **Wer schreibt:** wie heute alle mit Schreibrecht im Einsatz und das UHS-Gerät mit „Bestätigt
   von“ (LFH-1046). Eine Sanitätsrolle gibt es nicht (E-1, Annahme 3).
8. **Körperschema (zu LLH-1120): Figur je Geschlecht** (Entscheidung Ruben 18.10., abweichend von
   der Empfehlung „neutral“): männlich und weiblich, neutral bei `unbekannt`, `divers` oder ohne
   Angabe. Regionen und Koordinaten sind über alle Figuren gleich normiert, damit ein Wechsel des
   Geschlechts keine Markierung verschiebt.
9. **Kataloge für LLH-1113:**
   - Regionen aus Patientensicht: `kopf`, `gesicht`, `hals`, `thorax`, `abdomen`, `becken`,
     `ruecken`, `wirbelsaeule`, `gesaess`, je links/rechts `oberarm`, `unterarm`, `hand`,
     `oberschenkel`, `unterschenkel`, `fuss`.
   - Arten: `wunde_blutung`, `fraktur_verdacht`, `verbrennung`, `prellung_schwellung`,
     `amputation`, `schmerz`, `sonstige`.

## Risks / Trade-offs

- [Später wird doch ein Vitalwert gebraucht, etwa am BHP 50] → Er käme als eigene Change mit
  eigener Begründung. Die Grenze „nichts ableiten“ gilt dann weiter.
- [Freitext „Zustand / Verdacht“ bleibt unstrukturiert] → Das ist gewollt. Was strukturiert
  gebraucht wird, liefern Körperschema, Maßnahmen und Transport.

## Folgetickets

- Maßnahmen: Datenmodell append-only mit Katalog und Uhrzeit, API, Schwärzung, Gerät, Anzeige im
  Patientenkopf.
- Transport: Priorität, Art und Fachrichtung an der Person, mit Cache, Sortierung in UHS und
  Liste, ETB-Zeile zur Priorität und Enum-Werte im Lagebild.
- PAT-Nummer und Kontamination an der Person, mit Suche nach der PAT-Nummer.
