export class ApiError extends Error {
  status: number;
  field?: string | null;
  duplicateIds?: number[];
  constructor(message: string, status: number, field?: string | null, duplicateIds?: number[]) {
    super(message);
    this.status = status;
    this.field = field;
    this.duplicateIds = duplicateIds;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    const ct = res.headers.get("content-type") || "";
    return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
  }
  let msg = `Request failed (${res.status})`;
  let field: string | null | undefined;
  let dups: number[] | undefined;
  try {
    const body = await res.json();
    const d = body.detail;
    if (typeof d === "string") msg = d;
    else if (d && typeof d === "object" && !Array.isArray(d)) {
      msg = d.message || msg;
      field = d.field;
      dups = d.duplicate_ids;
    } else if (Array.isArray(d)) msg = d.map((x: { msg: string }) => x.msg).join("; ");
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(msg, res.status, field, dups);
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Is start.bat still running on your PC?", 0);
  }
  return handle<T>(res);
}
