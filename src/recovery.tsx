import React from "react";

// After a deploy, a page that's still open asks for code files from the previous build,
// which no longer exist. Reload once (same URL) to pick up the new build instead of
// crashing. The timestamp guard stops a reload loop if the server is really down.
const RELOADED = "spoolside-reloaded-at";
export function reloadForNewVersion() {
  const last = Number(sessionStorage.getItem(RELOADED) || 0);
  if (Date.now() - last < 15000) return false;
  sessionStorage.setItem(RELOADED, String(Date.now()));
  window.location.reload();
  return true;
}
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

const staleChunk = (e: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(String((e as Error)?.message || e));

// Last line of defence: show a way back instead of a blank page.
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (staleChunk(error)) reloadForNewVersion();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash" role="alert">
        <h1>Spoolside needs a refresh</h1>
        <p>{staleChunk(this.state.error) ? "A newer version was installed while this page was open." : "Something went wrong on this page."}</p>
        <button className="primary" onClick={() => { sessionStorage.removeItem(RELOADED); window.location.reload(); }}>Reload</button>
      </div>
    );
  }
}
