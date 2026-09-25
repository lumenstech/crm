const MASK = "[REDACTED]";

export function redactSecrets(value: string, secrets: readonly string[]): string {
  let output = value;
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join(MASK);
  }
  return output;
}

export function safeError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secrets);
}
