import deployed from '../deployed.json'

export interface DeployedConfig {
  /** DBC config account on mainnet */
  config: string
  /** wallet that collects the preset author's pool-creation fee and trading-fee share */
  feeClaimer: string
  signature: string
}

const registry = deployed as Record<string, DeployedConfig>

/** The official config for a preset, written by scripts/deploy-configs.ts. */
export function deployedConfig(presetId: string): DeployedConfig | undefined {
  return registry[presetId]
}
