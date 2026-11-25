import { useId, useState } from 'react';
import { Input, Modal, Radio, Typography } from 'antd';
import { IconWarndreieck } from '../../icons';
import { Stapel, Textstufe, schriftStil, useRollen } from '../../components/instrument';
import type { WeitereAktionen } from '../../components/Datensicht';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { vorText } from '../../anzeige/dauer';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import { FREMDEBENE_FEHLERTEXT, FREMDEBENE_GRENZEN, type Fremdebene } from '../../api/fremdebenen';
import { FREMDEBENE_TOENE, type FremdebeneTon } from '../../theme/tokens';
import { fremdebeneFarbe } from '../../theme/statusFarben';
import { loeschDialogBild } from './BildHintergruende';
import { Farbfeld, ebenenZeileStil } from './leistenTeile';

/** Namen der Palettentöne in der Farbwahl: ein Wort statt einer Nummer. */
const TON_NAME: Record<FremdebeneTon, string> = {
  'fremd-1': 'Indigo',
  'fremd-2': 'Petrol',
  'fremd-3': 'Pflaume',
  'fremd-4': 'Oliv',
  'fremd-5': 'Violett',
  'fremd-6': 'Ocker',
};

export interface FremdebenenZeilenProps {
  /** Die Ebenen, die die Suche stehen lässt (ohne Suche alle). */
  ebenen: readonly Fremdebene[];
  /** Was dieser Arbeitsplatz zeigt (`useFremdebenen`). */
  sichtbar: ReadonlySet<number>;
  onToggle: (id: number) => void;
  darfSchreiben: boolean;
  onUmbenennen: (id: number, name: string) => void;
  onFarbe: (id: number, farbe: FremdebeneTon) => void;
  onEntfernen: (id: number) => void;
  /** Abgelehnter Schreibweg (Umbenennen, Farbe, Entfernen). */
  fehler?: unknown;
}

type Dialog = { art: 'umbenennen' | 'farbe' | 'entfernen'; id: number } | null;

/**
 * Gruppe „Fremdebenen“ im Ebenenbaum (LLH-2099, Entwurf „Oberfläche“): je Ebene eine Zeile als
 * Schalter (`role="switch"`, Name = Ebenenname) mit Farbfeld, bei einer URL-Ebene dem Alter des
 * letzten Abrufs bzw. dem Warnhinweis zum Fehlercode, daneben das ⋮ (nur mit Schreibrecht).
 *
 * Die Sichtbarkeit gilt für diesen Arbeitsplatz, nicht am Datensatz. Entfernen löscht die Ebene
 * für alle und hat keinen Rückweg (eine URL-Ebene wäre neu abzurufen, eine Datei neu
 * hochzuladen): rot hinter dem Trenner, Rückfrage mit Folgesatz und rotem Knopf wie „Bild
 * entfernen …“ (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“, ADR-0055).
 */
export default function FremdebenenZeilen(props: FremdebenenZeilenProps) {
  const { darfSchreiben } = props;
  // Ändern geht nur mit Netz (Entwurf „Offline“); der Grund steht sichtbar über den Zeilen.
  const ohneVerbindung = useOhneVerbindung();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [neuerName, setNeuerName] = useState('');
  const ziel = loeschDialogBild(props.ebenen, dialog?.id ?? null);
  const schliesse = () => setDialog(null);

  const menue: WeitereAktionen<Fremdebene> | undefined = darfSchreiben
    ? {
        eintraege: () => [
          { key: 'umbenennen', label: 'Umbenennen …' },
          { key: 'farbe', label: 'Farbe …' },
          { key: 'entfernen', label: 'Entfernen …', gefahr: true },
        ],
        zugaenglicherName: (e) => `Aktionen zu ${e.name}`,
        onWahl: (key, e) => {
          if (key === 'umbenennen') setNeuerName(e.name);
          setDialog({ art: key as 'umbenennen' | 'farbe' | 'entfernen', id: e.id });
        },
      }
    : undefined;

  const umbenennen = () => {
    const t = neuerName.trim();
    if (ziel && t && t !== ziel.name) props.onUmbenennen(ziel.id, t);
    schliesse();
  };

  return (
    <Stapel abstand="xs">
      <SpeicherFehler fehler={props.fehler} />
      {menue && ohneVerbindung && props.ebenen.length > 0 && (
        <Textstufe stufe="meta" ton="text2">
          {OHNE_VERBINDUNG_NICHT_AENDERBAR}
        </Textstufe>
      )}
      <div>
        {props.ebenen.map((e) => (
          <FremdebeneZeile
            key={e.id}
            ebene={e}
            sichtbar={props.sichtbar.has(e.id)}
            onToggle={() => props.onToggle(e.id)}
            menue={menue}
            gesperrt={ohneVerbindung}
          />
        ))}
      </div>

      <Modal
        open={dialog?.art === 'umbenennen' && ziel != null}
        title={`Fremdebene „${ziel?.name ?? ''}“ umbenennen`}
        okText="Umbenennen"
        cancelText="Abbrechen"
        okButtonProps={{ disabled: neuerName.trim() === '' }}
        // Ein Tipp neben den Dialog verwirft keinen getippten Namen (LLH-2010).
        mask={{ closable: false }}
        onOk={umbenennen}
        onCancel={schliesse}
        destroyOnHidden
      >
        <Input
          aria-label="Name"
          value={neuerName}
          maxLength={FREMDEBENE_GRENZEN.nameMax}
          onChange={(ev) => setNeuerName(ev.target.value)}
          onPressEnter={umbenennen}
        />
      </Modal>

      <Modal
        open={dialog?.art === 'farbe' && ziel != null}
        title={`Farbe von „${ziel?.name ?? ''}“`}
        footer={null}
        onCancel={schliesse}
        destroyOnHidden
      >
        {ziel && (
          <FarbWahl
            wert={ziel.color}
            onWahl={(ton) => {
              if (ton !== ziel.color) props.onFarbe(ziel.id, ton);
              schliesse();
            }}
          />
        )}
      </Modal>

      <Modal
        open={dialog?.art === 'entfernen' && ziel != null}
        title={`Fremdebene „${ziel?.name ?? ''}“ entfernen?`}
        okText="Entfernen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => {
          if (ziel) props.onEntfernen(ziel.id);
          schliesse();
        }}
        onCancel={schliesse}
        destroyOnHidden
      >
        <Typography.Paragraph>
          Die Ebene verschwindet mit ihren Daten für alle aus dem Einsatz. Zurück kommt sie nur,
          wenn jemand sie neu hinzufügt.
        </Typography.Paragraph>
      </Modal>
    </Stapel>
  );
}

