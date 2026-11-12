// Local diagnostics sink: the /link page posts what it sees so problems can be read from disk.
// Only accepts requests from localhost; writes to <repo>/.shots/diag.log.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), "..", "..", ".shots");

export async function POST(req: Request) {
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return new Response("forbidden", { status: 403 });
  const body = (await req.text()).slice(0, 20_000);
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(join(LOG_DIR, "diag.log"), `${new Date().toISOString()} ${body}\n`);
  return new Response("ok");
}
