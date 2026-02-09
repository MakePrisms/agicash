import { type Token, getEncodedToken } from '@cashu/cashu-ts';
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
import { useToast } from '~/hooks/use-toast';
import { canShare, shareContent } from '~/lib/share';
import { LinkWithViewTransition } from '~/lib/transitions';
import { tokenToMoney } from '../shared/cashu';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';

type Props = {
  token: Token;
};

export function ShareCashuToken({ token }: Props) {
  const { toast } = useToast();
  const { origin } = useLocationData();
  const [, copyToClipboard] = useCopyToClipboard();
  const amount = tokenToMoney(token);
  const [showOk, setShowOk] = useState(false);

  const encodedToken = getEncodedToken(token);
  const shareableLink = `${origin}/receive-cashu-token#${encodedToken}`;
  const shortToken = `${encodedToken.slice(0, 6)}...${encodedToken.slice(-5)}`;
  const shortShareableLink = `${origin}/receive-cashu-token#${shortToken}`;

  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Send</PageHeaderTitle>
        {canShare() && (
          <PageHeaderItem position="right">
            <button
              type="button"
              onClick={() => {
                shareContent({
                  url: shareableLink,
                });
              }}
              className="cursor-pointer"
            >
              <Share />
            </button>
          </PageHeaderItem>
        )}
      </PageHeader>
      <PageContent className="animate-in items-center gap-0 overflow-x-hidden overflow-y-hidden duration-300">
        <MoneyWithConvertedAmount money={amount} />
        <div className="flex w-full flex-col items-center justify-center px-4 py-4 pb-8">
          <Carousel opts={{ align: 'center', loop: true }}>
            <CarouselContent>
              <CarouselItem>
                <QRCode
                  value={shareableLink}
                  description="Click to copy Shareable Link"
                  onClick={() => {
                    copyToClipboard(shareableLink);
                    setShowOk(true);
                    toast({
                      title: 'Copied Shareable Link to clipboard',
                      description: shortShareableLink,
                      duration: 1000,
                    });
                  }}
                />
              </CarouselItem>
              <CarouselItem>
                <QRCode
                  value={encodedToken}
                  animate={true}
                  description="Click to copy eCash Token"
                  onClick={() => {
                    copyToClipboard(encodedToken);
                    setShowOk(true);
                    toast({
                      title: 'Copied eCash Token to clipboard',
                      description: shortToken,
                      duration: 1000,
                    });
                  }}
                />
              </CarouselItem>
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
              to="/"
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
