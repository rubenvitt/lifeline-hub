import { Switch, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Formularpaneel, Stapel } from '../../components/instrument';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { ladeOrgEinstellungen, speichereOrgEinstellungen } from '../../api/orgEinstellungen';
import { globalKeys } from '../../api/queryKeys';
import { useStammdatenHerkunft, VOM_HUB_TEXT } from '../../instanz/herkunft';
import { zuUpdate } from './orgEinstellungenForm';

/**
 * Org-Schalter „Ortung auch bei hauptamtlicher Besatzung“ (LLH-2091, ADR-0098). Speichert sofort
 * wie die Schalter in `EinsatzKennzahlen`. `PUT /api/org-settings` ist ein Vollersatz: die
 * übrigen Felder gehen aus dem geladenen Stand unverändert mit (`zuUpdate`), sonst setzte der
 * Schalter sie zurück. Bedienbar nur für Admins; die Zustandszeile nennt die Voraussetzung, sie
 * erklärt keine Bedienung (`frontend/AGENTS.md`, „Texte: zeigen statt erklären“).
 */
export default function OrtungHauptamt() {
  const qc = useQueryClient();
  const { benutzer } = useAuth();
  const herkunft = useStammdatenHerkunft();
  const darf = benutzer?.system_rolle === 'admin' && !herkunft.istVomHub('org_einstellungen', '');
  const abfrage = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
  });
  // Kein `onError`-Toast: die Ablehnung steht als Hinweis da, der Schalter springt zurück (die
  // Anzeige liest aus dem Query, kein optimistisches Update).
  const schalten = useMutation({
    mutationFn: (an: boolean) =>
      speichereOrgEinstellungen({ ...zuUpdate(abfrage.data!), ortung_hauptamt: an }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.orgEinstellungen() }),
  });

  // Ohne Leserecht (403) oder vor dem Laden steht nichts da; die Seite hat ihren eigenen Zustand.
  if (!abfrage.data) return null;
  const an = abfrage.data.ortung_hauptamt === 1;
  const feldId = 'ortung-hauptamt';

  return (
    <>
      <SeitenHinweise
        fehler={schalten.error}
        fehlerTitel="Nicht gespeichert"
        rechteFehlt={!darf}
        rechteText={herkunft.istVomHub('org_einstellungen', '') ? `${VOM_HUB_TEXT}.` : NUR_ADMIN}
      />
      <Formularpaneel titel="Ortung">
        <Stapel abstand="xs">
          <Stapel richtung="zeile" abstand="sm" ausrichten="mitte">
            <Switch
              id={feldId}
              aria-label="Ortung auch bei hauptamtlicher Besatzung"
              checked={an}
              disabled={!darf}
              loading={schalten.isPending}
              onChange={(wert) => schalten.mutate(wert)}
            />
            <label htmlFor={feldId}>Ortung auch bei hauptamtlicher Besatzung</label>
          </Stapel>
          <Typography.Text type="secondary">
            Nur mit Betriebs- oder Dienstvereinbarung (§ 87 Abs. 1 Nr. 6 BetrVG).
          </Typography.Text>
        </Stapel>
      </Formularpaneel>
    </>
  );
}
