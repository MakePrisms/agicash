import type { Money } from '@agicash/money';
import type { Token } from '@cashu/cashu-ts';
import { Banknote, Link, Share } from 'lucide-react';
import { useState } from 'react';
import { useCopyToClipboard } from 'usehooks-ts';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderItem,
  PageHeaderTitle,
} from '~/components/page';
import { QRCode } from '~/components/qr-code';
import { Button } from '~/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselControls,
  CarouselItem,
} from '~/components/ui/carousel';
import useLocationData from '~/hooks/use-location';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useToast } from '~/hooks/use-toast';
import { encodeToken, normalizeMintUrl } from '@agicash/cashu';
import { canShare, shareContent } from '~/lib/share';
import { LinkWithViewTransition } from '~/lib/transitions';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';

type Props = {
  amount: Money;
  token?: Token;
};

type ShareOption = {
  value?: string;
  description: string;
  animate?: boolean;
  toast: { title: string; description?: string };
};

const deriveTokenStrings = (token: Token, origin: string) => {
  const encodedToken = encodeToken(token, { removeDleq: true });
  const mintParam = encodeURIComponent(
    normalizeMintUrl(token.mint).replace(/^https?:\/\//, ''),
  );
  const shortToken = `${encodedToken.slice(0, 6)}...${encodedToken.slice(-5)}`;
  return {
    encodedToken,
    shortToken,
    shareableLink: `${origin}/receive-cashu-token?mint=${mintParam}#${encodedToken}`,
    shortShareableLink: `${origin}/receive-cashu-token#${shortToken}`,
  };
};

export function ShareCashuToken({ amount, token }: Props) {
  const { toast } = useToast();
  const { origin } = useLocationData();
  const { redirectTo } = useRedirectTo('/');
  const [, copyToClipboard] = useCopyToClipboard();
  const [showOk, setShowOk] = useState(false);

  const strings = token ? deriveTokenStrings(token, origin) : null;

  const shareOptions: ShareOption[] = [
    {
      value: strings?.shareableLink,
      description: 'Click to copy Shareable Link',
      toast: {
        title: 'Copied Shareable Link to clipboard',
        description: strings?.shortShareableLink,
      },
    },
    {
      value: strings?.encodedToken,
      animate: true,
      description: 'Click to copy eCash Token',
      toast: {
        title: 'Copied eCash Token to clipboard',
        description: strings?.shortToken,
      },
    },
  ];

  const handleCopy = (option: ShareOption) => {
    if (!option.value) return;
    copyToClipboard(option.value);
    setShowOk(true);
    toast({ ...option.toast, duration: 1000 });
  };

  return (
    <Page>
      <PageHeader>
        <ClosePageButton
          to={redirectTo}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Send</PageHeaderTitle>
        {canShare() && (
          <PageHeaderItem position="right">
            <button
              type="button"
              onClick={() => {
                const link = shareOptions[0]?.value;
                if (link) shareContent({ url: link });
              }}
              className="flex h-6 w-6 appearance-none items-center justify-center"
            >
              <Share />
            </button>
          </PageHeaderItem>
        )}
      </PageHeader>
      <PageContent className="animate-in items-center gap-0 overflow-x-hidden overflow-y-hidden duration-300">
        <MoneyWithConvertedAmount money={amount} />
        <div className="flex w-full flex-col items-center justify-center px-4 pt-6 pb-8">
          <Carousel opts={{ align: 'center', loop: true }}>
            <CarouselContent>
              {shareOptions.map((option) => (
                <CarouselItem key={option.description}>
                  <QRCode
                    value={option.value}
                    isLoading={!option.value}
                    animate={option.animate}
                    description={option.description}
                    onClick={() => handleCopy(option)}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselControls>
              <Link className="h-5 w-5" />
              <Banknote className="h-5 w-5" />
            </CarouselControls>
          </Carousel>
        </div>
      </PageContent>
      {showOk && (
        <PageFooter className="pb-14">
          <Button asChild className="w-[80px]">
            <LinkWithViewTransition
              to={redirectTo}
              transition="slideDown"
              applyTo="oldView"
            >
              OK
            </LinkWithViewTransition>
          </Button>
        </PageFooter>
      )}
    </Page>
  );
}
