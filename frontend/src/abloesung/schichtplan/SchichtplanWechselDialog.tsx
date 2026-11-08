import { Alert, Button, Checkbox, Flex, Form, Popconfirm, Spin, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { einsatzKeys } from '../../api/queryKeys';
import {
  fetchSchichtplanWechsel,
  nimmSchichtplanWechselZurueck,
  vollzieheSchichtplanWechsel,
} from '../../api/schichtplan';
import type {
  SchichtplanPersonEingabe,
  SchichtplanWechsel,
  SchichtplanWechselArt,
  SchichtplanWechselBody,
  SchichtplanWechselPerson,
} from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitpunkt } from '../../anzeige/zeitDarstellung';
import { ErfassungsModal } from '../../components/Erfassung';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { eingabeSchluessel } from './schichtplanZeilen';

/**
 * Wechsel aus dem Plan an einer UHS oder in der Pause (LLH-1555, design.md D6/D7). Vorbelegt vom
 * Server: an der UHS kommt, wer im Block steht und nicht dort ist, und geht, wer dort ist und nicht
 * im Block steht; beide Listen lassen sich abwählen. Die Pause zeigt nur, wen sie betrifft.
 * Vollzogene Wechsel des Blocks stehen darunter mit „Zurücknehmen“.
 *
 * Die Vorlage wird je Öffnen frisch gelesen (`gcTime: 0`, wie der Vollzug laut Plan), der Knopf
 * wartet auf sie.
 */

interface WechselWerte {
  kommen: string[];
  gehen: number[];
}

interface SchichtplanWechselDialogProps {
  einsatzId: number;
  blockId: number;
  onSchliessen: () => void;
}

const ART_WORT: Record<SchichtplanWechselArt, string> = {
  uhs: 'Wechsel',
  pause_beginn: 'Pause begonnen',
  pause_ende: 'Pause beendet',
};

const KNOPF: Record<SchichtplanWechselArt, string> = {
  uhs: 'Wechsel vollziehen',
  pause_beginn: 'Pause beginnen',
  pause_ende: 'Pause beenden',
};

/** Die Person der Vorlage als Eingabe des Plans; eine Kraft nur an der UHS hat keine. */
function eingabe(p: SchichtplanWechselPerson): SchichtplanPersonEingabe | null {
  if (p.art === 'stamm' && p.personal_id != null)
    return { art: 'stamm', personal_id: p.personal_id };
  if (p.art === 'helfer' && p.helfer_id != null) return { art: 'helfer', helfer_id: p.helfer_id };
  if (p.art === 'einsatz' && p.einsatz_personal_id != null)
    return { art: 'einsatz', einsatz_personal_id: p.einsatz_personal_id };
  return null;
}

function kommtZusatz(p: SchichtplanWechselPerson): string {
  if (p.einsatz_personal_id == null) return ' · neu im Einsatz';
  if (p.andere_uhs) return ` · von ${p.andere_uhs}`;
  return '';
}

function Namen({ titel, personen, lfh }: { titel: string; personen: string[]; lfh: string }) {
  if (personen.length === 0) return null;
  return (
    <div data-lfh={lfh} style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ display: 'block' }}>
        {titel}
      </Typography.Text>
      <Typography.Text>{personen.join(', ')}</Typography.Text>
    </div>
  );
}

