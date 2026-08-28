export type LogLevel = "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

const secretKey = /authorization|cookie|password|secret|token/i;

export class Logger {
  constructor(private readonly sink: (line: string) => void = console.log) {}

  info(message: string, fields: LogFields = {}): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields: LogFields = {}): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields: LogFields): void {
    const safeFields = redact(fields) as Record<string, unknown>;
    this.sink(
      JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...safeFields }),
    );
  }
}

export function redact(value: unknown, key = ""): unknown {
  if (secretKey.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]),
    );
  }
  return value;
}
