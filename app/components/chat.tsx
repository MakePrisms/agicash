import { type Token, getEncodedToken } from '@cashu/cashu-ts';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { tokenToMoney } from '~/features/shared/cashu';
import { getDefaultUnit } from '~/features/shared/currencies';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';
import { MentionDropdown } from './mention-dropdown';
import { MoneyDisplay } from './money-display';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Textarea } from './ui/textarea';

export type ChatMessage = {
  id: string;
  username: string;
  content: string;
  pubkey: string;
  token?: Token | null;
};

type ChatFormData = {
  message: string;
};

type ChatProps = {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  placeholder?: string;
  className?: string;
};

// Constants for scroll behavior
const NEAR_BOTTOM_THRESHOLD = 100;
const SCROLL_INDICATOR_THRESHOLD = 200;

/**
 * Generate a consistent bright color from a pubkey hex string
 */
function generateColorFromPubkey(pubkey: string): string {
  // Simple hash function to better distribute colors
  let hash = 0;
  for (let i = 0; i < Math.min(pubkey.length, 16); i++) {
    const char = pubkey.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Make hash positive and generate hue with better distribution
  hash = Math.abs(hash);
  const hue = hash % 360;

  // Use different parts of the hash for saturation and lightness
  const saturation = 75 + ((hash >> 8) % 16); // 75-90%
  const lightness = 50 + ((hash >> 16) % 16); // 50-65%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * A clean and simple chat interface that works well on mobile and desktop.
 * Features auto-scroll to bottom, mobile-responsive input, and smooth UX.
 */
export function Chat({
  messages,
  onSendMessage,
  placeholder = 'Type a message...',
  className,
}: ChatProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { isSubmitting },
  } = useForm<ChatFormData>({
    defaultValues: { message: '' },
  });

  const { ref, ...messageRegister } = register('message', {
    required: false,
  });

  /**
   * Scroll to the bottom of the chat
   */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  /**
   * Check if the user is at the bottom of the chat and update state accordingly
   */
  const handleScroll = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    );
    if (!viewport) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;

    const atBottom =
      scrollTop + clientHeight >= scrollHeight - NEAR_BOTTOM_THRESHOLD;
    const farFromBottom =
      scrollTop + clientHeight < scrollHeight - SCROLL_INDICATOR_THRESHOLD;

    setIsAtBottom(atBottom);
    setShowScrollToBottom(farFromBottom && messages.length > 0);
  }, [messages.length]);

  /**
   * Auto-scroll to bottom when messages change if user is at bottom
   */
  useEffect(() => {
    if (isAtBottom && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, isAtBottom, scrollToBottom]);

  /**
   * Handle mentioning a user by prepending their mention to the message
   */
  const handleMention = useCallback(
    (username: string, pubkey: string) => {
      const mention = `@${username}#${pubkey.slice(0, 4)} `;
      setValue('message', mention);
      inputRef.current?.focus();
      // Move cursor to end of input
      setTimeout(() => {
        const input = inputRef.current;
        if (input) {
          input.setSelectionRange(mention.length, mention.length);
        }
      }, 0);
    },
    [setValue],
  );

  /**
   * Handle form submission and input management
   */
  const onSubmit = async (data: ChatFormData) => {
    const trimmedMessage = data.message?.trim();
    if (!trimmedMessage) return;

    await onSendMessage(trimmedMessage);
    reset();
    // Refocus input after sending message
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  /**
   * Auto-focus input when component mounts
   */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* Messages Area */}
      <div className="relative flex-1 overflow-hidden">
        <ScrollArea
          ref={scrollAreaRef}
          className="h-full"
          onScrollCapture={handleScroll}
        >
          <div className="flex flex-col gap-3 p-4">
            {messages.map((message) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                onMention={handleMention}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Scroll to Bottom Indicator */}
        {showScrollToBottom && (
          <div className="absolute right-4 bottom-4">
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 rounded-full shadow-lg"
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="pt-4">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex items-end gap-2"
        >
          <Textarea
            {...messageRegister}
            ref={(e) => {
              ref(e);
              inputRef.current = e;
            }}
            placeholder={placeholder}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-0 py-2 text-base focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
            autoComplete="off"
            disabled={isSubmitting}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(onSubmit)();
              }
            }}
          />
        </form>
      </div>
    </div>
  );
}

type ChatMessageItemProps = {
  message: ChatMessage;
  onMention: (username: string, pubkey: string) => void;
};

/**
 * Individual chat message component with colored username and content
 */
function ChatMessageItem({
  message: { content, token, pubkey, username },
  onMention,
}: ChatMessageItemProps) {
  const navigate = useNavigateWithViewTransition();
  const usernameColor = generateColorFromPubkey(pubkey);

  const handleClaimToken = (token: Token) => {
    const encodedToken = getEncodedToken(token);
    const hash = `#${encodedToken}`;

    // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      { pathname: '/receive/cashu/token', hash },
      {
        transition: 'slideUp',
        applyTo: 'newView',
      },
    );
  };

  return (
    <div className="mb-1">
      <div className="mb-1">
        <MentionDropdown
          username={username}
          pubkey={pubkey}
          onMention={onMention}
        >
          <button
            type="button"
            className="cursor-pointer font-semibold text-sm hover:underline focus-visible:outline-none"
            style={{ color: usernameColor }}
          >
            {username}
          </button>
        </MentionDropdown>
      </div>
      <div className="overflow-hidden break-words text-sm leading-relaxed">
        {token && (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <span className="text-muted-foreground text-xs">
                Cashu Token:
              </span>
              <MoneyDisplay
                money={tokenToMoney(token)}
                unit={getDefaultUnit(tokenToMoney(token).currency)}
                variant="secondary"
                className="text-sm"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleClaimToken(token)}
              className="h-6 flex-shrink-0 px-2 py-1 text-xs"
            >
              Claim
            </Button>
          </div>
        )}
        {content && (
          <div className="overflow-wrap-anywhere break-all">{content}</div>
        )}
      </div>
    </div>
  );
}
