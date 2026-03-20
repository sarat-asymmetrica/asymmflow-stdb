export function asPositiveBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value <= 0n) throw new Error(`${fieldName} must be greater than zero`);
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${fieldName} must be a positive integer`);
    return BigInt(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) throw new Error(`${fieldName} must be a positive integer`);
    const parsed = BigInt(trimmed);
    if (parsed <= 0n) throw new Error(`${fieldName} must be greater than zero`);
    return parsed;
  }

  throw new Error(`${fieldName} must be a positive integer`);
}

export function parseJsonArray(items: unknown, fieldName = 'items'): Array<Record<string, unknown>> {
  if (Array.isArray(items)) return items as Array<Record<string, unknown>>;
  if (typeof items !== 'string' || items.trim() === '') {
    throw new Error(`${fieldName} is required and must be a JSON array`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(items);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must decode to an array`);
  }

  return parsed as Array<Record<string, unknown>>;
}
