# Kopfaktion mit wechselndem Wortlaut (frei und gesperrt)

Beschriftung, die die Breite ihrer breitesten Form hält (LLH-1627). Für Kopfaktionen, deren
Wortlaut mit den Daten wechselt, etwa „Auflösen“ ↔ „Auflösen (noch 2 Personen)“: der Seitenkopf
bricht nach Inhaltsbreite um (`EinsatzSeite`), ein Knopf, der beim Ablegen eines Patienten
wächst, schob die Aktionen in eine zweite Zeile und alles darunter nach unten.

Die Reserve steht unsichtbar und stumm in derselben Rasterzelle wie der sichtbare Text
(`visibility: hidden`, `aria-hidden`), sie zählt weder zum Namen des Knopfs noch zur
Lesefolge. Zahlen laufen in Tabellenziffern, damit eine `0` in der Reserve so breit ist wie
jede andere Ziffer (Muster `metaPlatzhalter`).

Quelle: `frontend/src/components/BreiteHalten.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
