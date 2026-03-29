export type AgicashConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  cashuMintBlocklist: string[];
  environment: 'local' | 'production' | 'alpha' | 'next' | 'preview';
  featureFlags?: Record<string, boolean>;
};

let _config: AgicashConfig | null = null;

export function configure(config: AgicashConfig): void {
  _config = config;
}

export function getConfig(): AgicashConfig {
  if (!_config) throw new Error('Call configure() before using @agicash/sdk');
  return _config;
}