export default function SchichtplanWechselDialog({
  einsatzId,
  blockId,
  onSchliessen,
}: SchichtplanWechselDialogProps) {
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const [form] = Form.useForm<WechselWerte>();
  const vorlageQuery = useQuery({
    queryKey: einsatzKeys.schichtplanWechsel(einsatzId, blockId),
    queryFn: () => fetchSchichtplanWechsel(einsatzId, blockId),
    gcTime: 0,
  });
  const vorlage = vorlageQuery.data;
  const art = vorlage?.art ?? null;

  const kommen = useMemo(
    () =>
      (vorlage?.kommen ?? []).flatMap((p) => {
        const e = eingabe(p);
        return e ? [{ schluessel: eingabeSchluessel(e), eingabe: e, person: p }] : [];
      }),
    [vorlage],
  );
  const anfang: WechselWerte = useMemo(
    () => ({
      kommen: kommen.map((k) => k.schluessel),
      gehen: (vorlage?.gehen ?? []).flatMap((p) =>
        p.einsatz_personal_id != null ? [p.einsatz_personal_id] : [],
      ),
    }),
    [kommen, vorlage],
  );
  useEffect(() => {
    form.setFieldsValue(anfang);
  }, [form, anfang]);

  const neuLaden = () => qc.invalidateQueries({ queryKey: einsatzKeys.schichtplan(einsatzId) });
  const vollziehenMut = useMutation({
    mutationFn: (body: SchichtplanWechselBody) =>
      vollzieheSchichtplanWechsel(einsatzId, blockId, body),
    onSuccess: neuLaden,
  });
  const zurueckMut = useMutation({
    mutationFn: (w: SchichtplanWechsel) => nimmSchichtplanWechselZurueck(einsatzId, w.id),
    onSuccess: neuLaden,
  });

  const vollziehen = (w: WechselWerte) => {
    if (!art) return Promise.reject(new Error('Kein offener Wechsel'));
    if (art !== 'uhs') return vollziehenMut.mutateAsync({ art });
    const gewaehlt = new Set(w.kommen ?? []);
    return vollziehenMut.mutateAsync({
      art,
      kommen: kommen.filter((k) => gewaehlt.has(k.schluessel)).map((k) => k.eingabe),
      gehen: w.gehen ?? [],
    });
  };

  const zeit = (wert: string) => zeitpunkt(wert, konventionen);
  const titel = vorlage?.uhs ? `Wechsel UHS ${vorlage.uhs}` : 'Pause';
  const gesperrt = vorlageQuery.isFetching || !vorlage || art == null || vorlage.gesperrt != null;

  return (
    <ErfassungsModal<WechselWerte>
      offen
      titel={titel}
      form={form}
      initialValues={anfang}
      erfassenText={art ? KNOPF[art] : 'Vollzogen'}
      laeuft={vollziehenMut.isPending}
      gesperrt={gesperrt}
      speicherung={vollziehenMut}
      speicherFehlerTitel="Wechsel nicht vollzogen"
      onErfassen={vollziehen}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {vorlageQuery.isPending && <Spin />}
      {vorlageQuery.error != null && (
        <SpeicherFehler fehler={vorlageQuery.error} titel="Wechsel nicht geladen" />
      )}
      {vorlage && (
        <div data-lfh="schichtplan-wechsel">
          {art && (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              {zeit(vorlage.zeitpunkt)}
            </Typography.Text>
          )}
          {vorlage.gesperrt && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={vorlage.gesperrt}
              data-lfh="schichtplan-wechsel-gesperrt"
            />
          )}
          {art === 'uhs' && (
            <>
              {kommen.length > 0 && (
                <Form.Item<WechselWerte> name="kommen" label="Kommt">
                  <Checkbox.Group
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    options={kommen.map((k) => ({
                      value: k.schluessel,
                      label: `${k.person.name}${kommtZusatz(k.person)}`,
                    }))}
                  />
                </Form.Item>
              )}
              {vorlage.gehen.length > 0 && (
                <Form.Item<WechselWerte> name="gehen" label="Geht">
                  <Checkbox.Group
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    options={vorlage.gehen.flatMap((p) =>
                      p.einsatz_personal_id != null
                        ? [{ value: p.einsatz_personal_id, label: p.name }]
                        : [],
                    )}
                  />
                </Form.Item>
              )}
              <Namen
                titel="Bleibt"
                personen={vorlage.bleiben.map((p) => p.name)}
                lfh="schichtplan-wechsel-bleibt"
              />
            </>
          )}
          {art === 'pause_beginn' && (
            <>
              <Namen
                titel={vorlage.pause_status ? `Auf ${vorlage.pause_status}` : 'In Pause'}
                personen={vorlage.kommen.map((p) => p.name)}
                lfh="schichtplan-wechsel-pause"
              />
              <Namen
                titel="Nicht im Einsatz"
                personen={vorlage.uebersprungen.map((p) => p.name)}
                lfh="schichtplan-wechsel-uebersprungen"
              />
            </>
          )}
          {art === 'pause_ende' && (
            <>
              <Namen
                titel="Zurück"
                personen={vorlage.kommen.map((p) =>
                  p.status_zurueck ? `${p.name} → ${p.status_zurueck}` : p.name,
                )}
                lfh="schichtplan-wechsel-zurueck"
              />
              <Namen
                titel="Nicht mehr in Pause"
                personen={vorlage.uebersprungen.map((p) => p.name)}
                lfh="schichtplan-wechsel-uebersprungen"
              />
            </>
          )}
          {vorlage.wechsel.length > 0 && (
            <div data-lfh="schichtplan-wechsel-vollzogen" style={{ marginTop: 8 }}>
              <Typography.Text type="secondary" style={{ display: 'block' }}>
                Vollzogen
              </Typography.Text>
              {vorlage.wechsel.map((w) => (
                <Flex key={w.id} align="center" justify="space-between" gap={8} wrap>
                  <Typography.Text>
                    {ART_WORT[w.art]} · {zeit(w.vollzogen_at)}
                  </Typography.Text>
                  <Popconfirm
                    title="Wechsel zurücknehmen?"
                    okText="Zurücknehmen"
                    cancelText="Behalten"
                    onConfirm={() => zurueckMut.mutate(w)}
                  >
                    <Button loading={zurueckMut.isPending}>Zurücknehmen</Button>
                  </Popconfirm>
                </Flex>
              ))}
              {zurueckMut.error != null && (
                <SpeicherFehler fehler={zurueckMut.error} titel="Nicht zurückgenommen" />
              )}
            </div>
          )}
        </div>
      )}
    </ErfassungsModal>
  );
}
