## Context

Der Einsatzabschluss (`POST /api/einsaetze/{id}/abschliessen`, nur aktiv → abgeschlossen, kein
Rückweg) hat im Frontend genau einen Einstieg: `pages/EtbPage.tsx`, ab Tablet quer als roter
Knopf im Seitenkopf mit `Popconfirm` „Ja“, darunter im Menü „Weitere“ mit einem `Modal`
„Abschließen“. Die Platzierung stammt aus einem frühen Plan, als das ETB die Hauptseite war.
Die Einsatzdaten (`pages/EinsatzdatenPage.tsx`) tragen Kopfdaten, Führungsstelle, Mitglieder,
„Bearbeiten“ und „Einsatzbericht drucken“. Die Regel „Der Bestätigungsknopf einer Rückfrage nennt
die Handlung“ steht seit dem Wortlaut-Change in `frontend/AGENTS.md`, aber ohne Guard; heute
tragen 13 der 32 `<Popconfirm>` einen roten Bestätigungsknopf ohne eigenen Text oder mit „Ja“.

## Goals / Non-Goals

**Goals:** Abschluss nur noch auf den Einsatzdaten, nur für die Einsatzleitung; jede Rückfrage
dieser Stellen nennt die Handlung; der BR-Kopf hält den Abstand; neue rote Rückfragen ohne
Handlungstext fallen im Guard auf.

**Non-Goals:** Wiedereröffnen eines Einsatzes; Eintippen der Einsatzbezeichnung (Entscheidung 5
schließt es aus); UHS/BR „Auflösen“ ins Aktionsmenü verlegen (der Server sperrt, solange belegt
ist, das Risiko ist klein); die acht Altstellen außerhalb dieses Tickets umstellen.

## Decisions

**D1 – Ort: eigener letzter Abschnitt auf den Einsatzdaten, nicht der Seitenkopf.** Ein Paneel
„Einsatzabschluss“ unter den Mitgliedern mit dem roten Knopf „Einsatz abschließen“, sichtbar nur
bei `darfEinsatzLeiten` (aktiver Einsatz, Einsatzleitung oder Admin). Kein Satz daneben: die
Folge steht in der Rückfrage (`ui-text-erklaert-nie-bedienung`). Während das Bearbeitungsformular
offen ist, fehlt der Abschnitt. Verworfen: Knopf im Kopf der
Einsatzdaten neben „Bearbeiten“ (die neue Regel nimmt Unumkehrbares aus jedem Seitenkopf, und am
Handy stünde er wieder in der ersten Zeile); Menü „Weitere“ im Kopf (ein Menü für einen einzigen
Eintrag, und der Abschluss wäre versteckt, ohne ferner zu liegen).

**D2 – Rückfrage bleibt `Popconfirm`.** Titel „Einsatz abschließen?“, Beschreibung „Danach sind
keine neuen Einträge oder Berichtigungen mehr möglich.“, Bestätigung „Einsatz endgültig
abschließen“ (`danger`), Abbrechen „Abbrechen“. Kein Modal: ohne Eingabe gibt es keinen Grund für
die Ausnahme von LFH-363. Die Mutation zieht samt Erfolgs- und Fehlertoast von `EtbPage` auf die
Einsatzdaten; nach Erfolg verschwindet der Abschnitt, weil der Einsatz nicht mehr aktiv ist.

**D3 – ETB ohne Abschluss und ohne Hinweis.** Kopf (Popconfirm), Menüeintrag und Modal entfallen.
Das Menü „Weitere“ am Handy trägt danach nur „Drucken / als PDF“ und bleibt: Nebenwege liegen am
Handy unter „Weitere“ (Entscheidung 8). Ein Hinweis auf den neuen Ort wäre ein Erklärtext.

**D4 – Benannte Rückfragen bei UHS und BR.** „Unfallhilfsstelle auflösen“, „Unfallhilfsstelle
stornieren“, „BR auflösen“, „BR stornieren“; `okButtonProps={{ danger: true }}` bleibt. Die
Unfallhilfsstelle steht ausgeschrieben, weil die Rückfrage zum Auflösen seit der Kürzel-Bereinigung
„Unfallhilfsstelle auflösen?“ fragt; die Storno-Rückfrage zieht ihren Titel nach („Unfallhilfsstelle
stornieren?“). „BR“ bleibt wie in den Quittungen der BR-Seite. Der BR-Kopf bekommt
`<Space wrap size="middle">` wie die UHS-Kopfzeile und steht in `MIT_NACHBARSCHAFT`.

**D5 – Rückfrage-Guard baumweit mit Schuldliste.** `components/rueckfrage.guard.test.ts` scannt
jede `.tsx` unter `src/` (ohne Tests): ein `<Popconfirm>`, dessen Kopf `danger` trägt, MUST ein
`okText` haben, das nicht „Ja“, „OK“ oder „Ok“ ist. Die acht heutigen Altstellen (sieben Dateien) außerhalb dieses
Tickets stehen namentlich in einer Schuldliste (Datei und Anzahl); eine Schuld, die nicht mehr
vorkommt, färbt den Guard rot („tote Ausnahme“, wie `dichte.guard.test.ts`), damit die Liste nur
schrumpft. Selbstbeweise für fehlendes `okText`, „Ja“, `okText={'OK'}` und den Pfeil im Kopf.
Verworfen: alle acht jetzt umstellen (berührt Dateien laufender Pakete, etwa `Datensicht.tsx`,
und jede Stelle braucht ihr eigenes Verb); nur die vier Dateien dieses Tickets prüfen (neue
Stellen fielen nicht auf). `modal.confirm` (6 Aufrufe) und `<Modal>` bleiben außen vor; der Guard
nennt das unter „Was dieser Guard NICHT sieht“.

## Risks / Trade-offs

- Der Abschluss liegt einen Schritt weiter weg. Gewollt: er kommt einmal je Einsatz vor.
- Nachtrag Umsetzung: das e2e misst nicht-privilegiert als Führungspersonal (schreibt im Einsatz,
  leitet ihn nicht), die schärfere Probe gegen „Schreibrecht statt Leitungsrecht“.
- Die Schuldliste hält acht Verstöße gegen eine bestehende Regel fest, bis das Folgeticket sie
  abbaut. Neue Verstöße fallen sofort auf.
