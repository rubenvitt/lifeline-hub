import { useState } from 'react';
import { Button, Form, Input, InputNumber } from 'antd';
import { Select } from '../../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { IconPlus } from '../../icons';
import { Feld, Paneel, Stapel, Status, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { ErfassungsModal } from '../../components/Erfassung';
import { SeitenFehler } from '../../components/SeitenZustand';
import { RechteHinweis } from '../../components/SpeicherHinweis';
import { pflicht } from '../../components/pflichtRegel';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import {
  SOFORT_ODER_NIE,
  adapterFehlerText,
  createAdapter,
  loadAdapterListe,
  type AdapterEingabe,
} from '../../api/adapter';
import { ADAPTER_NAME_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { AdapterAnzeige, AdapterArtAnzeige, AdapterFeld } from '../../api/types';
import { ANBINDUNGEN_ABRUF_MS } from './anbindungAnzeige';
import {
  adapterPath,
  adapterZustandAnzeige,
  einstellungenVon,
  einstellungsRegeln,
  isZustandSichtbar,
  speicherHinweisText,
  uebernimmAdapter,
} from './adapterAnzeige';

/** Längstes Intervall, wie `routes::adapter::INTERVALL_MAX_S`: ein Tag. */
export const INTERVALL_MAX_S = 24 * 60 * 60;

interface AnlegenWerte {
  art?: string;
  name?: string;
  intervall_s?: number | null;
  einstellungen?: Record<string, unknown>;
}

/** Ein Einstellungsfeld der Art als Formularfeld; Name und Regeln aus dem Verzeichnis. */
export function EinstellungsFeld({ feld, pfad }: { feld: AdapterFeld; pfad: (string | number)[] }) {
  const max = feld.max > 0 ? feld.max : undefined;
  return (
    <Feld label={feld.bezeichnung} name={pfad} rules={einstellungsRegeln(feld)}>
      {feld.typ === 'zahl' ? (
        <InputNumber style={{ width: '100%' }} />
      ) : (
        <Input
          maxLength={max}
          autoComplete="off"
          placeholder={feld.typ === 'url' ? 'https://' : undefined}
        />
      )}
    </Feld>
  );
}

/** Zweite Zeile eines Adapters: Art, letzter Erfolg und, wenn er etwas verlangt, der Grund. */
function nebenangaben(a: AdapterAnzeige, zeit: (w: string) => string): string {
  const teile = [a.art_bezeichnung ?? a.art];
  if (a.zustand === 'braucht_eingriff' && a.angehalten_grund) {
    teile.push(`angehalten: ${adapterFehlerText(a.angehalten_grund, a.letzter_fehler?.status)}`);
  }
  teile.push(
    a.letzter_erfolg_at ? `zuletzt erfolgreich ${zeit(a.letzter_erfolg_at)}` : 'noch nie abgerufen',
  );
  if (a.zustand === 'gestoert' && a.letzter_fehler) {
    teile.push(
      `letzter Fehler ${adapterFehlerText(a.letzter_fehler.art, a.letzter_fehler.status)} ${zeit(a.letzter_fehler.at)}`,
    );
  }
  return teile.join(' · ');
}

/**
 * Paneel „Adapter“ der Seite Anbindungen (LLH-2018, Entwurf `docs/design/2026-11-22-adapter/`):
 * Anbindungen, die der Hub selbst abruft. Nur sichtbar, wenn der Server eine Art kennt oder schon
 * Adapter bestehen; sonst gäbe es nur ein leeres Paneel (in Produktion bis zur ersten Art). Die
 * Zeile zeigt den Status nur, wenn er etwas verlangt. Anlegen nur der System-Admin, über
 * `ErfassungsModal` mit den Feldern der Art, danach Sprung in die Ansicht. Geheimnisse setzt die
 * Ansicht, nicht das Anlegen.
 */
export default function AdapterPaneel() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<AnlegenWerte>();
  const gewaehlt = Form.useWatch('art', form);

  const listeQ = useQuery({
    queryKey: globalKeys.adapter(),
    queryFn: loadAdapterListe,
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });

  const anlegen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: createAdapter,
    onSuccess: (a) => {
      uebernimmAdapter(qc, a);
      void navigate(adapterPath(a.id));
    },
  });

  const liste = listeQ.data;
  if (!liste) {
    return listeQ.isError ? (
      <Paneel titel="Adapter" koerperPolster>
        <SeitenFehler
          text="Adapter nicht ladbar"
          ursache={listeQ.error}
          onWiederholen={() => void listeQ.refetch()}
          laedt={listeQ.isFetching}
        />
      </Paneel>
    ) : null;
  }
  if (liste.arten.length === 0 && liste.adapter.length === 0) return null;

  const gesperrt = liste.gesperrt_grund ?? null;
  const zeit = (w: string) => zeitKurz(w, konv);
  const speicherText = speicherHinweisText(liste.speicher);
  const art: AdapterArtAnzeige | undefined =
    liste.arten.find((x) => x.code === gewaehlt) ?? liste.arten[0];

  const eingabe = (w: AnlegenWerte): AdapterEingabe => {
    const gewaehlteArt = liste.arten.find((x) => x.code === w.art) ?? liste.arten[0];
    return {
      art: gewaehlteArt.code,
      name: (w.name ?? '').trim(),
      einstellungen: einstellungenVon(gewaehlteArt.felder, w.einstellungen ?? {}),
      ...(w.intervall_s != null ? { intervall_s: w.intervall_s } : {}),
    };
  };

  return (
    <Paneel
      titel="Adapter"
      meta={liste.adapter.length}
      koerperPolster
      aktion={
        istAdmin &&
        liste.arten.length > 0 && (
          <Button
            icon={<IconPlus />}
            disabled={gesperrt != null}
            title={gesperrt ?? undefined}
            onClick={() => {
              anlegen.reset();
              form.setFieldsValue({
                art: liste.arten[0].code,
                intervall_s: liste.arten[0].intervall_vorschlag_s,
              });
              setOffen(true);
            }}
          >
            Adapter anlegen
          </Button>
        )
      }
    >
      <Stapel abstand="sm">
        {speicherText && (
          <div data-lfh="adapter-speicher">
            <RechteHinweis sichtbar marke="Geheimnisspeicher" text={speicherText} />
          </div>
        )}
        {listeQ.isError && (
          <SeitenFehler
            text="Stand nicht aktuell: neu laden gescheitert"
            ursache={listeQ.error}
            onWiederholen={() => void listeQ.refetch()}
            laedt={listeQ.isFetching}
          />
        )}
        <Liste<AdapterAnzeige>
          bordered
          dataSource={liste.adapter}
          rowKey={(a) => a.id}
          emptyText="Noch kein Adapter"
          renderItem={(a) => {
            const zustand = adapterZustandAnzeige(a);
            return (
              <div data-lfh="adapter-eintrag">
                <ListenEintrag>
                  <ListenEintragMeta
                    title={
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: token.marginXS,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Link to={adapterPath(a.id)}>{a.name}</Link>
                        {isZustandSichtbar(a.zustand) && (
                          <Status groesse="klein" ton={zustand.ton} wort={zustand.wort} />
                        )}
                      </span>
                    }
                    description={
                      <span style={{ color: rollen.gedaempft }}>{nebenangaben(a, zeit)}</span>
                    }
                  />
                </ListenEintrag>
              </div>
            );
          }}
        />
      </Stapel>

      <ErfassungsModal<AnlegenWerte>
        offen={offen}
        titel="Adapter anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        speicherung={anlegen}
        speicherFehlerTitel="Nicht angelegt"
        onErfassen={(w) => anlegen.mutateAsync(eingabe(w))}
        onFertig={() => setOffen(false)}
        onAbbrechen={() => setOffen(false)}
      >
        <Feld label="Art" name="art" rules={[pflicht('Art')]}>
          <Select
            options={liste.arten.map((x) => ({ value: x.code, label: x.bezeichnung }))}
            onChange={(code: string) => {
              const neu = liste.arten.find((x) => x.code === code);
              if (neu)
                form.setFieldsValue({ intervall_s: neu.intervall_vorschlag_s, einstellungen: {} });
            }}
          />
        </Feld>
        <Feld
          label="Name"
          name="name"
          rules={[
            pflicht('Name', { whitespace: true }),
            { max: ADAPTER_NAME_MAX, message: `Höchstens ${ADAPTER_NAME_MAX} Zeichen` },
          ]}
        >
          <Input
            placeholder="Alarmquelle Leitstelle"
            maxLength={ADAPTER_NAME_MAX}
            autoComplete="off"
          />
        </Feld>
        {art?.felder.map((f) => (
          <EinstellungsFeld
            key={`${art.code}-${f.name}`}
            feld={f}
            pfad={['einstellungen', f.name]}
          />
        ))}
        {art && (
          <Feld
            label="Intervall"
            name="intervall_s"
            rules={[
              pflicht('Intervall'),
              {
                type: 'number',
                min: art.intervall_min_s,
                max: INTERVALL_MAX_S,
                message: `Zwischen ${art.intervall_min_s} und ${INTERVALL_MAX_S} Sekunden`,
              },
            ]}
          >
            <InputNumber
              min={1}
              precision={0}
              addonAfter={<span style={monoStil('monoKlein')}>s</span>}
              style={{ width: '100%' }}
            />
          </Feld>
        )}
      </ErfassungsModal>
    </Paneel>
  );
}
