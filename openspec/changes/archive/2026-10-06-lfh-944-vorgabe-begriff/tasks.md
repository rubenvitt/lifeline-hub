# Tasks

## 1. Wortlaut und Wächter

- [x] 1.1 `components/vorgabeText.ts` mit `mitVorgabe`, `LEER_SYSTEM_VORGABE`, `orgVorgabe`, `KEINE_VORGABE` anlegen, Test zuerst (`vorgabeText.test.ts`)
- [x] 1.2 `components/vorgabe.guard.test.ts` anlegen; Bestand als Funde zeigen lassen (rot), Ausnahmen „Standard-Rufname“ und „Standardansicht“/„Als Standard“ mit Grund

## 2. Bestand nachziehen

- [x] 2.1 Anzeige-Konventionen: Beschreibung, Platzhalter `(Vorgabe)`, Zeitzone „Gerätezeit (Vorgabe)“, Tooltips ohne „IANA“/„Reverse-Geocoding“; Vitest der Platzhalter
- [x] 2.2 Einsatz-Vorgaben: Titel, Menüeintrag, Beschreibungen, Fristen, Rollen-Vorgabe, Rechtetext, Erfolgsmeldung; `ModulEinstellungsListe`-Spalte; Vitest
- [x] 2.3 Einsatz-Einstellungen: `orgHinweis*` auf `orgVorgabe`, Allgemein (Einstiegsmodul, Zeitzone, Platzhalter) und Verhalten (Fristen, Startwert, Auto-ETB); Vitest
- [x] 2.4 Anmeldeverfahren „Anmeldewege“; Online-Kartenquellen „Kartengrundlage“ statt „Basemap“; Meldungsfrist; Führungsfunktionen „(Vorgabe: …)“; Organisation „Taktische Zeichen“
- [x] 2.5 Guard grün; Mutationsprobe: ein Altwortlaut zurück macht Guard und Seitentest rot

- [x] 2.6 Review: Einsatz-Platzhalter nennen den wirksamen Wert (Org ?? System), Einstiegsmodul aus `redirectZiel`, Meldungsformular „Frist (Vorgabe)“, Modul-Override „Vorgabe der Organisation: …“, Servermeldung der Fristprüfung

## 3. Regel, e2e, Abschluss

- [x] 3.1 Regelzeile in `frontend/AGENTS.md` (Bedien-Leitlinie) mit Verweis auf Spec `bedien-begriffe`, `components/vorgabeText.ts` und den Guard
- [x] 3.2 e2e-Anker nachziehen (`gate1-ueberlauf`, `fokus-verdeckung`, `verwaltung-vereinheitlicht`); Einsatz-Vorgaben auf 390 auch nicht-privilegiert messen (bestehender Lauf)
- [x] 3.3 `./scripts/check-all.sh` und Vitest grün
