import { Alert, Button } from 'antd';
import { useLinkClickHandler } from 'react-router';
import { EINTRAEGE } from 'virtual:neuigkeiten';
import type { VersionsstandAnzeige } from '../api/types';
import { useMarkiereGelesen } from './useVersionsstand';
import { ungelesene } from './neuigkeiten';
import { NEUIGKEITEN_PFAD } from './pfad';

/**
 * Die Hinweiskarte selbst (Spec `neuigkeiten`). Sie lebt in einem eigenen Modul, weil sie die
 * Einträge trägt; `NeuigkeitenHinweis` lädt es nur, wenn es etwas Ungelesenes gibt.
 */
export default function HinweisKarte({ stand }: { stand: VersionsstandAnzeige }) {
  const markiere = useMarkiereGelesen();
  const zurSeite = useLinkClickHandler<HTMLElement>(NEUIGKEITEN_PFAD);

  if (!stand.gelesen_bis) return null;
  const neu = ungelesene(EINTRAEGE, stand.laufend, stand.gelesen_bis);
  if (neu.length === 0) return null;

  return (
    <div data-lfh="neuigkeiten-hinweis">
      <Alert
        type="info"
        showIcon
        closable
        onClose={() => markiere.mutate()}
        title={`Neu seit ${stand.gelesen_bis}: ${neu.length} ${neu.length === 1 ? 'Version' : 'Versionen'}`}
        description={
          // Ein Verweis als Schaltfläche, wie der Demo-Hinweis der Einsatzliste: `href` bleibt ein
          // `<a>`, der schlichte Klick navigiert in der App.
          <Button href={NEUIGKEITEN_PFAD} onClick={zurSeite}>
            Neuigkeiten ansehen
          </Button>
        }
      />
    </div>
  );
}
