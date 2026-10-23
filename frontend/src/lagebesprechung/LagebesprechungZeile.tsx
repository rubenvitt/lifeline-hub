import { Flex, Space, Typography, theme } from 'antd';
import { useUhr } from '../abloesung/useUhr';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import type { ModulFreigaben } from '../api/types';
import { SprungKnopf } from '../components/Sprung';
import StatusTag from '../components/StatusTag';
import { istSprungGesperrt } from '../einsatz/modulRegistry';
import { lagebesprechungPfad } from '../routing/deeplinks';
import { lagebesprechungZustand } from './lagebesprechungZustand';

/**
 * Kompakte Zeile „Nächste Lagebesprechung“ der Stab-Seite (LLH-1111, design.md D8): Termin und
 * Zustand mit Sprung in das Modul Lagebesprechung, das Vorbereitung, Abschluss und Verlauf trägt.
 *
 * Der Termin kommt aus dem Einsatzkopf, nicht aus dem Stand des Moduls: so sieht auch ein
 * Stab-Leser ohne Freigabe der Lagebesprechung den Termin, wie im Führungsüberblick. Der Sprung
 * steht dann gesperrt mit sichtbarem Grund da (`SprungKnopf`, LFH-888; Einstieg statt Achse,
 * LFH-456).
 */
export default function LagebesprechungZeile({
  einsatzId,
  termin,
  freigaben,
}: {
  einsatzId: number;
  termin: string | null | undefined;
  freigaben: ModulFreigaben | undefined;
}) {
  const { token } = theme.useToken();
  const jetzt = useUhr(30_000);
  const isGesperrt = istSprungGesperrt('lagebesprechung', freigaben);
  return (
    <Flex
      wrap
      align="center"
      justify="space-between"
      gap={token.marginXS}
      role="group"
      aria-label="Nächste Lagebesprechung"
      style={{ marginBottom: token.margin }}
    >
      <Space wrap>
        <Typography.Text strong>Nächste Lagebesprechung</Typography.Text>
        {termin && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            <ZeitAnzeige wert={termin} rolle="kurz" />
          </span>
        )}
        <StatusTag darstellung={lagebesprechungZustand(termin, jetzt)} />
      </Space>
      <SprungKnopf to={lagebesprechungPfad(einsatzId)} gesperrt={isGesperrt}>
        Zur Lagebesprechung
      </SprungKnopf>
    </Flex>
  );
}
