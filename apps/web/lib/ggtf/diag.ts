// Sends diagnostics to /api/diag when the app runs on localhost. Never throws.
export function diag(kind: string, data: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    const body = JSON.stringify({ kind, tab: tabId(), ...data });
    fetch("/api/diag", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {}
}

let id: string | null = null;
function tabId() {
  return (id ??= Math.random().toString(36).slice(2, 6));
}

let installed = false;
export function installDiagHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  diag("page", { href: location.href, ua: navigator.userAgent, secure: window.isSecureContext, hasMedia: !!navigator.mediaDevices, hasWorklet: typeof AudioWorkletNode !== "undefined" });
  window.addEventListener("error", (e) => diag("error", { message: e.message, src: e.filename, line: e.lineno }));
  window.addEventListener("unhandledrejection", (e) => diag("rejection", { message: String((e.reason as Error)?.message ?? e.reason) }));
}
