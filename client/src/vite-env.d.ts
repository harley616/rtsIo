/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_URL: string
	readonly VITE_RELAY_URL: string
	readonly VITE_TICK_MS: string
	readonly VITE_DT: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
