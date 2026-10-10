// Mainnet only: DBC configs and pools here are real.
// api.mainnet-beta.solana.com answers 403 to every browser request (any Origin header), so the site defaults to
// PublicNode's free endpoint, which allows CORS. Point VITE_RPC at a private RPC (Helius, Triton...) to override.
export const RPC: string = import.meta.env.VITE_RPC || 'https://solana-rpc.publicnode.com'
