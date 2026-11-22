# Geheimfeld (nicht gesetzt, gesetzt, offen, unlesbar, gesperrt, nur lesen)

Geheimfeld (Entwurf `docs/design/2026-11-22-adapter/Geheimfeld.dc.html`): ein
Geheimnis setzen, ersetzen oder entfernen, nie lesen. Die Zeile zeigt nur „gesetzt … von …“,
„nicht gesetzt“ (beim Pflichtplatz in Achtung-Farbe) oder „unlesbar“ (mit einem anderen
Schlüssel des Servers gesetzt), nie den Wert, auch nicht verdeckt: keine Punkte, keine Länge.
„Setzen“/„Ersetzen“ öffnet in der Zeile ein Passwortfeld ohne Autofill; „Speichern“ schickt den
Wert und leert das Feld sofort, auch wenn das Senden scheitert. Escape und „Abbrechen“
verwerfen. Der Wert lebt nur im State dieser Zeile, nie in einem `Form`-Store oder im
Query-Cache. „Entfernen …“ fragt rot nach.

Quelle: `frontend/src/components/Geheimfeld.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
