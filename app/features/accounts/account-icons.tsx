import { LandmarkIcon, Sparkles, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccountType } from './account';

const CashuIcon = () => <LandmarkIcon className="h-4 w-4" />;
const NWCIcon = () => <Zap className="h-4 w-4" />;
const SparkIcon = () => <Sparkles className="h-4 w-4" />;

const iconsByAccountType: Record<AccountType, ReactNode> = {
  cashu: <CashuIcon />,
  nwc: <NWCIcon />,
  spark: <SparkIcon />,
};

export function AccountTypeIcon({ type }: { type: AccountType }) {
  return iconsByAccountType[type];
}
