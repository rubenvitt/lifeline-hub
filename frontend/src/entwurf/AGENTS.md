# Entwürfe — Regeln

Gilt für `frontend/src/entwurf/`, `frontend/src/lageberichte/`, `pages/BefehlDetailPage.tsx`
und `pages/LageberichtDetailPage.tsx`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

- **Verlustschutz ist ein Hook:** `entwurf/useEntwurfVerlustschutz.ts` (Riegel gegen
  Fremd-Refetch, Autosave 30 s + Blur, `beforeunload`); `pages/BefehlDetailPage.tsx` und
  `LageberichtDetailPage` rendern mit `key={<id>}`. Merker ist
  eigener State, **nicht** `form.isFieldsTouched()`. Riegel als Paar testen. Autosave ohne
  Erfolgs-Toast, sondern „zuletzt gespeichert HH:MM".
- Interne Navigation: `entwurf/EntwurfNavigationSchutz.tsx`, Hülle um die Rückfrage der
  Formularseiten (`components/VerlassenRueckfrage.tsx`, LFH-979) mit „Speichern und weiter“.
- **Ein Klick auf „Entwurf speichern" ist EIN PATCH:** einzige Pforte `speichereJetzt`,
  `gesichertRef` (Start `-1`), `speichertGerade` speist den Blocker, **nicht** `loading` am Knopf.
- Einstiegsfokus im ersten LEEREN Abschnitt (`entwurf/Einstiegsfokus.tsx`).
- **Anlagen** (LFH-1028): `entwurf/DokumentAnlagen.tsx` an Lagebericht und Befehl, am Schirm ein
  Paneel, auf Papier je Anlage ein Blatt A4 quer (`entwurf/dokumentAnlagen.css`; das Bild bleibt
  inline, als Block schob Chromium es auf ein eigenes Blatt). Die Druckfassung hängt immer im DOM,
  damit das Bild zum Druck geladen ist. Anfügen und Entfernen nur im Entwurf mit Schreibrecht; ohne
  Anlage und ohne Anfügen steht nichts außer dem Grund eines gescheiterten Anfügens (Höhe der
  Entwurfsseite, `e2e/lagebericht-schmal.spec.ts`).
  Live über `anlagen` am Ereignis des Dokuments, eigene Keys außerhalb des Offline-Lagebilds.
- Lagebericht: Abschnitte als Akkordeon (`lageberichte/AbschnittsAkkordeon.tsx`, `memo`, alle
  Props identitätsstabil; Gate ist der Render-Zähler im Test, `rerender` mit neuem Element).
  Tippmessung `e2e/lagebericht-tippen.spec.ts` (Deckel nur mit `PW_LATENZ=1`).
  Liste zeigt Kettenköpfe (`lageberichte/ketten.ts`), Zyklen verlieren keinen Bericht.
- **Übernahme in Abschnitte des Lagevortrags** (LFH-870,
  `openspec/changes/archive/2026-10-04-lfh-870-eigene-lage-uebernahme/design.md`, Spec
  `lagevortrag-uebernahme`): ein Baustein `lageberichte/AbschnittUebernahme.tsx` (Knopf nur im
  Schreibzweig, Laden erst beim Klick, Rückfrage vor dem Ersetzen, `onGeaendert` an den
  Verlustschutz, Hinweis mit Grund statt fehlendem Knopf). Eine Quelle ist eine
  `UebernahmeQuelle` (`lageberichte/uebernahmeQuelle.ts`) und prüft ihre Modulfreigaben selbst;
  die Zuordnung Abschnitt → Quelle steht nur in `lageberichte/uebernahmen.ts`, je Vorlage, kein
  Vortragsschema als Datenmodell (LFH-46 §2.3). Texte kommen aus den Renderern der
  Einzelübernahmen, nie aus einer zweiten Verdichtung; was fehlt, steht als „—“ mit Grund, nie 0.
  Der Lagevortrag zur Entscheidung bleibt von Hand.
- **Weitere Quellen im Lagevortrag zur Information** (LFH-869,
  `openspec/changes/archive/2026-10-04-lfh-869-lagevortrag-weitere-abschnitte/design.md`, Spec
  `lagevortrag-uebernahme`):
  Gefahren-/Schadenlage, Lageentwicklung und Besondere (Führungs-)Probleme; Auftrag, Anträge und
  Zusammenfassung bleiben von Hand. Das Lagebild lädt beim Klick nur über `ladeLagebasis` aus
  `LAGEBILD_QUELLEN` (`pages/lage-dashboard/useLagebild.ts`, dieselben Keys und Module wie der
  Hook), Wortlaut aus Vorbereitung (`stab/vorbereitung.ts`) und Funkplan
  (`funkplanLueckenZeilen`). **Kein Freitext aus Auftrag, Meldung, ETB, Personen oder Schäden**
  (Dritte), nur Zahlen, Nummern, Arten und Zeiten als DTG. Die Lageentwicklung zählt ab dem
  ETB-Eintrag der letzten Lagebesprechung nach `lfd_nr`, ohne `system` und freigegebene
  Lagevorträge, und legt keinen Freitext in den Zwischenspeicher (er wird offline gesichert).
