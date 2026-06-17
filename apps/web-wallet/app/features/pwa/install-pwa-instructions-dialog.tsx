import {
  House,
  type LucideIcon,
  Menu,
  MoreVertical,
  Plus,
  Share,
  SquarePlus,
} from 'lucide-react';
import icon from '~/assets/icon-192x192.png';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import useUserAgent, { type Browser } from '~/hooks/use-user-agent';

const browserInstructions: Record<Browser, InstallInstruction[]> = {
  Safari: [
    { icon: Share, text: 'Click the Share button in navigation bar' },
    { icon: SquarePlus, text: 'Scroll down to "Add to Home Screen"' },
  ],
  Chrome: [
    { icon: MoreVertical, text: 'Click the menu button' },
    { icon: SquarePlus, text: 'Scroll down to "Add to Home Screen"' },
  ],
  ChromeiOS: [
    { icon: Share, text: 'Click the Share button in search bar' },
    { icon: SquarePlus, text: 'Scroll down to "Add to Home Screen"' },
  ],
  Firefox: [
    { icon: MoreVertical, text: 'Click the menu button' },
    { icon: Plus, text: 'Click "Install"' },
  ],
  FirefoxiOS: [
    { icon: Menu, text: 'Click the menu button' },
    { icon: Share, text: 'Click "Share"' },
    { icon: SquarePlus, text: 'Scroll down to "Add to Home Screen"' },
  ],
  SamsungBrowser: [
    { icon: Menu, text: 'Click the menu button' },
    { icon: Plus, text: 'Click "Add page to"' },
    { icon: House, text: 'Click "Home screen"' },
  ],
  unknown: [
    { icon: MoreVertical, text: 'Click the menu button' },
    { icon: Plus, text: 'Look for "Add to Home Screen" option' },
  ],
};

type InstallInstruction = {
  icon: LucideIcon;
  text: string;
};

type Props = {
  showDialog: boolean;
  setShowDialog: (showDialog: boolean) => void;
  onDoNotShowAgain: () => void;
};

export default function InstallPwaInstructionsDialog({
  showDialog,
  setShowDialog,
  onDoNotShowAgain,
}: Props) {
  const { browser } = useUserAgent();
  const instructions = browserInstructions[browser];

  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="px-4 sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <img
              src={icon}
              alt="Agicash icon"
              className="h-16 w-16 rounded-lg"
            />
            <div className="flex h-full flex-col items-start justify-between">
              <DialogTitle className="text-left">Agicash</DialogTitle>
              <DialogDescription className="text-left">
                Install Agicash to your home screen for the best experience.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="my-6 flex w-full flex-col gap-4">
          {instructions.map((instruction, index) => {
            const Icon = instruction.icon;
            return (
              <div key={instruction.text} className="flex items-center gap-4">
                <Icon className="h-6 w-6 shrink-0" />
                <div className="flex items-center gap-1">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center font-medium">
                    {index + 1}.
                  </div>
                  <div>{instruction.text}</div>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onDoNotShowAgain}>
            Don't show again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
