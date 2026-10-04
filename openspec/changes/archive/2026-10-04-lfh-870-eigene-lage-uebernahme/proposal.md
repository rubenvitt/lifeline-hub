# Proposal

## Why

Im *Lagevortrag zur Information* lässt sich bisher nur die „Medienlage“ aus vorhandenen Daten
füllen (LFH-554, „Aus S5 übernehmen“). Für „Eigene Lage“ gibt es die Texte längst
(Kräftemeldebild, Führungsorganisation), aber sie landen über „In Lagebericht übernehmen“ in je
einem neuen Freitext-Bericht. Wer einen Lagevortrag vorbereitet, schreibt die Zahlen deshalb ab
oder kopiert zwischen Dokumenten. LFH-870 ist der erste Schritt von LFH-869: der
Übernahme-Baustein wird allgemein, und „Eigene Lage“ bekommt ihn als erster weiterer Abschnitt.

## What Changes

- **Ein Übernahme-Baustein für Abschnitte des Lagevortrags:** Aus `MedienlageUebernahme` wird ein
  allgemeiner Baustein mit einer Zuordnung *Abschnitt → Quelle*. Er trägt, was heute nur die
  Medienlage kann: Knopf nur im Schreibzweig, Laden erst beim Klick, Rückfrage vor dem Ersetzen,
  Meldung an den Verlustschutz.
- **Rechteprüfung je Quelle**, und eine gesperrte Quelle erklärt sich: statt des Knopfes steht
  ein Hinweis mit Grund. Heute verschwindet „Aus S5 übernehmen“ ohne Stab-Freigabe kommentarlos.
- **Medienlage auf den Baustein:** Text, Rückfrage und Rechte bleiben gleich. Neu ist nur der
  Hinweis bei gesperrtem Stab.
- **„Eigene Lage“ übernehmen:** Knopf „Aus Meldebild und Führungsorganisation übernehmen“. Er
  setzt das Kräftemeldebild und die Führungsorganisation des ganzen Einsatzes ein, jeweils mit
  dem Renderer der heutigen „In Lagebericht übernehmen“-Fassung und mit Stand (DTG) im Text. Ein
  Teil ohne Freigabe oder ohne Daten steht als „—“ mit Grund im Text, nie als 0.
- Die Regel zum Baustein kommt in `frontend/src/entwurf/AGENTS.md`.

Keine Änderung an Server, Daten, Vorlagen oder Typen. Keine **BREAKING**-Änderung.

## Capabilities

### New Capabilities

- `lagevortrag-uebernahme`: Übernahme vorhandener Lagedaten in einzelne Abschnitte eines
  Lagevortrag-Entwurfs (Bedienregeln, Rechte je Quelle, Hinweis bei Sperre) und der Abschnitt
  „Eigene Lage“ als erste angebundene Quelle nach der Medienlage.

### Modified Capabilities

- `stab-medienlage`: „Medienlage aus S5 übernehmen“ zeigt bei gesperrtem Stab einen Hinweis statt
  nichts.

## Impact

- Neu: `frontend/src/lageberichte/AbschnittUebernahme.tsx` (Baustein),
  `lageberichte/uebernahmeQuelle.ts` (Schnittstelle, Listenabruf), `lageberichte/uebernahmen.ts`
  (Zuordnung) und `lageberichte/eigeneLageUebernahme.ts` (Quelle „Eigene Lage“), je mit Test.
- `frontend/src/stab/MedienlageUebernahme.tsx` rendert den Baustein mit der Quelldefinition aus
  `stab/medienlageUebernahme.ts`; ihr Test bleibt grün.
- `frontend/src/pages/LageberichtDetailPage.tsx`: Abschnitts-Editor fragt die Zuordnung statt
  `schluessel === 'medienlage'`.
- Renderer `rendereMeldebildMarkdown` und `rendereFuehrungsorganisationMarkdown` bleiben
  unverändert.
- `frontend/src/entwurf/AGENTS.md`.
- Nur Frontend. Kein Backend, keine Migration, kein Typ-Codegen.
