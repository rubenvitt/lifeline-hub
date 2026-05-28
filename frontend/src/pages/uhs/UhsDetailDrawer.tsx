import { Drawer } from 'antd';

interface Props {
  einsatzId: number;
  uhsId: number;
  schreibgeschuetzt: boolean;
  onClose: () => void;
}

/** Stub — volle Implementierung in Task 17/18 (Grundriss + Material + Bewegungen). */
export default function UhsDetailDrawer({ onClose }: Props) {
  return <Drawer title="UHS-Detail" open onClose={onClose} width={720} />;
}
