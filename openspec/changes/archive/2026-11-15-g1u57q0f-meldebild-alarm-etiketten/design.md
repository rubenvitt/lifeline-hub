# Design

## Context

- `kraefte/meldebildRaster.ts` `toenungsGruende(z, r)` liefert Strings („1 Ausfall“, „1 Ausfall
  Material“, „Rückm. überfällig“, „keine Rückm.“). `KraefteuebersichtPage.tsx` `StatusSpalte`
  gibt sie als ungefärbten Text 12 px aus (`data-lfh="meldebild-toenungsgrund"`).
- `meldungen/rueckmeldung.ts` `RUECKMELDUNG_ROLLE` setzt `ueberfaellig: 'achtung'`,
  `keine: 'alarm'`. Die Spalte „Rückmeldung“ färbt danach.
- Die Tönung `meldebild-problemzeile` liest `--lfh-problem-zeile` (`tokens.ts` Tag `#f8eded`, Nacht
  `#130f0f`, gespiegelt in `rollen.css`).
- Ausfall einer Einheit zählt nur ihre eigenen Mittel (Spec `kraeftebaum`, „Stärke im Kräftebaum“).
- Eine Dauer formatiert heute `dauerText` (`lagebesprechung/lagebesprechungZustand.ts`, „47 min“,
  „2 h 05 min“). Eine gemeinsame Dauer-Rolle plant erst LLH-1750 (Welle 4).

## Goals / Non-Goals

**Goals:** Kritisches als Etikett in der Alarmrolle; ein Formatierer für Meldebild und Überblick.

**Non-Goals:** FMS-Status-Farben (LLH-1778); die Kachel „keine Rückmeldung“ im Statusband bleibt;
kein neuer Baustein im Dashboard-Baukasten (das Etikett ist `StatusChip`).

## Decisions

1. **Strukturierte Gründe.** `toenungsGruende` liefert
   `ToenungsGrund = { art: 'ausfall' | 'ausfall_material' | 'rueckmeldung_ueberfaellig' |
   'rueckmeldung_keine'; anzahl?: number; seitMin?: number }`. Der Wortlaut kommt aus einer reinen
   Funktion `grundWort(grund)` in `kraefte/` (neben `meldebildRaster.ts`). Die Dauer kommt aus
   `jetzt − faellig_at` (`rueckmeldungUeberfaelligSeit(r, jetzt)` in `rueckmeldung.ts`, ganze
   Minuten, nie negativ) und wird mit `dauerText` geschrieben. Der Überblick (Change
   `kevp40j3-…`) nutzt dieselben beiden Funktionen.
   *Verworfen:* Strings behalten und den Ton aus dem Text ableiten. Zerbrechlich und nicht
   prüfbar.
2. **Darstellung:** jedes Wort als `StatusChip ton="alarm"`. Der Text ist der zugängliche Name
   (WCAG 1.4.1, LFH-973). Die Statusspalte bricht zwischen den Chips um, nicht im Wort.
3. **Rolle überfällig = alarm** in `RUECKMELDUNG_ROLLE` (Entscheidung am Phase-1-Checkpoint: ein
   Zustand, eine Rolle). Das schlägt überall durch, wo die Karte gelesen wird: Spalte
   „Rückmeldung“, Überblick (LLH-1739). Den Kommentarkopf von `rueckmeldung.ts` nachziehen.
   *Verworfen:* Alarm nur am Etikett, Spalte gelb. Dann hätte derselbe Zustand zwei Farben.
4. **Tönung nachts:** `problemZeile` nachts so anheben, dass die Fläche gegen `paneel` sichtbar
   abweicht (Ziel: wahrnehmbar wie `alarmFlaeche`, aber leiser). Text und Chips darauf halten die
   Böden aus `farbrollen-kontrast`. Messung über das bestehende Farbrollen-Gate. Tag bleibt.
   *Verworfen:* Tönung streichen. Sie ist der Zeilenkanal beim Überfliegen, die Etiketten der
   Lesekanal.

## Risks / Trade-offs

- [Alarmbudget: mehr Rot im Meldebild] → Rot steht nur an echten Gründen (Ausfall, Schweigen).
  Normalzustände werden mit LLH-1778 leiser. Die Bilanz bleibt im Sinne von EEMUA 191.
- [Breitere Statusspalte] → Chips brechen um. Mindestbreite 1180 px im Seitentest prüfen.
- [Druck] → `kraefteuebersichtPrint.css` prüfen: Chips drucken als Rand plus Wort (Graustufe).
