# Informationstelefon — Regeln

Gilt für `frontend/src/infotelefon/`, `pages/InfotelefonPage.tsx` und `src/infotelefon/` samt
`src/routes/infotelefon.rs`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Eigenes Modul** (i6k6mzed, `openspec/changes/i6k6mzed-stab-herausnehmen/design.md` D3): Key
`infotelefon` in der Kategorie Kommunikation, eigene Freigabe (`useModulFreigabe('infotelefon')`),
eigenes Live-Ereignis `infotelefon`, kein Modulzähler. Die API bleibt unter
`…/stab/infotelefon` (`PFAD_KEY` ordnet sie `infotelefon` zu), die Altadresse
`/einsaetze/:id/stab/infotelefon` leitet dauerhaft um und behält `?anruf=` und `?neu=1`
(`ALTPFAD_MODUL`). Das Anliegen `presse` („Presseanfrage“) bleibt ein Anliegen eines Bürgers
(`infotelefon/labels.ts`). Personenbezug (Anrufername, Rückruf, Notiz) wird geschwärzt,
`rueckruf` per `PlatzhalterWennGesetzt`. **Nicht offline**: die Keys fehlen in
`LAGEBILD_OFFLINE` (LFH-767).

**Fenster und Zählung** (LLH-732,
`openspec/changes/archive/2026-10-13-w6hgfndx-infotelefon-zaehler/design.md`): die Liste lädt
immer seitenweise (`ANRUFE_PAGE_SIZE`, Cursor Eingang + Kennung, „Ältere laden“), „offene Rückrufe“
filtert am Server; Kennzahlen, Meta und „Nach Anliegen“ lesen nur `…/infotelefon/zaehler`, nie
das geladene Fenster. Ein Deeplink außerhalb des Fensters holt den Anruf einzeln
(`…/infotelefon/{aid}`) und stellt ihn als ältesten oben dazu. Die Zufluss-Schleuse
(`infotelefon/zufluss.ts`) nimmt Seiten, die nach dem Einfrieren nachgeladen wurden, über
`extendEinfrierstand` auf, damit ein Nachtrag aus einer älteren Seite nicht als „neuer Anruf“ gilt.

**Funkprotokoll-Ordnung** (LLH-1149, Spec `stab-infotelefon`, Herleitung
`openspec/changes/archive/2026-10-17-gonnp1g8-etb-ux-durchgang/design.md` D10): dieselbe
Leserichtung wie das ETB (`etb/AGENTS.md`, „Funkprotokoll-Ordnung“) — ältester Anruf oben,
jüngster unten über der Erfassung, „Ältere laden“ über der Liste, das Sammelbanner unten; Öffnen
am Ende, Mitlaufen und Anker über `components/useFunkprotokollLauf.ts`, gekehrt wird erst in der
Darstellung (`funkprotokollFolge`). Hochgerollt friert die Schleuse ein wie bei Fokus in der Liste.

**Unter `md`** (LFH-1067): zuerst die Anrufe, nach dem Muster der ETB-Erfassung (`etb/AGENTS.md`).
Die Leiste startet eingeklappt (`AnrufErfassung einklappbar`: nur Anliegen und „Erfassen“,
solange der Fokus nicht in ihr liegt und das Formular leer ist), die Kennzahlen stehen als Meta
im Kopf, Segmentleiste und „Nach Anliegen“ (Knopf, klappt die Aufgliederung auf) als
Kopfaktionen, der Ortspfad erst ab `md` (`EinsatzSeite ortspfadAbMd`). Nachweis: zwei Anrufe ganz
über der Leiste auf 390 × 844 in jeder Dichte (`e2e/leisten-flaeche.spec.ts`).
