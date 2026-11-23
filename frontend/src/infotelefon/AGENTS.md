# Informationstelefon — Regeln

Gilt für `frontend/src/infotelefon/`, `pages/InfotelefonPage.tsx` und `src/infotelefon/` samt
`src/routes/infotelefon.rs`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Eigenes Modul** (i6k6mzed, `openspec/changes/archive/2026-11-09-i6k6mzed-stab-herausnehmen/design.md` D3): Key
`infotelefon` in der Kategorie Kommunikation, eigene Freigabe (`useModulFreigabe('infotelefon')`),
eigenes Live-Ereignis `infotelefon`, kein Modulzähler. Die API bleibt unter
`…/stab/infotelefon` (`PFAD_KEY` ordnet sie `infotelefon` zu), die Altadresse
`/einsaetze/:id/stab/infotelefon` leitet dauerhaft um und behält `?anruf=` und `?neu=1`
(`ALTPFAD_MODUL`). Das Anliegen `presse` („Presseanfrage“) bleibt ein Anliegen eines Bürgers
(`infotelefon/labels.ts`). Personenbezug (Anrufername, Rückruf, Notiz) wird geschwärzt,
`rueckruf` per `PlatzhalterWennGesetzt`. **Nicht offline**: die Keys fehlen in
`LAGEBILD_OFFLINE` (LFH-767).

**Fenster und Zählung** (LLH-732,
`openspec/changes/archive/2026-10-13-w6hgfndx-infotelefon-zaehler/design.md`; Fenster in beide
Richtungen LLH-1886, `docs/superpowers/specs/2026-11-22-se7ytm9j-chat-infotelefon-seitenfenster-design.md`):
die Liste lädt immer seitenweise (`ANRUFE_PAGE_SIZE`, Cursor Eingang + Kennung) und hält höchstens
fünf Seiten (`components/fensterBeideRichtungen.ts`): „Ältere laden“ oben (`vor_…`), „Neuere laden“
unten (`nach_…`, eine mehr angefragt), solange die neueste Seite fehlt. Eigenes Erfassen aus
tiefem Fenster holt erst den Kopf (`zumKopf`); wer die Ansicht ohne Kopf verlässt, verwirft das
Fenster (`useKopfBeimVerlassen`). „offene Rückrufe“
filtert am Server; Kennzahlen, Meta und „Nach Anliegen“ lesen nur `…/infotelefon/zaehler`, nie
das geladene Fenster. Ein Deeplink außerhalb des Fensters holt den Anruf einzeln
(`…/infotelefon/{aid}`) und stellt ihn als ältesten oben dazu. Die Zufluss-Schleuse
(`infotelefon/zufluss.ts`) nimmt die Seite, die „Ältere laden“ oder „Neuere laden“ nach dem
Einfrieren holt, mit den Kennungen auf, mit denen sie kam (`extendEinfrierstand`, `ladeWeiter`):
erkannt an der Referenz, nie an der Position, denn mit dem Deckel fällt am anderen Ende eine Seite
heraus. Ein Nachtrag aus einer selbst geholten Seite gilt so nicht als „neuer Anruf“, ein fremder
Nachtrag beim Live-Neuladen schon. Der eingefrorene Stand merkt sich dazu den gezeigten Bereich
(jüngster und ältester Anruf in der Ordnung des Servers, LLH-2066): was außerhalb davon nachrückt,
weil im Fenster einer herausfiel („offene Rückrufe“: erledigt), ist verschoben, nicht neu, und
steht sofort. Unter dem Bereich gilt das immer, darüber nur ohne Kopf im Fenster; „Ältere laden“
und „Neuere laden“ erweitern den Bereich.

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
