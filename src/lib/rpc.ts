// Mainnet only: DBC configs and pools here are real. Point VITE_RPC at a private RPC
// (Helius, Triton...) for the pool feed; the public endpoint refuses getProgramAccounts.
export const RPC: string = import.meta.env.VITE_RPC || 'https://api.mainnet-beta.solana.com'
