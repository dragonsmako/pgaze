// Compile-time exhaustiveness check for discriminated unions.
// Call from a `default:` branch (or final `else`) to ensure all variants are handled.
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union variant: ${JSON.stringify(value)}`);
}
