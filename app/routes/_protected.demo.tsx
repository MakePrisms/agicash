// import { hexToBytes } from '@noble/hashes/utils';
// import { mapEventsToStore } from 'applesauce-core';
// import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
// import { ProfileModel, TimelineModel } from 'applesauce-core/models';
// import { useEventStore, useObservableMemo } from 'applesauce-react/hooks';
// import { RelayPool, onlyEvents } from 'applesauce-relay';
// import type { Filter, NostrEvent } from 'nostr-tools';
// import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
// import { useEffect, useRef, useState } from 'react';
// import { useLocalStorage } from 'usehooks-ts';
// import { Page } from '~/components/page';
// import { Badge } from '~/components/ui/badge';
// import { Button } from '~/components/ui/button';
// import { Input } from '~/components/ui/input';
// import { DMDialog, EventRenderer } from '~/features/nostr';
// import { findClosestRelays, parseRelaysCsv } from '~/lib/geohash';

// // RelayPool instance - will be recreated when switching relays
// let pool = new RelayPool();

// // CSV data will be loaded dynamically

// function NoteCard({
//   note,
//   relayUrls,
//   privateKey,
// }: { note: NostrEvent; relayUrls: string[]; privateKey: string }) {
//   const eventStore = useEventStore();
//   const [isDMDialogOpen, setIsDMDialogOpen] = useState(false);

//   const profile = useObservableMemo(
//     () => eventStore.model(ProfileModel, note.pubkey),
//     [note.pubkey],
//   );

//   // For kind 20000 events, use the 'n' tag name if available, otherwise use profile name
//   const nTagName =
//     note.kind === 20000 ? note.tags.find((tag) => tag[0] === 'n')?.[1] : null;
//   const name =
//     nTagName || getDisplayName(profile, `${note.pubkey.slice(0, 8)}...`);
//   const avatar = getProfilePicture(
//     profile,
//     `https://robohash.org/${note.pubkey}.png`,
//   );

//   // Extract geohash for kind 20000 events
//   const geohash =
//     note.kind === 20000 ? note.tags.find((tag) => tag[0] === 'g')?.[1] : null;

//   const handleUsernameClick = () => {
//     setIsDMDialogOpen(true);
//   };

//   return (
//     <>
//       <div className="flex gap-3 px-3 py-2 hover:bg-gray-50 active:bg-gray-100 sm:gap-2 sm:px-2 sm:py-1 dark:active:bg-gray-700 dark:hover:bg-gray-800/50">
//         <img
//           src={avatar}
//           alt={name}
//           className="mt-1 h-8 w-8 flex-shrink-0 rounded-full sm:mt-0.5 sm:h-6 sm:w-6"
//         />
//         <div className="min-w-0 flex-1">
//           <div className="mb-1 flex items-start gap-2 sm:items-center">
//             <button
//               type="button"
//               onClick={handleUsernameClick}
//               className="cursor-pointer truncate text-left font-medium text-base leading-tight transition-colors hover:text-blue-600 sm:text-sm dark:hover:text-blue-400"
//             >
//               {name}
//             </button>
//             <div className="mt-0.5 flex flex-shrink-0 items-center gap-1 sm:mt-0">
//               {geohash && (
//                 <Badge
//                   variant="outline"
//                   className="px-1.5 py-0.5 text-xs sm:px-1 sm:py-0"
//                 >
//                   📍 {geohash.substring(0, 6)}
//                 </Badge>
//               )}
//               <span className="text-gray-400 text-xs">
//                 {new Date(note.created_at * 1000).toLocaleTimeString([], {
//                   hour: '2-digit',
//                   minute: '2-digit',
//                 })}
//               </span>
//             </div>
//           </div>
//           <div className="text-base leading-snug sm:text-sm sm:leading-tight">
//             <EventRenderer event={note} />
//           </div>
//         </div>
//       </div>

//       <DMDialog
//         isOpen={isDMDialogOpen}
//         onClose={() => setIsDMDialogOpen(false)}
//         recipientName={name}
//         recipientPubkey={note.pubkey}
//         relayUrls={relayUrls}
//         senderPrivateKey={privateKey}
//       />
//     </>
//   );
// }

