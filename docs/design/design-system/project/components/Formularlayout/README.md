# Formularlayout (Feldgruppen im Formularpaneel, Speicherleiste)

Feldgruppe einer Formularseite: ein `Paneel` mit Augenbrauen-Kopf statt einer Überschrift über
losen Feldern. Die Gruppe ist eine Überschrift der Ebene 2 — der Seitentitel ist das `h1`.
Genutzt von Einstellungen und Stammdaten-Formularen (Kopf + optionale Beschreibung +
gepolsterter Körper + Abstand nach unten).

Die Felder bleiben Kinder desselben `<Form>` — das Paneel ist reine Hülle. Die sticky
Speichern-Leiste steht DANACH im selben `<form>` (Enter sendet, Erfassungs-Norm B4).

Quelle: `frontend/src/components/instrument/Formularpaneel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
