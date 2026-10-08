import type { NetworkId } from './types.js';

export const NETWORKS = {
  studionet: { id: 'studionet', name: 'StudioNet', chainId: 61999, rpc: 'https://studio.genlayer.com/api', explorer: 'https://explorer-studio.genlayer.com', studio: true },
  bradbury: { id: 'bradbury', name: 'Bradbury', chainId: 4221, rpc: 'https://rpc-bradbury.genlayer.com', explorer: 'https://explorer-bradbury.genlayer.com', studio: false },
  localnet: { id: 'localnet', name: 'Localnet', chainId: 61127, rpc: 'http://localhost:4000/api', explorer: 'http://localhost:8080', studio: true },
} as const satisfies Record<NetworkId, { id: NetworkId; name: string; chainId: number; rpc: string; explorer: string; studio: boolean }>;

export const READ_METHODS = new Set(['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'gen_getTransactionReceipt', 'gen_getTransactionLifecycle', 'gen_getContractCode', 'gen_getContractSchema', 'gen_call', 'gen_dbg_traceTransaction']);