// function LiveFeed({
//   relayUrls,
//   privateKey,
// }: { relayUrls: string[]; privateKey: string }) {
//   const eventStore = useEventStore();
//   const chatEndRef = useRef<HTMLDivElement>(null);

//   // This timeline will automatically update as new events arrive
//   const timeline = useObservableMemo(
//     () => eventStore.model(TimelineModel, { kinds: [20000] }),
//     [],
//   );

//   // Reverse the timeline so newest messages appear at bottom (chat-style)
//   const chatMessages = timeline?.slice().reverse() || [];

//   // Auto-scroll to bottom when new messages arrive
//   useEffect(() => {
//     chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   });

//   return (
//     <div className="flex h-full flex-col space-y-3 sm:space-y-4">
//       <h2 className="font-bold text-lg sm:text-xl">
//         Live Chat ({timeline?.length || 0} messages)
//       </h2>
//       <div className="flex flex-1 touch-pan-y flex-col overflow-y-auto overscroll-contain scroll-smooth rounded-lg border bg-gray-50 dark:bg-gray-900">
//         {chatMessages.map((note) => (
//           <NoteCard
//             key={note.id}
//             note={note}
//             relayUrls={relayUrls}
//             privateKey={privateKey}
//           />
//         ))}
//         {/* Invisible div for auto-scroll target */}
//         <div ref={chatEndRef} />
//       </div>
//     </div>
//   );
// }

export default function ProtectedRouteDemo() {
  return <div>Demo</div>;
}
//   const eventStore = useEventStore();
//   const [geohash, setGeohash] = useState('');
//   const [activeGeohash, setActiveGeohash] = useLocalStorage<string>(
//     'nostr-demo-active-geohash',
//     '',
//   ); // Track and persist the geohash used for filtering
//   const [relayUrls, setRelayUrls] = useState<string[]>([
//     // BitChat's default relays for better compatibility
//     'wss://relay.damus.io',
//     'wss://nos.lol',
//     'wss://relay.primal.net',
//     'wss://offchain.pub',
//     'wss://nostr21.com',
//   ]);
//   const subscriptionRef = useRef<{
//     unsubscribe: () => void;
//   } | null>(null);
//   const [relays, setRelays] = useState<
//     Array<{ url: string; lat: number; lon: number }>
//   >([]);
//   const [isClearingEvents, setIsClearingEvents] = useState(false);

//   // Chat functionality state - persist keys in localStorage
//   const [privateKey, setPrivateKey] = useLocalStorage<string>(
//     'nostr-demo-private-key',
//     '',
//   );
//   const [publicKey, setPublicKey] = useLocalStorage<string>(
//     'nostr-demo-public-key',
//     '',
//   );
//   const [message, setMessage] = useState('');
//   const [isSending, setIsSending] = useState(false);

//   // Initialize keys if they don't exist
//   useEffect(() => {
//     if (!privateKey || !publicKey) {
//       const privKeyBytes = generateSecretKey();
//       const pubKey = getPublicKey(privKeyBytes);
//       const privKeyHex = Array.from(privKeyBytes)
//         .map((b) => b.toString(16).padStart(2, '0'))
//         .join('');
//       setPrivateKey(privKeyHex);
//       setPublicKey(pubKey);
//       console.log('Generated and stored new keys for demo:', {
//         pubKey: `${pubKey.slice(0, 8)}...`,
//       });
//     } else {
//       console.log('Using existing keys from localStorage:', {
//         pubKey: `${publicKey.slice(0, 8)}...`,
//       });
//     }
//   }, [privateKey, publicKey, setPrivateKey, setPublicKey]);

//   // Initialize geohash input with persisted value
//   useEffect(() => {
//     if (activeGeohash && !geohash) {
//       setGeohash(activeGeohash);
//     }
//   }, [activeGeohash, geohash]);

//   // Load CSV data on component mount
//   useEffect(() => {
//     fetch('/data/nostr_relays.csv')
//       .then((response) => response.text())
//       .then((csvData) => {
//         const parsedRelays = parseRelaysCsv(csvData);
//         setRelays(parsedRelays);
//         console.log('Loaded', parsedRelays.length, 'relays');
//       })
//       .catch((error) => console.error('Error loading relay data:', error));
//   }, []);

