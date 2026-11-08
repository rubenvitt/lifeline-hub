import { Button, Flex, Modal, Spin, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { listeEinsaetze } from '../api/einsaetze';
import { listeEinsatzVorlagen } from '../api/einsatzVorlagen';
import { planungUebernahmeVorschau, planungUebernehmen } from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type {
  Planung,
  PlanungUebernahmeErgebnis,
  PlanungUebernahmeZiel,
  SchichtplanEntscheidungenEingabe,
} from '../api/types';
import {
  ImportVorschauAnsicht,
  LEERE_WAHL,
  zaehlungMarken,
} from '../abloesung/schichtplan/ImportVorschauAnsicht';
import { Segmentleiste, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { EINSATZART_LABELS } from '../einsatz/einsatzart';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { abloesungPfad } from '../routing/deeplinks';
import { auswahlWert, vorlageAusWert, vorlagenOptionen } from '../stammdaten/einsatzVorlageModule';
import { uebernimmPlanung } from './planungCache';

type ZielArt = 'neu' | 'einsatz';

const ZIEL_OPTIONEN = [
  { wert: 'neu' as const, label: 'Neuer Einsatz' },
  { wert: 'einsatz' as const, label: 'Laufender Einsatz' },
];

/** Das Ziel aus der Wahl im Dialog; ohne gewählten laufenden Einsatz keins. */
export function uebernahmeZiel(
  art: ZielArt,
  vorlageId: number | null,
  einsatzId: number | null,
): PlanungUebernahmeZiel | null {
  if (art === 'neu') return vorlageId != null ? { art, vorlage_id: vorlageId } : { art };
  return einsatzId != null ? { art, einsatz_id: einsatzId } : null;
}

/** Was der neue Einsatz von der Planung trägt: Bezeichnung, Einsatzart, Ort. */
export function neuerEinsatzText(planung: Planung): string {
  const k = planung.kopf;
  return [`„${k.bezeichnung}“`, EINSATZART_LABELS[k.einsatzart], k.ort].filter(Boolean).join(' · ');
}

/**
 * „In Einsatz übernehmen“ (LLH-1587, Spec `vorplanung`, „Übernahme in einen Einsatz“): Ziel,
 * Vorschau, Ergebnis. Ziel ist ein neuer Einsatz (Bezeichnung, Einsatzart und Ort der Planung,
 * wahlweise mit Einsatz-Vorlage; er beginnt mit der Übernahme, die übernehmende Person leitet ihn)
 * oder ein laufender, in dem man schreiben darf. Die Vorschau
 * rechnet der Server mit demselben Kern wie „Schichtplan einlesen“ und schreibt nichts; jede Wahl
 * fragt sie neu ab. Danach ist die Planung schreibgeschützt.
 */
export default function PlanungUebernahmeDialog({
  planung,
  onClose,
}: {
  planung: Planung;
  onClose: () => void;
}) {
  const planungId = planung.kopf.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token } = useRollen();
  const grundId = useId();
  const [art, setArt] = useState<ZielArt>('neu');
  const [vorlageId, setVorlageId] = useState<number | null>(null);
  const [einsatzId, setEinsatzId] = useState<number | null>(null);
  const [wahl, setWahl] = useState<SchichtplanEntscheidungenEingabe>(LEERE_WAHL);
  const [ergebnis, setErgebnis] = useState<PlanungUebernahmeErgebnis | null>(null);

  const { data: vorlagen = [] } = useQuery({
    queryKey: globalKeys.einsatzVorlagen(),
    queryFn: listeEinsatzVorlagen,
  });
  const { data: einsaetze = [] } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });
  const laufende = einsaetze.filter((e) => darfImEinsatzSchreiben(e));

  const vorschauMut = useMutation({
    mutationFn: (v: { ziel: PlanungUebernahmeZiel; wahl: SchichtplanEntscheidungenEingabe }) =>
      planungUebernahmeVorschau(planungId, { ziel: v.ziel, entscheidungen: v.wahl }),
  });
  const uebernehmenMut = useMutation({
    mutationFn: (v: { ziel: PlanungUebernahmeZiel; wahl: SchichtplanEntscheidungenEingabe }) =>
      planungUebernehmen(planungId, { ziel: v.ziel, entscheidungen: v.wahl }),
    onSuccess: (r) => {
      uebernimmPlanung(qc, r.planung);
      void qc.invalidateQueries({ queryKey: globalKeys.planungen(), exact: true });
      if (r.einsatz_neu) void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      setErgebnis(r);
    },
  });

  // Beim Öffnen gilt „Neuer Einsatz“ ohne Vorlage: die Vorschau steht gleich da.
  const { mutate: requestVorschau, reset: resetVorschau } = vorschauMut;
  useEffect(() => {
    requestVorschau({ ziel: { art: 'neu' }, wahl: LEERE_WAHL });
  }, [requestVorschau]);

  /** Neues Ziel: die Wahl gilt nur für ein Ziel, die Vorschau kommt neu. */
  const changeZiel = (a: ZielArt, vorlage: number | null, einsatz: number | null) => {
    setArt(a);
    setVorlageId(vorlage);
    setEinsatzId(einsatz);
    setWahl(LEERE_WAHL);
    uebernehmenMut.reset();
    const ziel = uebernahmeZiel(a, vorlage, einsatz);
    if (ziel) requestVorschau({ ziel, wahl: LEERE_WAHL });
    else resetVorschau();
  };
  const ziel = uebernahmeZiel(art, vorlageId, einsatzId);
  const changeWahl = (neu: SchichtplanEntscheidungenEingabe) => {
    if (!ziel) return;
    setWahl(neu);
    uebernehmenMut.reset();
    requestVorschau({ ziel, wahl: neu });
  };

  const vorschau = vorschauMut.data ?? null;
  const laeuft = vorschauMut.isPending || uebernehmenMut.isPending;
  const sperrGrund =
    ziel == null
      ? 'Einsatz wählen'
      : vorschau == null
        ? null
        : !vorschau.uebernehmbar
          ? 'Fehler in der Planung'
          : art === 'einsatz' && vorschau.zaehlung.aenderungen === 0
            ? 'Keine Änderungen'
            : null;
  const close = () => {
    if (!uebernehmenMut.isPending) onClose();
  };

  const fuss = ergebnis ? (
    <Flex gap={token.marginSM} justify="end" wrap>
      <Button onClick={close}>Schließen</Button>
      <Button
        type="primary"
        onClick={() => void navigate(abloesungPfad(ergebnis.einsatz_id, { ansicht: 'plan' }))}
      >
        Zum Schichtplan des Einsatzes
      </Button>
    </Flex>
  ) : (
    <Flex gap={token.marginSM} justify="end" align="center" wrap>
      {sperrGrund != null && (
        <Typography.Text type="secondary" id={grundId} data-lfh="uebernahme-gesperrt">
          {sperrGrund}
        </Typography.Text>
      )}
      <Button onClick={close} disabled={uebernehmenMut.isPending}>
        Abbrechen
      </Button>
      <Button
        type="primary"
        disabled={ziel == null || vorschau == null || sperrGrund != null || vorschauMut.isPending}
        loading={uebernehmenMut.isPending}
        aria-describedby={sperrGrund != null ? grundId : undefined}
        onClick={() => ziel && uebernehmenMut.mutate({ ziel, wahl })}
      >
        Übernehmen
      </Button>
    </Flex>
  );

  const nummer = ergebnis?.planung.kopf.uebernahme?.einsatznummer;
  return (
    <Modal
      open
      title="In Einsatz übernehmen"
      onCancel={close}
      footer={fuss}
      width={760}
      destroyOnHidden
      mask={{ closable: false }}
      closable={!uebernehmenMut.isPending}
    >
      <div data-lfh="planung-uebernahme">
        {ergebnis ? (
          <Flex vertical gap={token.marginSM} data-lfh="uebernahme-ergebnis">
            <Typography.Text strong>
              {ergebnis.einsatz_neu ? 'Einsatz angelegt, Plan übernommen' : 'Plan übernommen'}
              {nummer != null ? ` · ${nummer}` : ''}
            </Typography.Text>
            <Flex gap={token.marginXS} wrap>
              {zaehlungMarken(ergebnis.zaehlung).map((m) => (
                <Tag key={m}>{m}</Tag>
              ))}
            </Flex>
            <Typography.Text type="secondary">
              Die Planung ist jetzt schreibgeschützt.
            </Typography.Text>
          </Flex>
        ) : (
          <Flex vertical gap={token.margin}>
            <Typography.Text type="secondary">
              Danach ist die Planung schreibgeschützt.
            </Typography.Text>
            <Flex gap={token.marginSM} align="center" wrap>
              <Segmentleiste<ZielArt>
                beschriftung="Ziel der Übernahme"
                wert={art}
                optionen={ZIEL_OPTIONEN}
                onWechsel={(a) => changeZiel(a, a === 'neu' ? vorlageId : null, null)}
                style={{ flex: 'none' }}
              />
              {art === 'neu' ? (
                <Select<number>
                  aria-label="Einsatz-Vorlage"
                  value={auswahlWert(vorlageId)}
                  onChange={(w) => changeZiel('neu', vorlageAusWert(w), null)}
                  disabled={laeuft}
                  options={vorlagenOptionen(vorlagen, 'Ohne Vorlage')}
                  style={{ flex: '1 1 14rem', minWidth: 0 }}
                />
              ) : laufende.length === 0 ? (
                <Typography.Text type="secondary" data-lfh="uebernahme-kein-einsatz">
                  Kein laufender Einsatz mit Schreibrecht
                </Typography.Text>
              ) : (
                <Select<number>
                  aria-label="Laufender Einsatz"
                  placeholder="Einsatz wählen"
                  value={einsatzId ?? undefined}
                  onChange={(id) => changeZiel('einsatz', null, id)}
                  disabled={laeuft}
                  options={laufende.map((e) => ({
                    value: e.id,
                    label: [e.einsatznummer_intern, e.bezeichnung].filter(Boolean).join(' · '),
                  }))}
                  style={{ flex: '1 1 14rem', minWidth: 0 }}
                />
              )}
            </Flex>
            {art === 'neu' && (
              <Typography.Text type="secondary" data-lfh="uebernahme-neu-hinweis">
                Neuer Einsatz: {neuerEinsatzText(planung)}
              </Typography.Text>
            )}
            <SpeicherFehler fehler={vorschauMut.error} titel="Keine Vorschau" />
            <SpeicherFehler fehler={uebernehmenMut.error} titel="Nicht übernommen" />
            {vorschauMut.isPending && vorschau == null && <Spin />}
            {vorschau != null && (
              <Spin spinning={vorschauMut.isPending}>
                <ImportVorschauAnsicht
                  vorschau={vorschau}
                  wahl={wahl}
                  gesperrt={laeuft}
                  onWahl={changeWahl}
                />
              </Spin>
            )}
          </Flex>
        )}
      </div>
    </Modal>
  );
}
