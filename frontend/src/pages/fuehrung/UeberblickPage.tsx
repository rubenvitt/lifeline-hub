import { Typography } from 'antd';
import EinsatzSeite from '../../components/EinsatzSeite';

/**
 * Führung · Überblick — die Startseite eines Einsatzes (Neuentwurf „Instrumententafel",
 * Screen S2, Entscheidung 3 des Auftraggebers).
 *
 * STUB aus Phase 2a (Shell-Rahmen): die Route, der Registry-Eintrag und die Umleitung von
 * `/einsaetze/:id` stehen, der Inhalt (Kennzahlenband, Abschnitte, offene Anordnungen,
 * Entscheidungen, nächste Marken) folgt in einer eigenen Phase. Bis dahin steht hier bewusst
 * NICHTS Erfundenes — keine Platzhalterzahlen (Entscheidung 4: „Keine erfundenen Daten").
 */
export default function UeberblickPage() {
  return (
    <EinsatzSeite titel="Überblick">
      <Typography.Paragraph type="secondary">
        Der Führungsüberblick wird gerade aufgebaut. Die Module erreichen Sie über die Navigation
        links oder die Sprungpalette.
      </Typography.Paragraph>
    </EinsatzSeite>
  );
}
