import { Button, Space, Typography } from 'antd';
import { useNavigate } from 'react-router';
import type { Tier } from '../../api/types';
import KoordinatenAnzeige from '../../anzeige/KoordinatenAnzeige';
import { Datenfeld } from '../../components/instrument';
import { GesperrterSprung } from '../../components/Sprung';
import { useSprungSperre } from '../../einsatz/useSprungSperre';
import { lagekartePfad } from '../../routing/deeplinks';

/**
 * Feld „Verortung“ der Tier-Detailseite (LLH-1123, Muster Schaden und Bereitstellungsraum): die
 * Fundort-Koordinate oder „nicht verortet“. Mit `darfVerorten` daneben „Auf Karte verorten“ bzw.
 * „Auf Karte versetzen“: öffnet die Lagekarte im Platziermodus für dieses Tier
 * (`?platzieren=tier:<id>&zurueck=1`), der nächste Klick setzt die Koordinate. Ob das Tier
 * bearbeitet werden darf (Schreibrecht, nicht storniert, nicht abgeschlossen), entscheidet der
 * Aufrufer; hier nur die Freigabe der Lagekarte (LFH-888): gesperrt steht der Knopf mit Grund.
 */
export default function TierVerortung({
  einsatzId,
  tier,
  darfVerorten,
}: {
  einsatzId: number;
  tier: Pick<Tier, 'id' | 'antreff_lat' | 'antreff_lon'>;
  darfVerorten: boolean;
}) {
  const verortet = tier.antreff_lat != null && tier.antreff_lon != null;
  return (
    <Datenfeld label="Verortung">
      <Space wrap>
        {verortet ? (
          <KoordinatenAnzeige
            lat={tier.antreff_lat!}
            lon={tier.antreff_lon!}
            einsatzId={einsatzId}
          />
        ) : (
          <Typography.Text type="secondary">nicht verortet</Typography.Text>
        )}
        {darfVerorten && <AufKarte einsatzId={einsatzId} tierId={tier.id} versetzen={verortet} />}
      </Space>
    </Datenfeld>
  );
}

function AufKarte({
  einsatzId,
  tierId,
  versetzen,
}: {
  einsatzId: number;
  tierId: number;
  versetzen: boolean;
}) {
  const navigate = useNavigate();
  const gesperrt = useSprungSperre(einsatzId);
  const wort = versetzen ? 'Auf Karte versetzen' : 'Auf Karte verorten';
  if (gesperrt('lagekarte')) return <GesperrterSprung>{wort}</GesperrterSprung>;
  return (
    <Button
      onClick={() =>
        navigate(
          // Mit Herkunft: „Zurück zu T-…“ führt danach auf diese Seite (LLH-1125).
          lagekartePfad(einsatzId, { platzieren: { typ: 'tier', id: tierId, zurueck: true } }),
        )
      }
    >
      {wort}
    </Button>
  );
}
