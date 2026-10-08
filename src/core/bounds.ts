/** Iterative guards run before recursive parsing, normalization, or redaction. */
export function assertComplexity(value: unknown, maxDepth = 64, maxNodes = 100000): void {
  const pending = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > maxNodes || item.depth > maxDepth) throw new Error('JSON is too deeply nested or complex.');
    if (item.value && typeof item.value === 'object') {
      const children = item.value instanceof Map ? [...item.value.values()] : item.value instanceof Uint8Array ? [] : Object.values(item.value);
      if (pending.length + children.length + nodes > maxNodes) throw new Error('JSON is too deeply nested or complex.');
      for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}
