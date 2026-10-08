import { sha256 as hashSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Json } from './types.js';

export function jsonSafe(value: unknown): Json {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value instanceof Uint8Array) return `0x${bytesToHex(value)}`;
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), jsonSafe(item)]));
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return String(value);
}
export function canonicalJson(value: unknown): string {
  const safe = jsonSafe(value);
  function sort(item: Json): Json {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]));
    return item;
  }
  return JSON.stringify(sort(safe));
}
export const sha256 = (value: string | Uint8Array): string => bytesToHex(hashSha256(typeof value === 'string' ? new TextEncoder().encode(value) : value));
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function name(value: unknown): string {
  return typeof value === 'string' ? value.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[ -]/g, '_').toUpperCase() : '';
}