//   const handleGeohashSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();
//     if (!geohash.trim() || isClearingEvents) return;

//     // Find closest relays
//     const closestRelays = findClosestRelays(geohash.trim(), relays, 5);
//     if (closestRelays.length > 0) {
//       try {
//         setIsClearingEvents(true);
//         // Clear old events from the EventStore before switching to new relays
//         console.log('Clearing old events before switching relays');
//         await clearOldEvents();

//         setRelayUrls(closestRelays);
//         setActiveGeohash(geohash.trim()); // Set the geohash for filtering
//         console.log('Found closest relays:', closestRelays);
//         console.log('Set active geohash for filtering:', geohash.trim());
//       } finally {
//         // Small delay to show the clearing feedback
//         setTimeout(() => setIsClearingEvents(false), 500);
//       }
//     }
//   };

//   // Function to prepare for relay switching
//   const clearOldEvents = async () => {
//     return new Promise<void>((resolve) => {
//       // Create a new RelayPool instance to avoid old connections
//       pool = new RelayPool();
//       console.log('Created new RelayPool for fresh connections');

//       // Allow time for cleanup to complete
//       setTimeout(resolve, 100);
//     });
//   };

//   // Function to send a chat message
//   const handleSendMessage = async (e: React.FormEvent) => {
//     e.preventDefault();
//     if (!message.trim() || isSending || !privateKey) return;

//     setIsSending(true);
//     try {
//       // Prepare event template for kind 20000 (bitchat)
//       const eventTemplate = {
//         kind: 20000,
//         content: message.trim(),
//         tags: [] as string[][],
//         created_at: Math.floor(Date.now() / 1000),
//       };

//       // Add geohash tag if active
//       if (activeGeohash) {
//         eventTemplate.tags.push(['g', activeGeohash]);
//       }

//       // Sign the event
//       const signedEvent = finalizeEvent(eventTemplate, hexToBytes(privateKey));

//       console.log('📤 Sending bitchat message:', {
//         eventId: signedEvent.id,
//         kind: signedEvent.kind,
//         content: signedEvent.content,
//         geohash: activeGeohash || 'none',
//         relays: relayUrls,
//       });

//       // Publish to relay pool
//       const publishResults = await pool.publish(relayUrls, signedEvent);

//       console.log(
//         '✅ Published message to relays:',
//         publishResults.map((result) => ({
//           ok: result.ok,
//           message: result.message,
//           from: result.from,
//         })),
//       );

//       // Clear the input
//       setMessage('');
//     } catch (error) {
//       console.error('❌ Failed to send message:', error);
//     } finally {
//       setIsSending(false);
//     }
//   };

//   useEffect(() => {
//     // Clean up previous subscription
//     subscriptionRef.current?.unsubscribe();

//     console.log('creating subscription with relays:', relayUrls);
//     console.log('filtering by geohash:', activeGeohash || 'none');

//     // Build the subscription filter for bitchat
//     const filter: Filter = { kinds: [20000] };
//     // Add geohash filter if one is active
//     if (activeGeohash) {
//       filter['#g'] = [activeGeohash];
//     }

//     // Start subscription when component mounts or relay URLs change
//     const newSubscription = pool
//       .group(relayUrls)
//       .subscription(filter)
//       .pipe(
//         // Filter out non-event messages (EOSE, NOTICE, etc.)
//         onlyEvents(),
//         // Add events to the EventStore and deduplicate them
//         mapEventsToStore(eventStore),
//       )
//       .subscribe({
//         error: (err) => console.error('Relay error:', err),
//         complete: () => console.log('Subscription complete'),
//       });

//     // Add subscription for gift wrap events tagged with our public key
//     let giftWrapSubscription: { unsubscribe: () => void } | null = null;
//     if (publicKey) {
//       const giftWrapFilter: Filter = {
//         kinds: [1059], // Gift wrap events for NIP-17 DMs
//         '#p': [publicKey],
//       };

