import type { EmbedderState } from "../lib/embedder";

/**
 * A small, informational badge. Smart search switches itself on, so there's
 * nothing for the student to manage. The only tap target is "retry" after a
 * failed download.
 */
export function StatusPill({ model, onRetry }: { model: EmbedderState; onRetry: () => void }) {
  switch (model.state) {
    case "ready":
      return (
        <span className="pill on" title={`Search by meaning is on, running on the ${model.device === "webgpu" ? "GPU" : "CPU"}.`}>
          <i /> Smart search
        </span>
      );
    case "loading":
      return (
        <span className="pill loading" title="Downloading the search model once. Keyword search works meanwhile.">
          <i /> Getting smarter {Math.round(model.progress * 100)}%
        </span>
      );
    case "error":
      return (
        <button className="pill off" onClick={onRetry} title={`Keyword search only for now. ${model.message}`}>
          <i /> Basic search · retry
        </button>
      );
    default:
      return (
        <span className="pill off" title="Keyword search. Search by meaning switches on once you add notes.">
          <i /> Search ready
        </span>
      );
  }
}
