export type MintBlocklistEntry = {
  mintUrl: string;
  /** If null, the entire mint is blocked */
  unit: string | null;
};

export type AgicashConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  cashuMintBlocklist: MintBlocklistEntry[];
  environment: 'local' | 'production' | 'alpha' | 'next' | 'preview';
};

let _config: AgicashConfig | null = null;

export function configure(config: AgicashConfig): void {
  _config = config;
}

export function getConfig(): AgicashConfig {
  if (!_config) throw new Error('Call configure() before using @agicash/core');
  return _config;
}
