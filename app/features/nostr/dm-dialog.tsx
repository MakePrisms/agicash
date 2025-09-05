import { useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Label } from '~/components/ui/label';
import { useSendDirectMessage } from './dm-hooks';

type DMDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  recipientName: string;
  recipientPubkey: string;
  /** Relay URLs to send the DM to (optional) */
  relayUrls?: string[];
  /** Sender's private key (hex string) */
  senderPrivateKey: string;
};

/**
 * Dialog for composing direct messages to a specific user
 * Shows recipient info and provides input field for message composition
 */
export function DMDialog({
  isOpen,
  onClose,
  recipientName,
  recipientPubkey,
  relayUrls,
  senderPrivateKey,
}: DMDialogProps) {
  const [message, setMessage] = useState('');
  const sendDirectMessage = useSendDirectMessage(senderPrivateKey);

  const handleSend = async () => {
    if (!message.trim()) return;

    try {
      await sendDirectMessage.mutateAsync({
        recipientPubkey,
        message: message.trim(),
        options: {
          relayUrls,
        },
      });

      // Clear message and close dialog on success
      setMessage('');
      onClose();
    } catch (error) {
      // Error handling is done by the mutation hook
      console.error('Failed to send DM:', error);
    }
  };

  const handleClose = () => {
    setMessage('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Direct Message</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient Info */}
          <div className="space-y-2">
            <Label className="font-medium text-sm">Recipient</Label>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 font-medium text-sm text-white">
                💬
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{recipientName}</div>
                <div className="break-all font-mono text-muted-foreground text-xs">
                  {recipientPubkey}
                </div>
              </div>
            </div>
          </div>

          {/* Message Input */}
          <div className="space-y-2">
            <Label htmlFor="dm-message" className="font-medium text-sm">
              Message
            </Label>
            <textarea
              id="dm-message"
              className="flex min-h-[80px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {/* Info Badge */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              🔒 End-to-end encrypted
            </Badge>
            <span className="text-muted-foreground text-xs">
              Encrypted with NIP-17
            </span>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleSend}
            disabled={!message.trim() || sendDirectMessage.isPending}
            className="min-w-[80px]"
          >
            {sendDirectMessage.isPending ? 'Sending...' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
