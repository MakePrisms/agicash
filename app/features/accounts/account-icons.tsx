import { LandmarkIcon, StarIcon, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccountType } from './account';

const CashuIcon = () => <LandmarkIcon className="h-4 w-4" />;
const NWCIcon = () => <Zap className="h-4 w-4" />;
const StarsIcon = () => <StarIcon className="h-4 w-4" />;

const iconsByAccountType: Record<AccountType | 'star', ReactNode> = {
  cashu: <CashuIcon />,
  nwc: <NWCIcon />,
  star: <StarsIcon />,
};

export function AccountTypeIcon({ type }: { type: AccountType | 'star' }) {
  return iconsByAccountType[type];
}
