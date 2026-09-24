/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_TOURNAMENT_V1?: string;
  readonly VITE_ENABLE_AMERICANO_V2?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
