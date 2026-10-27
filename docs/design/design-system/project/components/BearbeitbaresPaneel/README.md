# BearbeitbaresPaneel (offen und gesperrt)

BearbeitbaresPaneel — „Bearbeiten in der Ansicht“ (LLH-1139, `frontend/AGENTS.md`, „Bearbeiten
in der Ansicht“; Spec `formularseiten`, „Eine offene Bearbeitung je Ansicht“). Der EINE Baustein
für paneel- und ansichtsweises Speichern; Fach-Seiten bauen keinen eigenen.

- **Modus `paneel`** (Stufe Paneel): ein `Paneel` mit `Datenraster`; „Bearbeiten“ im Kopf schaltet
  NUR dieses Paneel um — dieselben Zellen werden zu Eingaben (`DatenfeldEingabe`, das Etikett
  bleibt der Begriff), Speichern/Abbrechen im Fuß.
- **Modus `ansicht`** (Stufe ganze Ansicht, oder eine Karte, die selbst die Ansicht ist): kein
  eigener Rahmen und keine Lesefassung; die Ansicht des Aufrufers ist die Anzeige, er öffnet über
  `offen`/`onOffenAenderung`. Der Fuß ist die klebende Speichern-Leiste (`useSpeicherLeiste`).
- **Eine offene Bearbeitung je Seite:** das Öffnen belegt den Merker
  `components/offeneBearbeitung.tsx` (`melde('offen')`), jedes andere „Bearbeiten“ und jedes
  Einzelfeld der Seite ist gesperrt mit „Erst „Titel“ speichern oder abbrechen“. Die Rückfrage vor
  dem Verlassen kommt erst mit einer Änderung (`melde('geaendert')`). Ohne Merker der Seite legt
  der Baustein seinen eigenen an: der Verlassen-Schutz gilt immer (Data Router nötig, in Tests
  `renderMitProviders(…, { datenRouter: true })`).
- **CAS:** `useEditSitzung` friert `geaendert_at` und die Werte beim Öffnen ein; ein
  Hintergrund-Refetch ändert weder die Eingaben noch die Basis. `onSpeichern(patch, basis)`;
  `basis` `undefined` heißt „Meine Änderung übernehmen“ nach einem 409.
- **Nur Geändertes:** der Patch enthält nur Felder, deren Wert sich nach Inhalt geändert hat
  (`bearbeitetePatch`, oder `patch` des Aufrufers); ein leerer Patch sendet nichts und schließt.
- **Tastatur:** Enter speichert (Knopf `submit` im `<form>`, Erfassungs-Norm), Escape bricht ab
  (eine offene Auswahl schluckt Escape selbst: rc-select stoppt die Ausbreitung). Fokus beim
  Öffnen ins erste Feld, beim Schließen zurück auf „Bearbeiten“ bzw. `ausloeserRef`.
- **Fehler am Ort** (LFH-1077): Prüffehler unter der Zelle, eine Ablehnung als `SpeicherFehler`
  am Paneel, der 409 als Rückfrage „Zwischenzeitlich geändert“. Kein Toast.

Quelle: `frontend/src/components/instrument/BearbeitbaresPaneel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
