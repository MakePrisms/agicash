// The public `Database` is the AUGMENTED one from ./database (adds wallet RPC
// return/composite types over the generated schema). The generated `Database`
// stays internal to ./database, so we re-export the generated helper types
// WITHOUT it to avoid a name clash.
export * from './database';
export type {
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from './database.types';
export { Constants } from './database.types';
