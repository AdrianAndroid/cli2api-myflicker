export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return `${id.slice(0, 8)}…${id.slice(-2)}`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  return `${minutes}m${Math.round((ms % 60000) / 1000)}s`;
}

export function uptime(ms: number): string {
  if (!ms) return "—";
  return duration(ms);
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "执行中",
  success: "成功",
  failure: "失败",
  canceled: "已取消",
};

export const STATUS_CLASS: Record<string, string> = {
  pending: "st-pending",
  running: "st-running",
  success: "st-success",
  failure: "st-failure",
  canceled: "st-canceled",
};

/** Minimal shell-like tokenizer: supports '...' "..." and backslash escapes. */
export function tokenize(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (char === "\\" && i + 1 < input.length) {
      current += input[i + 1];
      i += 1;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasContent || current.length > 0) {
        args.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }
  if (hasContent || current.length > 0) args.push(current);
  return args;
}
