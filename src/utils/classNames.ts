export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const v of inputs) {
    if (!v) continue;
    if (Array.isArray(v)) {
      const sub = cn(...v);
      if (sub) out.push(sub);
    } else {
      out.push(String(v));
    }
  }
  return out.join(' ');
}
