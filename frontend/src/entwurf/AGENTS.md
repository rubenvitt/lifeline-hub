# Entwürfe — Regeln

Gilt für `frontend/src/entwurf/`, `frontend/src/lageberichte/`, `pages/BefehlDetailPage.tsx`,
`pages/LageberichtDetailPage.tsx` und `pages/PressemitteilungDetailPage.tsx`, ergänzt
`frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

- **Verlustschutz ist ein Hook:** `entwurf/useEntwurfVerlustschutz.ts` (Riegel gegen
  Fremd-Refetch, Autosave 30 s + Blur, `beforeunload`); `pages/BefehlDetailPage.tsx` und
  `LageberichtDetailPage` rendern mit `key={<id>}`. Merker ist
  eigener State, **nicht** `form.isFieldsTouched()`. Riegel als Paar testen. Autosave ohne
  Erfolgs-Toast, sondern „zuletzt gespeichert HH:MM".
- Interne Navigation: `entwurf/EntwurfNavigationSchutz.tsx`, Hülle um die Rückfrage der
  Formularseiten (`components/VerlassenRueckfrage.tsx`, LFH-979) mit „Speichern und weiter“.
- **Ein Klick auf „Entwurf speichern" ist EIN PATCH:** einzige Pforte `speichereJetzt`,
  `gesichertRef` (Start `-1`), `speichertGerade` speist den Blocker, **nicht** `loading` am Knopf.
- Einstiegsfokus im ersten LEEREN Abschnitt des Serverstands (`entwurf/Einstiegsfokus.tsx`, im
  Baustein `DokumentEntwurf`, beim Einhängen eingefroren).
- **Anlagen** (LFH-1028): `entwurf/DokumentAnlagen.tsx` an Lagebericht und Befehl, am Schirm ein
  Paneel, auf Papier je Anlage ein Blatt A4 quer (`entwurf/dokumentAnlagen.css`; das Bild bleibt
  inline, als Block schob Chromium es auf ein eigenes Blatt). Die Druckfassung hängt immer im DOM,
  damit das Bild zum Druck geladen ist. Anfügen und Entfernen nur im Entwurf mit Schreibrecht; ohne
  Anlage und ohne Anfügen steht nichts außer dem Grund eines gescheiterten Anfügens (Höhe der
  Entwurfsseite, `e2e/lagebericht-schmal.spec.ts`).
  Live über `anlagen` am Ereignis des Dokuments, eigene Keys außerhalb des Offline-Lagebilds.
- **Gegliederte Dokumente: ein Baustein `entwurf/DokumentEntwurf.tsx`** (LLH-1074, Spec
  `dokument-entwurf`; ersetzt das Akkordeon des Lageberichts aus LFH-348). Lagebericht, Befehl
  und Pressemitteilung schreiben ihre Abschnitte nur darüber, keine Seite baut eine eigene
  Abschnittsmechanik. Paneel „Entwurf“ mit Füllstand und Umschalter „Bearbeiten | Lesefassung“
  für das GANZE Dokument; der Kopfblock (`kopf`) trägt die Felder der Seite. Die Gliederung ist
  eine Sprungleiste mit Leer-Marke (Zeichen und Wort „leer“), ab `xl` links und klebend, darunter
  eine Zeile, die in sich rollt. Alle Abschnitte stehen offen untereinander; der Editor wächst mit
  dem Inhalt (leer einzeilig, `EDITOR_ZEILEN`), damit löst sich die Höhenfrage aus LFH-348 nicht
  durch Verstecken. Keine Vorschau-Spalte je Abschnitt: die Lesefassung zeigt das Dokument, wie
  es gedruckt wird; die Editoren bleiben dabei eingehängt (`hidden`).
  - Der Kopf eines Abschnitts trägt Name (h3), Hilfetext (`aria-describedby`) und die
    `aktion`-Render-Prop der Seite: dort setzt der Lagebericht `AbschnittUebernahme`. Neue
    Füllwege setzen an derselben Stelle an, der Baustein kennt keine Quelle. Eine Aktion für das
    ganze Dokument steht im Steckplatz `gliederungKopf` über der Sprungleiste, nie in der
    Landmarke „Gliederung“ (LLH-1081: `LeereAbschnitteFuellen`).
  - Tippen rendert nur das eigene `Form.Item`: die Seite beobachtet nur die Felder des
    Druckkopfs, nie `useWatch([])`; der Baustein liest die Leer-Kette über `Form.useWatch` mit
    Selektor (`dokumentEntwurfKern.ts`). `AbschnittBlock` ist `memo`, alle Props
    identitätsstabil (`aktion` per `useCallback`). Gate ist der Render-Zähler in
    `DokumentEntwurf.test.tsx` (`rerender` mit neuem Element), die Tippmessung
    `e2e/lagebericht-tippen.spec.ts` (Deckel nur mit `PW_LATENZ=1`, beide Seiten).
  - Druck in `entwurf/dokumentEntwurf.css`: im Bearbeiten die Druckfassung je Editor mit
    Papiertitel (LFH-1008), in der Lesefassung die Lesefassung; Bedienung weicht. Die
    Druck-CSS der Seiten trägt keine Editor-Regel (`pages/*Print.test.ts`).
- **Lageberichte-Übersicht** (LLH-1064): Paneele „Aktueller Lagevortrag“ (jüngste Freigabe nach
  Zeitstand) · „In Arbeit“ · „Verlauf“, Teilung nur in `lageberichte/uebersicht.ts`, jeder Bericht
  genau einmal. Text, Füllstand („5/8 Abschnitte“) und „zuletzt gespeichert“ aus dem Einzelabruf
  (Spec `listen-projektion`), nie als Feld der Liste. „Neuer Lagevortrag“ legt ohne Dialog mit
  EINEM POST an und öffnet den Entwurf (`lageberichte/NeuerLagevortragKnopf.tsx`, Pfeil für
  „Leerer Lagevortrag“ und die übrigen Vorlagen); der Startinhalt geht in denselben POST.
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
- **Mehrere Abschnitte in einem Schritt** (LLH-1081, Spec `lagevortrag-uebernahme`): „Neuer
  Lagevortrag“ lädt beim Klick alle Quellen der Vorlage und legt mit ihren Texten als Startinhalt
  an; im Entwurf füllt „Leere Abschnitte aus dem Lagebild füllen“ nur, was leer ist und beim
  Eintreffen noch leer ist, ohne Rückfrage, mit `onGeaendert`. Beide nur über
  `lageberichte/startinhalt.ts`, das je Abschnitt `erzeuge` der Quelle ruft (kein zweiter
  Wortlaut); nicht freie Quelle, unbekannte Freigaben oder ein Wurf stehen als „— (Grund)“ im
  Abschnitt, ohne Abruf der gesperrten Quelle.
- **Stand der Übernahme** (LLH-1357, Spec `lagevortrag-uebernahme`): Jeder dieser Füllwege setzt
  mit dem Text `uebernommen_at` am Abschnitt (Wire-Format, nur über
  `lageberichte/standFeld.ts`); er steht im JSON der Abschnitte, keine Spalte, und das
  Fortschreiben trägt ihn mit. Im Formular unter `['uebernommen_at', <schlüssel>]`, eingehängt als
  `Form.Item` um die Marke `lageberichte/UebernahmeStand.tsx` an der `aktion` (nur Abschnitte mit
  Quelle); ein geleerter Abschnitt verliert ihn (`onValuesChange`, Server ebenso). Auffällig „aus
  der Vorfassung“, wenn er vor `erstellt_at` einer Fortschreibung liegt.
- **Weitere Quellen im Lagevortrag zur Information** (LFH-869,
  `openspec/changes/archive/2026-10-04-lfh-869-lagevortrag-weitere-abschnitte/design.md`, Spec
  `lagevortrag-uebernahme`):
  Gefahren-/Schadenlage, Lageentwicklung und Besondere (Führungs-)Probleme; Auftrag, Anträge und
  Zusammenfassung bleiben von Hand. Das Lagebild lädt beim Klick nur über `ladeLagebasis` aus
  `LAGEBILD_QUELLEN` (`pages/lage-dashboard/useLagebild.ts`, dieselben Keys und Module wie der
  Hook), Wortlaut aus Vorbereitung (`lagebesprechung/vorbereitung.ts`) und Funkplan
  (`funkplanLueckenZeilen`). **Kein Freitext aus Auftrag, Meldung, ETB, Personen oder Schäden**
  (Dritte), nur Zahlen, Nummern, Arten und Zeiten als DTG. Die Lageentwicklung zählt ab dem
  ETB-Eintrag der letzten Lagebesprechung nach `lfd_nr`, ohne `system` und freigegebene
  Lagevorträge, und legt keinen Freitext in den Zwischenspeicher (er wird offline gesichert).
  Fortschreibung (LLH-1110): Die Gefahren-/Schadenlage nennt je Gefahrengebiet Name, Stufe und
  **Erläuterung** der gesetzten Zellen (`gesetzteGefahren` in `pages/gefahren/erlaeuterungen.ts`).
  Das ist Beurteilung der eigenen Führung, kein Freitext Dritter; „gemeldet von“ bleibt draußen.
  Freitext geht nur durch `md()`.
