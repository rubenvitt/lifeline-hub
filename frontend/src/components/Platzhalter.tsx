import { IconBaustelle } from '../icons';
import { Button } from 'antd';
import { useNavigate } from 'react-router';
import Paneel from './instrument/Paneel';
import { schriftStil, useRollen } from './instrument/rollenwerte';
import Stapel from './instrument/Stapel';
import Textstufe from './instrument/Textstufe';
import { flaeche } from '../theme/tokens';

/** Rückweg aus einer Sackgasse: Zielpfad und Beschriftung des Primärknopfes.
 *  Den Pfad baut der Aufrufer (Einsatz-Deeplinks über `routing/deeplinks.ts`) —
 *  der Platzhalter ist ein Primitiv und kennt keine Einsatz-Routen. */
export interface PlatzhalterRueckweg {
  pfad: string;
  label: string;
}

interface Props {
  titel: string;
  beschreibung?: string;
  /**
   * Optionaler Rückweg (LFH-328/A2). Ohne ihn fehlt die Primäraktion — etwa in `pages/ProfilPage`,
   * die in keinem Einsatz-Kontext steht.
   */
  rueckweg?: PlatzhalterRueckweg;
}

/** Erwartungshorizont (LFH-328): sagt, woran man ist — mehr als ein „In Arbeit"-Etikett, aber
 *  ohne Erklärsatz (LFH-1078). Kontextfrei: `pages/ProfilPage` steht in keinem Einsatz. */
const ERWARTUNGSHORIZONT = 'Noch nicht verfügbar.';

/**
 * Einheitlicher Platzhalter für noch nicht implementierte Bereiche.
 *
 * Kein Fehler und keine Gefahr: ein geplantes Modul ist Information — Rot bedient nichts. Der
 * zweite Kanal neben der Farbe ist der Text selbst.
 *
 * Ein PANEEL mit Augenbraue „Geplant", Titel 14/600, Satz in `text2`/`gedaempft` und — wenn es
 * einen gibt — dem Rückweg als EINER Primäraktion. Die Breite ist gedeckelt
 * (`flaeche.seiteSchmal`), damit der Satz auf dem Fükw nicht über 1400 px läuft.
 *
 * Der Marker vor dem Titel ist das Icon „Baustelle“ des Satzes (LFH-595; vorher das Emoji 🚧).
 * Tests finden den Titel über `data-lfh="platzhalter-titel"`, nicht über ein Zeichen im Text.
 */
export default function Platzhalter({ titel, beschreibung, rueckweg }: Props) {
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel="Geplant"
      style={{
        maxWidth: flaeche.seiteSchmal,
        marginInline: 'auto',
        marginBlockStart: token.marginLG,
      }}
      koerperPolster
    >
      <Stapel abstand="sm">
        {/* Kein <h1>: die Überschrift der Fläche ist die Augenbraue im Paneelkopf, und die
            Seite um den Platzhalter trägt ihre eigene — zwei Hauptüberschriften wären falsch. */}
        <div
          data-lfh="platzhalter-titel"
          style={{
            ...schriftStil('seitentitel'),
            color: rollen.text,
            display: 'flex',
            alignItems: 'center',
            gap: token.marginXS,
          }}
        >
          <IconBaustelle />
          {titel}
        </div>
        {beschreibung && (
          <Textstufe stufe="textKlein" ton="text2" als="p">
            {beschreibung}
          </Textstufe>
        )}
        <Textstufe stufe="textKlein" ton="gedaempft" als="p">
          {ERWARTUNGSHORIZONT}
        </Textstufe>
        {rueckweg && (
          <div>
            <Button type="primary" onClick={() => navigate(rueckweg.pfad)}>
              {rueckweg.label}
            </Button>
          </div>
        )}
      </Stapel>
    </Paneel>
  );
}
