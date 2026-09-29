/**
 * Decide whether we may download AI models without asking.
 *
 * Students in India are often on metered mobile data, so we only download
 * automatically on Wi-Fi/ethernet or when the connection type is unknown
 * (desktop browsers don't report it). On mobile data, or with Data Saver on,
 * we ask first.
 */
export interface ConnectionLike {
  type?: string;
  saveData?: boolean;
}

export type DownloadPolicy = "auto" | "ask";

export function downloadPolicy(conn: ConnectionLike | undefined): DownloadPolicy {
  if (!conn) return "auto";
  if (conn.saveData) return "ask";
  if (conn.type === "cellular") return "ask";
  return "auto";
}

export function currentConnection(): ConnectionLike | undefined {
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}
