import { useState } from "react";
import { AskView } from "./components/AskView";
import { LibraryView } from "./components/LibraryView";
import { StatusPill } from "./components/StatusPill";
import { useNoteWise } from "./lib/useNoteWise";

type Tab = "ask" | "notes";

export default function App() {
  const app = useNoteWise();
  const [tab, setTab] = useState<Tab>("ask");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <h1>NoteWise</h1>
            <p>Your notes, understood. Offline.</p>
          </div>
        </div>
        <StatusPill model={app.model} onRetry={app.enableSmartSearch} />
      </header>

      <main>
        {tab === "ask" ? (
          <AskView
            ready={app.loaded}
            hasDocs={app.docs.length > 0}
            smart={app.model.state === "ready"}
            writer={app.writer}
            search={app.search}
            onAddNotes={() => setTab("notes")}
            onEnableAnswers={app.enableAnswers}
          />
        ) : (
          <LibraryView
            docs={app.docs}
            jobs={app.jobs}
            embedProgress={app.embedProgress}
            model={app.model}
            writer={app.writer}
            needsDataOk={app.needsDataOk}
            onImport={app.importFiles}
            onRemove={app.removeDoc}
            onDismissJob={app.dismissJob}
            onEnableSmart={app.enableSmartSearch}
            onEnableAnswers={app.enableAnswers}
          />
        )}
      </main>

      <nav className="tabs" aria-label="Sections">
        <button className={tab === "ask" ? "active" : ""} onClick={() => setTab("ask")} aria-current={tab === "ask"}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          Ask
        </button>
        <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")} aria-current={tab === "notes"}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5c2.7-1.2 5.3-1.2 8 .5v13c-2.7-1.7-5.3-1.7-8-.5zM20 5.5c-2.7-1.2-5.3-1.2-8 .5v13c2.7-1.7 5.3-1.7 8-.5z" />
          </svg>
          My notes{app.docs.length ? ` (${app.docs.length})` : ""}
        </button>
      </nav>
    </div>
  );
}
