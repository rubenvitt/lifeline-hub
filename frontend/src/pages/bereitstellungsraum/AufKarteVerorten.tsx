import { Button } from 'antd';
import { useNavigate } from 'react-router';
import type { Bereitstellungsraum } from '../../api/types';
import { GesperrterSprung } from '../../components/Sprung';
import { useSprungSperre } from '../../einsatz/useSprungSperre';
import { lagekartePfad } from '../../routing/deeplinks';

/**
 * „Auf Karte verorten“ eines Bereitstellungsraums (LLH-1107, Muster Betreuungsstelle LFH-673):
 * öffnet die Lagekarte im Platziermodus für diesen Raum (`?platzieren=bereitstellungsraum:<id>`);
 * der nächste Klick in die Karte setzt die Koordinate. Ein verorteter Raum wird auf demselben Weg
 * versetzt. Ob der Raum bearbeitet werden darf, prüft der Aufrufer; hier nur die Freigabe der
 * Lagekarte (LFH-888): gesperrt steht der Knopf mit Grund im Text.
 */
export default function AufKarteVerorten({
  einsatzId,
  br,
}: {
  einsatzId: number;
  br: Pick<Bereitstellungsraum, 'id' | 'lat' | 'lon'>;
}) {
  const navigate = useNavigate();
  const gesperrt = useSprungSperre(einsatzId);
  const wort = br.lat != null && br.lon != null ? 'Auf Karte versetzen' : 'Auf Karte verorten';
  if (gesperrt('lagekarte')) return <GesperrterSprung>{wort}</GesperrterSprung>;
  return (
    <Button
      onClick={() =>
        navigate(
          lagekartePfad(einsatzId, { platzieren: { typ: 'bereitstellungsraum', id: br.id } }),
        )
      }
    >
      {wort}
    </Button>
  );
}
