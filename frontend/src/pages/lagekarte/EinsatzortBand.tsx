import { Button, Card, Typography } from 'antd';
import { Link } from 'react-router';
import { useRollen } from '../../components/instrument';
import { bandStil } from './KartenFuss';

/**
 * Band im Kartenfuß für einen Einsatzort ohne Punkt (LLH-1953): Die Karte öffnet sonst ohne
 * Mittelpunkt und schweigt, warum. Ohne Adresse heißt es „Einsatzort fehlt“, mit Adresse ohne
 * Koordinate „Einsatzort nicht verortet“ samt Adresse. Die Knöpfe gibt die Seite nur bei
 * Schreibrecht mit: „Auf der Karte setzen“ startet das Platzieren hier, „Adresse eintragen“
 * springt in die Einsatzdaten (Paneel Einsatzort). Ob das Band steht (Live, geladen, nicht beim
 * Platzieren), entscheidet die Seite; das Band folgt der Stapelregel (LFH-355). Nur Props.
 */
export default function EinsatzortBand({
  adresse,
  onPlatzieren,
  adressePfad,
}: {
  adresse: string | null;
  onPlatzieren?: () => void;
  adressePfad?: string;
}) {
  const { token, rollen } = useRollen();
  const text = adresse?.trim() ? adresse.trim() : null;
  const mitKnoepfen = onPlatzieren != null || adressePfad != null;
  return (
    <Card
      size="small"
      data-lfh="einsatzort-band"
      style={{ ...bandStil('links'), boxShadow: token.boxShadowSecondary, maxWidth: '100%' }}
      styles={{
        body: {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: token.marginSM,
        },
      }}
    >
      <section aria-label="Einsatzort" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <Typography.Text strong style={{ display: 'block' }}>
          {text ? 'Einsatzort nicht verortet' : 'Einsatzort fehlt'}
        </Typography.Text>
        {/* Lange Adressen brechen um, statt die Karte zu überdecken. */}
        {text && (
          <Typography.Text
            style={{ display: 'block', overflowWrap: 'anywhere', color: rollen.gedaempft }}
          >
            {text}
          </Typography.Text>
        )}
      </section>
      {/* Zwei gleichrangige, umrandete Knöpfe: wer den Ort sieht, tippt; wer nur die Adresse
          kennt, springt. Eng bricht die Reihe unter den Text. */}
      {mitKnoepfen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
          {onPlatzieren && <Button onClick={onPlatzieren}>Auf der Karte setzen</Button>}
          {adressePfad && (
            <Link to={adressePfad}>
              <Button>Adresse eintragen</Button>
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
