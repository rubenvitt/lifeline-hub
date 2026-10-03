import { Input, Switch, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPage from '../components/AdminPage';
import { InlineAngabe } from '../components/InlineAngabe';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { monoStil } from '../components/instrument';
import { useAuth } from '../auth/AuthContext';
import { ladeFuehrungsfunktionen, setzeFuehrungsfunktion } from '../api/fuehrungsfunktionen';
import { globalKeys } from '../api/queryKeys';
import type { FuehrungsfunktionEintrag, FuehrungsfunktionUpdate } from '../api/types';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

/**
 * Verwaltung → Stammdaten → Führungsfunktionen (LFH-549).
 *
 * Der Katalog selbst ist fest (FwDV 100 Anlage 1/2); eine Organisation überschreibt nur die
 * Anzeigelabels (THW: „Versorgung (Logistik)“) und schaltet S7 PSNV ein. Liste statt Tabelle: hier
 * wird nichts verglichen (LFH-330). Das Label ist eine Inline-Angabe; leer gespeichert gilt wieder
 * das Standardlabel.
 *
 * Solange S7 aus ist, liefert der Katalog es nicht — die Zeile steht dann mit ihrem Standardlabel
 * da, damit sie sich einschalten lässt.
 */

const ART_TEXT: Record<FuehrungsfunktionEintrag['art'], string> = {
  leitung: 'Leitung',
  sachgebiet: 'Sachgebiet',
  fuehrungshilfspersonal: 'Führungshilfspersonal',
  fachberater: 'Fachberater',
};

const S7_AUS: FuehrungsfunktionEintrag = {
  funktion: 's7',
  kuerzel: 'S7',
  label: 'Psychosoziale Notfallversorgung',
  standard_label: 'Psychosoziale Notfallversorgung',
  art: 'sachgebiet',
  bezeichnung_pflicht: false,
};

/** Der Katalog mit S7 an seinem Platz, auch wenn es aus ist; `aktiv` nur für S7 bedeutsam. */
export function verwaltungsZeilen(
  katalog: readonly FuehrungsfunktionEintrag[],
): { eintrag: FuehrungsfunktionEintrag; aktiv: boolean }[] {
  const s7Aktiv = katalog.some((e) => e.funktion === 's7');
  const zeilen = katalog.map((eintrag) => ({ eintrag, aktiv: true }));
  if (!s7Aktiv) {
    const nachS6 = zeilen.findIndex((z) => z.eintrag.funktion === 's6') + 1;
    zeilen.splice(nachS6, 0, { eintrag: S7_AUS, aktiv: false });
  }
  return zeilen;
}

export default function FuehrungsfunktionenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const katalog = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
  });
  const setzen = useMutation({
    mutationFn: ({
      eintrag,
      daten,
    }: {
      eintrag: FuehrungsfunktionEintrag;
      daten: FuehrungsfunktionUpdate;
    }) => setzeFuehrungsfunktion(eintrag.funktion, daten),
    onSuccess: (neu) => qc.setQueryData(globalKeys.fuehrungsfunktionen(), neu),
  });

  return (
    <AdminPage
      titel="Führungsfunktionen"
      beschreibung="Bezeichnungen der Führungsfunktionen in Aufträgen, Erinnerungen, Führungsstellen und im Stab. Leer gespeichert gilt die Bezeichnung nach FwDV 100."
      hinweis={
        <SeitenHinweise
          fehler={setzen.error}
          rechteText={STAMMDATEN_RECHTE_TEXT}
          rechteFehlt={!istAdmin}
        />
      }
    >
      <Liste
        // Ohne `unterEbene`, die Eintragstitel sind keine Überschriften (LFH-826): eine
        // Einstellungsliste. Die Kennung benennt die Zeile, Feld und Schalter tragen eigene
        // Etiketten.
        loading={katalog.isLoading}
        dataSource={verwaltungsZeilen(katalog.data ?? [])}
        rowKey={(z) => z.eintrag.funktion}
        emptyText={katalog.isError ? 'Katalog nicht ladbar' : undefined}
        renderItem={({ eintrag, aktiv }) => {
          const kennung = eintrag.kuerzel ?? ART_TEXT[eintrag.art];
          const schalter =
            eintrag.funktion === 's7' ? (
              <Switch
                key="s7"
                checked={aktiv}
                disabled={!istAdmin || setzen.isPending}
                aria-label="S7 PSNV eingeschaltet"
                checkedChildren="an"
                unCheckedChildren="aus"
                onChange={(an) => setzen.mutate({ eintrag, daten: { aktiv: an } })}
              />
            ) : null;
          return (
            <ListenEintrag actions={schalter ? [schalter] : undefined}>
              <ListenEintragMeta
                title={
                  <span>
                    <span style={monoStil(13)}>{kennung}</span>{' '}
                    <Typography.Text type="secondary">· {ART_TEXT[eintrag.art]}</Typography.Text>
                  </span>
                }
                description={
                  aktiv ? (
                    <InlineAngabe<string>
                      etikett={`Bezeichnung ${kennung}`}
                      wert={eintrag.label}
                      anzeige={
                        eintrag.label === eintrag.standard_label
                          ? eintrag.label
                          : `${eintrag.label} (Standard: ${eintrag.standard_label})`
                      }
                      leer={() => false}
                      gleich={(a, b) => a.trim() === b.trim()}
                      darfSchreiben={istAdmin}
                      onSpeichern={(w) =>
                        setzen.mutateAsync({ eintrag, daten: { label: w.trim() || null } })
                      }
                      eingabe={({ feld, value, onChange }) => (
                        <Input
                          {...feld}
                          maxLength={60}
                          placeholder={eintrag.standard_label}
                          value={value}
                          onChange={(e) => onChange(e.target.value)}
                        />
                      )}
                    />
                  ) : (
                    <Typography.Text type="secondary">
                      {eintrag.label} — ausgeschaltet
                    </Typography.Text>
                  )
                }
              />
            </ListenEintrag>
          );
        }}
      />
    </AdminPage>
  );
}
