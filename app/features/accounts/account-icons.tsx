import { LandmarkIcon, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { SparkIcon as SparkSvg } from '~/components/spark-icon';
import type { AccountType } from './account';

const CashuIcon = () => <LandmarkIcon className="h-4 w-4" />;
const NWCIcon = () => <Zap className="h-4 w-4" />;
const SparkIcon = () => (
  <div className="flex h-4 w-4 items-center justify-center">
    <SparkSvg className="h-3 w-3" />
  </div>
);

const iconsByAccountType: Record<AccountType, ReactNode> = {
  cashu: <CashuIcon />,
  nwc: <NWCIcon />,
  spark: <SparkIcon />,
};

export function AccountTypeIcon({ type }: { type: AccountType }) {
  return iconsByAccountType[type];
}
