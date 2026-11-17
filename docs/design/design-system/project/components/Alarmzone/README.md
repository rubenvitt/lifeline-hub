# Alarmzone (gebündelt, aufgeklappt)

Alarmzone (design.md D1–D3 in
`openspec/changes/archive/2026-11-15-zu9ptja2-alarmzone/`, Entwurf `docs/design/2026-11-15-alarmzone/`): Alarme,
Org-Hinweise und die Unwetterwarnung stehen hier statt als Toast oben rechts. Sie steht im Rahmen
direkt unter dem Kopf und einem Übungsband, klebt beim Rollen darunter (`RAHMEN_RANG.alarmzone`) und
schiebt den Inhalt, statt ihn zu verdecken. Auf `RAHMEN_EBENE` liegt sie unter Drawer, Dialogen
und Menüs. Ohne Eintrag steht nichts.

Ein Eintrag ist eine Zeile. Ab zwei bündelt sie: zu der jüngste mit „+ n weitere“, auf eine
Kopfzeile mit Zahl und je Art der Zahl, darunter je Eintrag eine Zeile. Ein ✕ blendet nur aus, „Gelesen“ und „Öffnen“ quittieren.

`nurAbMd`: im Einsatz trägt unter `md` die Leiste am Handschirm die Alarme; im
Org-Rahmen gibt es keine Leiste, dort steht die Zone in jeder Breite.

Quelle: `frontend/src/alarm/AlarmZone.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
