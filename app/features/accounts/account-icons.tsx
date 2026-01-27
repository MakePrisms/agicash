import { GiftIcon, LandmarkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SparkIcon as SparkIconSvg } from '~/components/spark-icon';
import type { Account, AccountType } from './account';

const CashuIcon = () => <LandmarkIcon className="h-4 w-4" />;
const SparkIcon = () => <SparkIconSvg className="h-4 w-4" />;
const GiftCardIcon = () => <GiftIcon className="h-4 w-4" />;

const iconsByAccountType: Record<AccountType, ReactNode> = {
  cashu: <CashuIcon />,
  spark: <SparkIcon />,
};

export function AccountIcon({ account }: { account: Account }) {
  if (account.purpose === 'gift-card') {
    return <GiftCardIcon />;
  }
  return iconsByAccountType[account.type];
}
