import { LandmarkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SparkIcon as SparkIconSvg } from '~/components/spark-icon';
import type { AccountType } from './account';

const CashuIcon = () => <LandmarkIcon className="h-4 w-4" />;
const SparkIcon = () => (
  <div className="flex h-4 w-4 items-center justify-center">
    <SparkIconSvg className="h-3 w-3" />
  </div>
);
const iconsByAccountType: Record<AccountType, ReactNode> = {
  cashu: <CashuIcon />,
  spark: <SparkIcon />,
};

export function AccountTypeIcon({ type }: { type: AccountType }) {
  return iconsByAccountType[type];
}
