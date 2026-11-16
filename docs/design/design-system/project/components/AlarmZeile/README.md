# AlarmZeile „Was brennt“ (Einträge, Ruhe, unvollständig)

AlarmZeile „Was brennt“ (LLH-1743, Spec `lage-alarmzeile`, design.md D3; Regel
„Dashboard-Baukasten“, `frontend/AGENTS.md`): das erste Element unter dem Seitenkopf von
Überblick, Lagebild und Lagemonitor. Der Baustein ordnet nur an; Einträge, Folge und Wortlaut
kommen aus `lage/wasBrennt.ts`.

- **Feste Höhe** in jeder Lage (Spec „Feste Höhe ohne Sprung“): eine Zeile, was nicht passt,
  steht als „+n“; der Knopf zeigt alle Einträge als Liste. Kein Ton, kein Blinken, kein
  Verschieben des Inhalts darunter (Alarmbudget, „Live-Updates springen nicht“).
- **Ruhe nur bei vollständigen Quellen:** „Nichts brennt“ nur bei `stand: 'vollstaendig'`;
  beim Laden „—“, mit gescheiterter Quelle „Stand unvollständig“ samt Grund.
- **Rolle und Wort:** Alarm- und Achtungsfläche aus `statusFlaeche`; das Wort im Eintrag ist
  der zweite Kanal zur Farbe. `role="status"` (höflich), denn `alert` gehört der Alarmzone.
- **`gross`** für den Lagemonitor: 28 px, ohne Bedienung und ohne Links.

Quelle: `frontend/src/components/instrument/AlarmZeile.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
