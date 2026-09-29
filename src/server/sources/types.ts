export interface RawFeedItem {
  externalId?: string;
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
}

export class SourceFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "timeout" | "http" | "parse" | "empty",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}
