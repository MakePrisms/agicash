import type { Event } from 'nostr-tools';
import { Badge } from '~/components/ui/badge';
import { cn } from '~/lib/utils';

type EventRendererProps = {
  event: Event;
  className?: string;
};

type ProfileMetadata = {
  name?: string;
  about?: string;
  picture?: string;
  [key: string]: unknown;
};

/**
 * Renders a profile metadata event (kind 0)
 */
function ProfileEventRenderer({ event, className }: EventRendererProps) {
  let metadata: ProfileMetadata = {};
  try {
    metadata = JSON.parse(event.content) as ProfileMetadata;
  } catch {
    // Invalid JSON, use empty object
  }

  return (
    <div className={cn('flex space-x-3 p-3', className)}>
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground text-sm">
          👤
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-sm">Profile Update</span>
          <Badge variant="secondary" className="text-xs">
            Kind {event.kind}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {new Date(event.created_at * 1000).toLocaleTimeString()}
          </span>
        </div>
        <div className="space-y-1 text-sm">
          {metadata.name && (
            <div>
              <span className="text-muted-foreground">Name: </span>
              <span className="font-medium">{metadata.name}</span>
            </div>
          )}
          {metadata.about && (
            <div>
              <span className="text-muted-foreground">About: </span>
              <span>{metadata.about.substring(0, 100)}...</span>
            </div>
          )}
          <div className="text-muted-foreground text-xs">
            From: {event.pubkey.substring(0, 16)}...
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a text note event (kind 1)
 */
function TextNoteEventRenderer({ event, className }: EventRendererProps) {
  return (
    <div className={cn('flex space-x-3 p-3', className)}>
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 font-medium text-sm text-white">
          💬
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-sm">
            {event.pubkey.substring(0, 8)}...
          </span>
          <Badge className="text-xs">Kind {event.kind}</Badge>
          <span className="text-muted-foreground text-xs">
            {new Date(event.created_at * 1000).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-sm leading-relaxed">{event.content}</div>
        {event.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {event.tags.slice(0, 3).map((tag) => (
              <Badge
                key={`${tag[0]}-${tag[1]}`}
                variant="outline"
                className="text-xs"
              >
                {tag[0]}: {tag[1]?.substring(0, 8)}...
              </Badge>
            ))}
            {event.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{event.tags.length - 3} more
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a contacts list event (kind 3)
 */
function ContactsEventRenderer({ event, className }: EventRendererProps) {
  const contactCount = event.tags.filter((tag) => tag[0] === 'p').length;

  return (
    <div className={cn('flex space-x-3 p-3', className)}>
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 font-medium text-sm text-white">
          👥
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-sm">Contacts List</span>
          <Badge variant="secondary" className="text-xs">
            Kind {event.kind}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {new Date(event.created_at * 1000).toLocaleTimeString()}
          </span>
        </div>
        <div className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Following: </span>
            <span className="font-medium">{contactCount} users</span>
          </div>
          {event.content && (
            <div>
              <span className="text-muted-foreground">Description: </span>
              <span>{event.content.substring(0, 100)}</span>
            </div>
          )}
          <div className="text-muted-foreground text-xs">
            From: {event.pubkey.substring(0, 16)}...
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a direct message event (kind 4)
 */
function DirectMessageEventRenderer({ event, className }: EventRendererProps) {
  return (
    <div
      className={cn('flex space-x-3 rounded-lg bg-accent/20 p-3', className)}
    >
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 font-medium text-sm text-white">
          🔒
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-sm">Direct Message</span>
          <Badge variant="destructive" className="text-xs">
            Kind {event.kind}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {new Date(event.created_at * 1000).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-muted-foreground text-sm italic">
          [Encrypted content - {event.content.length} characters]
        </div>
        <div className="text-muted-foreground text-xs">
          From: {event.pubkey.substring(0, 16)}...
        </div>
      </div>
    </div>
  );
}

/**
 * Renders any other event kind with a generic layout
 */
function GenericEventRenderer({ event, className }: EventRendererProps) {
  return (
    <div className={cn('flex space-x-3 p-3', className)}>
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm">
          📦
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-sm">Event</span>
          <Badge variant="outline" className="text-xs">
            Kind {event.kind}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {new Date(event.created_at * 1000).toLocaleTimeString()}
          </span>
        </div>
        <div className="space-y-1 text-sm">
          {event.content && (
            <div className="break-words leading-relaxed">
              {event.content.substring(0, 200)}
              {event.content.length > 200 && '...'}
            </div>
          )}
          {event.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {event.tags.slice(0, 5).map((tag) => (
                <Badge
                  key={`${tag[0]}-${tag[1]}`}
                  variant="outline"
                  className="text-xs"
                >
                  {tag[0]}: {tag[1]?.substring(0, 12)}...
                </Badge>
              ))}
              {event.tags.length > 5 && (
                <Badge variant="outline" className="text-xs">
                  +{event.tags.length - 5} more
                </Badge>
              )}
            </div>
          )}
          <div className="text-muted-foreground text-xs">
            Author: {event.pubkey.substring(0, 16)}...
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a location-based chat event (kind 20000)
 */
function LocationChatEventRenderer({ event, className }: EventRendererProps) {
  return (
    <div className={cn('', className)}>
      <span className="select-text text-base leading-relaxed sm:text-sm sm:leading-tight">
        {event.content}
      </span>
    </div>
  );
}

/**
 * Main event renderer that dispatches to the appropriate renderer based on kind
 */
export function EventRenderer({ event, className }: EventRendererProps) {
  switch (event.kind) {
    case 0:
      return <ProfileEventRenderer event={event} className={className} />;
    case 1:
      return <TextNoteEventRenderer event={event} className={className} />;
    case 3:
      return <ContactsEventRenderer event={event} className={className} />;
    case 4:
      return <DirectMessageEventRenderer event={event} className={className} />;
    case 20000:
      return <LocationChatEventRenderer event={event} className={className} />;
    default:
      return <GenericEventRenderer event={event} className={className} />;
  }
}
