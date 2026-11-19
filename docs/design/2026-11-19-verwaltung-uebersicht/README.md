# Verwaltung: Übersicht (19.11.2026)

Entwurf zu LLH-1820, Teil A
(`docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`). Neue
Seite „Übersicht“ als erster Punkt der Verwaltung: Bestand der Bereitschaft, ein Satz „Für einen
Einsatz fehlt: …“, je Bestand Zahl, Zustand und Sprung.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/4JX3fpHxtzFamxwppdUUjr (Artifact-Typ „Design“, Design System „Lifeline
Hub“), Inline-Styles und `<helmet>`-Regeln maßgeblich. Die Schriften laden die Dateien aus
`ds/lifeline-hub/` des Canvas; im Repo liegen sie nicht, die Flächen fallen hier auf die
Systemschrift zurück.

| Datei            | Zeichenfläche                                                    | Dichte      |
| ---------------- | ---------------------------------------------------------------- | ----------- |
| `Main.dc.html`   | Pflicht fehlt, Admin, Desktop 1280                               | kompakt     |
| `Bereit.dc.html` | Bereit, Empfehlungen offen, Führungskraft, Demo eingespielt      | kompakt     |
| `Handy.dc.html`  | Nichts da außer Vorlagen, Handy 390 × 844, ganze Zeile als Sprung | komfortabel |

Festgelegt:

- Der Satz steht als Hinweis über dem Paneel: Ton `achtung` (gelb), solange Pflicht fehlt, sonst
  neutral mit grünem Zeichen. Rot kommt nicht vor („Rot bedient nichts“).
- Ein Paneel „Bereitschaft“ mit fünf Zeilen in fester Folge; Zahl in Mono rechtsbündig, darunter
  gedämpft „+ N aus der Demo“; Zustand als `Status` (fehlt · empfohlen · vorhanden); Sprung
  „<Bestand> ↗“ rechts.
- Eine Führungskraft sieht die Benutzerzeile ohne Sprung, mit gedämpftem „nur für System-Admins“.
- Am Handy ist die ganze Zeile der Sprung (Bedienziel ≥ 48 px), der Pfeil steht rechts.
- Unter dem Paneel ein Satz, was Pflicht und was Empfehlung ist.
