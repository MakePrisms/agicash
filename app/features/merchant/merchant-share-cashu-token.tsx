import { Copy } from 'lucide-react';
import { useState } from 'react';
import { useCopyToClipboard } from 'usehooks-ts';
import { MoneyInputDisplay } from '~/components/money-display';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Separator } from '~/components/ui/separator';
import useLocationData from '~/hooks/use-location';
import { useToast } from '~/hooks/use-toast';
import { LinkWithViewTransition } from '~/lib/transitions';
import type { CashuSendSwap } from '../send/cashu-send-swap';
import { getDefaultUnit } from '../shared/currencies';
import { useMerchantStore } from './merchant-provider';

type Props = {
  tokenHash: string;
  cardCode?: string;
  privateKey: string;
  swap: CashuSendSwap;
};

/**
 * Custom component for merchant created tokens
 * Shows copyable link with tokenHash for secure token retrieval
 */
export function MerchantShareCashuToken({
  tokenHash,
  cardCode,
  privateKey,
  swap,
}: Props) {
  const { toast } = useToast();
  const { origin } = useLocationData();
  const [, copyToClipboard] = useCopyToClipboard();
  const [linkCopied, setLinkCopied] = useState(false);
  const resetMerchantStore = useMerchantStore((s) => s.reset);

  const shareableLink = `${origin}/locked-token/${tokenHash}#unlockingKey=${privateKey}`;
  const shortShareableLink = `${origin}/locked-token/${tokenHash.slice(0, 8)}...${tokenHash.slice(-8)}&unlockingKey=${privateKey.slice(0, 20)}...${privateKey.slice(-4)}`;

  const handleCopyLink = () => {
    copyToClipboard(shareableLink);
    setLinkCopied(true);
    toast({
      title: 'Link copied to clipboard',
      description: 'Share this link to send the payment',
      duration: 2000,
    });
  };

  const unit = getDefaultUnit(swap.totalAmount.currency);

  return (
    <Page>
      <PageHeader className="z-10">
        <ClosePageButton
          to="/merchant"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Success</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4">
        <div className="flex h-[124px] flex-col items-center gap-2">
          <MoneyInputDisplay
            inputValue={swap.totalAmount.toString(unit)}
            currency={swap.totalAmount.currency}
            unit={unit}
          />
        </div>
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <Card className="m-4 mt-12 w-full sm:mt-0">
            <CardContent className="flex flex-col gap-6 pt-6">
              {/* Payment Details - Minimal */}
              {cardCode && (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Card Code</span>
                      <span className="font-mono text-muted-foreground">
                        {cardCode}
                      </span>
                    </div>
                  </div>

                  <Separator className="opacity-30" />
                </>
              )}

              {/* Gift Link Section - Main CTA */}
              <div className="space-y-4">
                <div className="text-center">
                  <h3 className="mb-2 font-medium text-lg">Share Gift Link</h3>
                  <p className="text-muted-foreground text-sm">
                    Send this link to complete the payment
                  </p>
                </div>
                <div className="break-all rounded-md bg-muted p-3 text-center font-mono text-xs">
                  {shortShareableLink}
                </div>
                <Button onClick={handleCopyLink} size="lg" className="w-full">
                  <Copy className="mr-2 h-5 w-5" />
                  Copy Gift Link
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContent>

      {linkCopied && (
        <PageFooter className="pb-14">
          <Button asChild className="w-full">
            <LinkWithViewTransition
              to="/merchant"
              transition="slideRight"
              applyTo="oldView"
              onClick={resetMerchantStore}
            >
              Create Another Payment
            </LinkWithViewTransition>
          </Button>
        </PageFooter>
      )}
    </Page>
  );
}
