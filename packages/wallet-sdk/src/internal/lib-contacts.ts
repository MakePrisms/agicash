/**
 * SDK-internal contact **runtime schema** single-source re-export — Slice 4 (contacts).
 *
 * Re-exports master's `ContactSchema` + `isContact` guard from
 * `apps/web-wallet/app/features/contacts/contact.ts` (pure `zod/mini` — verified no react /
 * @tanstack) via the relative path, single-source, so the public `Contact` `z.infer` shape in
 * `types/contact.ts` can never drift from master's schema. The repository maps rows directly
 * (master does not `parse` in `toContact`), but the guard is available for callers + tests.
 *
 * @module
 */
export {
  type Contact as ContactSchemaInfer,
  isContact,
} from '../../../../apps/web-wallet/app/features/contacts/contact';
