// Server-only migration re-exports. Kept separate from ./temporary so that
// server-only modules (the `.server` repositories/services these pull in) never
// enter the client module graph — React Router forbids `.server` modules being
// reachable from client code.
export { LightningAddressService } from './receive/lightning-address-service';