//       giftWrapSubscription = pool
//         .group(relayUrls)
//         .subscription(giftWrapFilter)
//         .pipe(onlyEvents())
//         .subscribe({
//           next: (event) => {
//             console.log('🎁 Received gift wrap event for DM:', {
//               id: event.id,
//               kind: event.kind,
//               pubkey: event.pubkey,
//               created_at: event.created_at,
//               tags: event.tags,
//               contentLength: event.content.length,
//             });
//             // TODO: Decrypt and process the DM content
//           },
//           error: (err) => console.error('Gift wrap subscription error:', err),
//           complete: () => console.log('Gift wrap subscription complete'),
//         });
//     }

//     subscriptionRef.current = newSubscription;

//     // Cleanup subscription on unmount
//     return () => {
//       newSubscription.unsubscribe();
//       giftWrapSubscription?.unsubscribe();
//     };
//   }, [eventStore, relayUrls, activeGeohash, publicKey]);

//   return (
//     <Page>
//       <div className="flex h-full max-w-4xl flex-grow flex-col gap-3 overflow-hidden p-3 sm:gap-2 sm:p-2">
//         <div className="mx-auto flex h-full max-w-4xl flex-col">
//           <h1 className="mb-4 font-bold text-xl sm:mb-6 sm:text-2xl">
//             Live Nostr Feed
//           </h1>

//           {/* Geohash Input Form */}
//           <form
//             onSubmit={handleGeohashSubmit}
//             className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:gap-2"
//           >
//             <Input
//               type="text"
//               placeholder="Enter geohash (e.g., 9q8yy)"
//               value={geohash}
//               onChange={(e) => setGeohash(e.target.value)}
//               className="min-h-[44px] flex-1 text-base sm:min-h-[36px] sm:text-sm"
//             />
//             <Button
//               type="submit"
//               disabled={isClearingEvents}
//               className="min-h-[44px] text-base sm:min-h-[36px] sm:text-sm"
//             >
//               {isClearingEvents ? 'Clearing Events...' : 'Find Relays'}
//             </Button>
//           </form>

//           {/* Current Relays Display */}
//           <div className="mb-4">
//             <h3 className="font-semibold text-gray-600 text-sm dark:text-gray-400">
//               Current Relays ({relayUrls.length}):
//             </h3>
//             <div className="mt-1 space-y-1 text-gray-500 text-xs">
//               {relayUrls.map((url, index) => (
//                 <div key={url}>
//                   {index + 1}. {url}
//                 </div>
//               ))}
//             </div>
//             {activeGeohash && (
//               <div className="mt-2 flex items-center gap-2">
//                 <span className="font-semibold text-gray-600 text-sm dark:text-gray-400">
//                   Filtering by geohash:
//                 </span>
//                 <span className="font-mono text-blue-600 text-sm dark:text-blue-400">
//                   {activeGeohash}
//                 </span>
//                 <Button
//                   variant="outline"
//                   size="sm"
//                   onClick={() => setActiveGeohash('')}
//                   className="h-8 min-w-[44px] px-3 text-xs sm:h-6 sm:min-w-auto sm:px-2"
//                 >
//                   Clear Filter
//                 </Button>
//               </div>
//             )}
//           </div>

//           <div className="flex-1 overflow-hidden">
//             <LiveFeed relayUrls={relayUrls} privateKey={privateKey} />
//           </div>

//           {/* Chat Input */}
//           {privateKey && (
//             <div className="border-t bg-white pt-3 dark:border-gray-800 dark:bg-gray-950">
//               <form onSubmit={handleSendMessage} className="flex gap-2">
//                 <Input
//                   type="text"
//                   placeholder={`Send a bitchat message${activeGeohash ? ` (📍 ${activeGeohash})` : ''}...`}
//                   value={message}
//                   onChange={(e) => setMessage(e.target.value)}
//                   disabled={isSending}
//                   className="min-h-[44px] flex-1 text-base sm:min-h-[36px] sm:text-sm"
//                 />
//                 <Button
//                   type="submit"
//                   disabled={isSending || !message.trim()}
//                   className="min-h-[44px] text-base sm:min-h-[36px] sm:text-sm"
//                 >
//                   {isSending ? 'Sending...' : 'Send'}
//                 </Button>
//               </form>
//               <div className="mt-2 text-gray-500 text-xs">
//                 Your pubkey: {publicKey.slice(0, 16)}...
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </Page>
//   );
// }