function FremdebeneZeile({
  ebene,
  sichtbar,
  onToggle,
  menue,
  gesperrt,
}: {
  ebene: Fremdebene;
  sichtbar: boolean;
  onToggle: () => void;
  menue: WeitereAktionen<Fremdebene> | undefined;
  gesperrt: boolean;
}) {
  const { token, rollen } = useRollen();
  const jetzt = useMinutenTakt();
  const standId = useId();
  const fehlerId = useId();
  const istUrl = ebene.source === 'url';
  const fehler = istUrl && ebene.error ? FREMDEBENE_FEHLERTEXT[ebene.error] : null;
  // „Fachebenen nennen ihr Alter“: eine URL-Ebene sagt, wann der Server zuletzt abgeholt hat.
  const alter = istUrl && ebene.fetched_at ? vorText(ebene.fetched_at, jetzt) : '';
  const beschreibung = [alter ? standId : null, fehler ? fehlerId : null]
    .filter((x) => x != null)
    .join(' ');
  return (
    <div
      data-fremdebene={ebene.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBlockEnd: `1px solid ${rollen.flaeche3}`,
        paddingInlineEnd: token.paddingXS,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={sichtbar}
        aria-label={ebene.name}
        aria-describedby={beschreibung || undefined}
        className="lfh-ebenenzeile"
        onClick={onToggle}
        style={{
          ...ebenenZeileStil(token),
          flex: 1,
          minWidth: 0,
          alignItems: 'flex-start',
          lineHeight: token.lineHeight,
          color: sichtbar ? rollen.text : rollen.text2,
        }}
      >
        <Farbfeld an={sichtbar} farbe={fremdebeneFarbe(ebene.color, token)} />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <Textstufe stufe="textKlein" ton={sichtbar ? 'text' : 'text2'}>
            {ebene.name}
          </Textstufe>
          {alter && (
            <span id={standId} style={{ ...schriftStil('meta'), color: rollen.text2 }}>
              {`abgerufen ${alter}`}
            </span>
          )}
          {/* Der Text trägt die Aussage, die Farbe ist der zweite Kanal; das Zeichen ist stumm. */}
          {fehler && (
            <span
              id={fehlerId}
              data-lfh="fremdebene-fehler"
              style={{ ...schriftStil('textKlein'), color: rollen.achtungText }}
            >
              <span
                aria-hidden="true"
                style={{ display: 'inline-flex', marginInlineEnd: token.marginXXS }}
              >
                <IconWarndreieck size={12} />
              </span>
              {fehler}
            </span>
          )}
        </span>
      </button>
      {menue && <ZeilenMenueAusloeser menue={menue} zeile={ebene} gesperrt={gesperrt} />}
    </div>
  );
}

/** Die sechs Töne als Radiogruppe; das Wort ist der zweite Kanal neben dem Farbfeld. */
function FarbWahl({ wert, onWahl }: { wert: string; onWahl: (ton: FremdebeneTon) => void }) {
  const { token } = useRollen();
  return (
    <Radio.Group
      aria-label="Farbe"
      value={wert}
      onChange={(ev) => onWahl(ev.target.value as FremdebeneTon)}
    >
      <Stapel abstand="xs">
        {FREMDEBENE_TOENE.map((ton) => (
          <Radio key={ton} value={ton}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
              <Farbfeld an farbe={fremdebeneFarbe(ton, token)} />
              {TON_NAME[ton]}
            </span>
          </Radio>
        ))}
      </Stapel>
    </Radio.Group>
  );
}
