# Proposal

## Why

Auf die Frage „Wer führt?“ gibt die App heute zwei Antworten. Die Kopfleiste der Einsatzdaten nennt
unter „Einsatzleitung“ alle Konten mit der App-Rolle `einsatzleitung` (in der Demo „Administrator“).
Das Organigramm schreibt zur selben Zeit „Leitung nicht erfasst“. Die App-Rolle ist ein
Rechtebündel, das auch Führungsassistenten oder ein Admin tragen. Nach FwDV 100 gibt es genau einen
Einsatzleiter, der bei einer Übergabe wechselt, und er gehört in Organigramm, Funkplan, Lagebericht
und Einsatzbericht. Die Kopfleiste verletzt damit die Regel „Keine erfundenen Daten“
(`frontend/AGENTS.md`). Die Leitung wurde bisher bewusst nicht abgeleitet, weil es kein Datum
dafür gab (LFH-626 D5, LFH-849 Non-Goal). Diese Change schafft das Datum.

## What Changes

- **BREAKING (Anzeige):** Die Kopfleiste der Einsatzdaten leitet die Einsatzleitung nicht mehr aus
  der App-Rolle ab. Ohne erfassten Einsatzleiter steht dort gedämpft „nicht erfasst“.
- Die eigene Führungsstelle bekommt eine sechste Angabe **Einsatzleiter**. Sie ist entweder eine
  Person aus dem disponierten Personal des Einsatzes oder ein Freitext für einen externen
  Einsatzleiter, etwa den Kreisbrandmeister, und trägt immer ein „seit“ in taktischer Zeit (leer
  heißt jetzt). Gepflegt wird sie im Paneel „Eigene Führungsstelle“ auf Einsatzdaten, mit den
  Rechten der Kopfdaten und unabhängig von der Stab-Freigabe.
- Der Server friert den Namen einer Person ein, wie beim Stab. Wird die Person aus dem Einsatz
  entlassen, bleibt der Name stehen und trägt den Vermerk „nicht mehr disponiert“.
- Jeder Wechsel des Einsatzleiters (setzen, übergeben, leeren) schreibt in derselben Transaktion
  genau einen System-Eintrag ins ETB, mit Ereigniszeit = „seit“. Bleibt die Wahl gleich, entsteht
  kein Eintrag, auch wenn sich nur „seit“ ändert.
- Eine Darstellungsfunktion rechnet die Anzeige an einer Stelle. Sie speist:
  - die Kopfleiste der Einsatzdaten,
  - die Wurzel „Einsatzleitung“ des Organigramms,
  - die Spalte Leiter/Führer der Funkplan-Zeile „Führungsstelle“,
  - die Lagebericht-Übernahmen „Führungsorganisation“ und „Aus Meldebild und
    Führungsorganisation“,
  - den Block „Führung“ des Einsatzberichts.
- Der Einsatzbericht nennt unter „Einsatzleitung“ nur noch den Einsatzleiter. Die Liste der Konten
  mit der App-Rolle entfällt.
- Name und Freitext des Einsatzleiters sind personenbezogen und werden bei der Schwärzung geleert.
- Herleitungen fortgeschrieben: die Non-Goals aus LFH-626 D5 und LFH-849 sind aufgehoben.
- Anwenderdoku: `einsatzdaten.md`, `einsatzabschnitte.md`, `funkplan.md` und `einsatzabschluss.md`
  sind nachgezogen.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatz-fuehrungsstelle`: Die Führungsstelle bekommt die sechste Angabe Einsatzleiter (Person
  oder Freitext, dazu „seit“). Neu sind außerdem der Übergabe-Eintrag im ETB, die eine Anzeige in
  der Kopfleiste und die Schwärzung des Namens.
- `fuehrungsorganisation`: Die Wurzel „Einsatzleitung“ und die Lagebericht-Übernahme zeigen den
  erfassten Einsatzleiter statt fest „Leitung nicht erfasst“.
- `stab-funkplan`: Die Zeile „Führungsstelle“ zeigt in der Spalte Leiter/Führer den Einsatzleiter,
  statt die Spalte leer zu lassen.
- `einsatzbericht`: Der Block „Führung“ nennt als Einsatzleitung den erfassten Einsatzleiter, nicht
  die Konten mit der App-Rolle.

## Impact

- **Backend:**
  - Migration `0176` mit vier Spalten an `einsatz_fuehrungsstelle`.
  - Code: `src/einsatz/fuehrungsstelle.rs` und `src/routes/einsatz_fuehrungsstelle.rs` (PATCH-Feld
    `einsatzleiter`, Prüfung 400/422, ETB in der Transaktion, Live-Ereignis `etb`).
  - Schwärzung: Schwärzungs-Register, `PERSONENBEZUEGE`, `AUSNAHMEN_SYSTEM_ETB`.
  - Eingabegrenze `EINSATZLEITER_NAME_MAX` und Wire-Enum `EinsatzleiterArt`.
  - Typ-Codegen (`openapi.json`, `types.generated.ts`).
- **Frontend:**
  - `pages/EinsatzdatenPage.tsx` (Kopfleiste, Paneelzeile) und neu `stab/einsatzleiter.ts` (eine
    Darstellung).
  - `stab/fuehrungsstelle.ts` (Erfasst-Regel), `stab/funkplan.ts`.
  - `pages/einsatzabschnitte/fuehrungsorganisation.ts` und `Organigramm.tsx`.
  - `lageberichte/eigeneLageUebernahme.ts`.
  - `druck/einsatzbericht/` (neue Quelle Führungsstelle, `verdichtung.ts`).
  - `api/eingabegrenzen.ts`, `api/types.ts`.
- **Doku und Regeln:** Kapitel unter `docs/anwender/kapitel/` samt Bildern, `frontend/src/stab/AGENTS.md`
  und die Hinweise in den archivierten Designs von LFH-626 und LFH-849.
- Kein Einfluss auf die Funktions-Snapshots im ETB (`EL` aus der Einsatzrolle), auf die
  Stab-Besetzungsart `einsatzleitung`, auf die Fernmeldeskizze (keine Personennamen) und auf die
  Rechte der App-Rolle.
