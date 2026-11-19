"use client";
/** A page that failed to load, shown inside the workspace so the sidebar stays usable. */
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">STUDIO WORKSPACE</span><h1>This page didn&apos;t load.</h1><p>Please try again, or pick another page from the sidebar.</p><button className="button primary" onClick={reset}>Try again</button></section>;
}
