import type {
  GbpAccount,
  GbpAttributeMetadata,
  GbpLocation,
  GbpLocationMediaItem,
  GbpPlaceActionLink,
  GbpPost,
  GbpPostPayload,
  GbpReview
} from "./types";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

function toReviewResourceName(accountId: string, locationId: string, reviewNameOrId: string): string {
  const trimmed = reviewNameOrId.trim();
  if (!trimmed) {
    throw new Error("Review identifier is required");
  }

  if (trimmed.startsWith("accounts/") && trimmed.includes("/reviews/")) {
    return trimmed;
  }

  return `accounts/${accountId}/locations/${locationId}/reviews/${encodeURIComponent(trimmed)}`;
}

export class GbpApiClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GBP API request failed (${response.status}): ${text.slice(0, 400)}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    if (!text.trim()) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  async listAccounts(): Promise<GbpAccount[]> {
    const result = await this.request<{ accounts?: GbpAccount[] }>(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
    );
    return result.accounts ?? [];
  }

  async listLocations(accountName: string): Promise<GbpLocation[]> {
    const base = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`;
    const url = new URL(base);
    url.searchParams.set(
      "readMask",
      "name,title,storefrontAddress,websiteUri,phoneNumbers.primaryPhone"
    );
    url.searchParams.set("pageSize", "100");
    const result = await this.request<{ locations?: GbpLocation[] }>(url.toString());
    return result.locations ?? [];
  }

  async fetchLocation(locationName: string): Promise<GbpLocation | null> {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}`);
    // Keep to broadly supported Business Information fields to avoid INVALID_ARGUMENT
    // when accounts are on mixed schema versions.
    url.searchParams.set("readMask", ["name", "title", "storefrontAddress", "websiteUri", "phoneNumbers", "regularHours"].join(","));

    const result = await this.request<GbpLocation>(url.toString());
    return result ?? null;
  }

  async listPosts(accountId: string, locationId: string): Promise<GbpPost[]> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts?pageSize=100`;
    const result = await this.request<{ localPosts?: GbpPost[] }>(endpoint);
    return result.localPosts ?? [];
  }

  async publishLocalPost(accountId: string, locationId: string, payload: GbpPostPayload): Promise<{ name: string }> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`;

    const postBody: Record<string, unknown> = {
      languageCode: "en-US",
      summary: payload.summary,
      topicType: payload.topicType
    };

    if (payload.mediaUrl) {
      postBody.media = [
        {
          mediaFormat: "PHOTO",
          sourceUrl: payload.mediaUrl
        }
      ];
    }

    if (payload.ctaUrl) {
      postBody.callToAction = {
        actionType: "LEARN_MORE",
        url: payload.ctaUrl
      };
    }

    return this.request<{ name: string }>(endpoint, {
      method: "POST",
      body: postBody
    });
  }

  async deleteLocalPost(accountId: string, locationId: string, localPostId: string): Promise<void> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts/${localPostId}`;
    await this.request<Record<string, unknown>>(endpoint, {
      method: "DELETE"
    });
  }

  async listLocationMedia(accountId: string, locationId: string, pageSize = 100): Promise<GbpLocationMediaItem[]> {
    const media: GbpLocationMediaItem[] = [];
    let pageToken: string | null = null;
    const boundedPageSize = Math.max(1, Math.min(pageSize, 100));

    do {
      const endpoint = new URL(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/media`);
      endpoint.searchParams.set("pageSize", String(boundedPageSize));
      if (pageToken) {
        endpoint.searchParams.set("pageToken", pageToken);
      }

      const result = await this.request<{
        mediaItems?: GbpLocationMediaItem[];
        nextPageToken?: string;
      }>(endpoint.toString());
      media.push(...(result.mediaItems ?? []));
      pageToken = typeof result.nextPageToken === "string" && result.nextPageToken ? result.nextPageToken : null;
    } while (pageToken);

    return media;
  }

  async uploadLocationMedia(input: {
    accountId: string;
    locationId: string;
    mediaFormat: "PHOTO" | "VIDEO";
    sourceUrl: string;
    description?: string;
    locationCategory?: string;
  }): Promise<GbpLocationMediaItem> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${input.accountId}/locations/${input.locationId}/media`;
    const body: Record<string, unknown> = {
      mediaFormat: input.mediaFormat,
      sourceUrl: input.sourceUrl
    };
    if (input.description?.trim()) {
      body.description = input.description.trim().slice(0, 900);
    }
    if (input.locationCategory?.trim()) {
      body.locationAssociation = {
        category: input.locationCategory.trim()
      };
    }

    return this.request<GbpLocationMediaItem>(endpoint, {
      method: "POST",
      body
    });
  }

  async fetchReviews(accountId: string, locationId: string): Promise<GbpReview[]> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`;
    const result = await this.request<{ reviews?: GbpReview[] }>(endpoint);
    return result.reviews ?? [];
  }

  async postReviewReply(accountId: string, locationId: string, reviewNameOrId: string, comment: string): Promise<void> {
    const reviewName = toReviewResourceName(accountId, locationId, reviewNameOrId);
    const endpoint = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
    await this.request<Record<string, unknown>>(endpoint, {
      method: "PUT",
      body: { comment }
    });
  }

  async patchLocation(
    locationName: string,
    patch: Record<string, unknown>,
    updateMask: string[]
  ): Promise<GbpLocation> {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}`);
    if (updateMask.length) {
      url.searchParams.set("updateMask", updateMask.join(","));
    }

    return this.request<GbpLocation>(url.toString(), {
      method: "PATCH",
      body: patch
    });
  }

  async updateLocationAttributes(input: {
    locationName: string;
    attributes: Array<Record<string, unknown>>;
    attributeMask: string[];
  }): Promise<{ name: string; attributes?: Array<Record<string, unknown>> }> {
    const endpoint = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${input.locationName}/attributes`);
    const dedupedMask = [...new Set(input.attributeMask.map((entry) => entry.trim()).filter(Boolean))];
    if (!dedupedMask.length) {
      throw new Error("attributeMask is required for updateLocationAttributes");
    }

    endpoint.searchParams.set("attributeMask", dedupedMask.join(","));
    return this.request<{ name: string; attributes?: Array<Record<string, unknown>> }>(endpoint.toString(), {
      method: "PATCH",
      body: {
        name: `${input.locationName}/attributes`,
        attributes: input.attributes
      }
    });
  }

  async listAttributeMetadata(input: {
    parentLocationName: string;
    languageCode?: string;
    pageSize?: number;
  }): Promise<GbpAttributeMetadata[]> {
    const pageSize = Math.max(1, Math.min(200, input.pageSize ?? 200));
    const languageCode = input.languageCode?.trim() || "en";
    const metadata: GbpAttributeMetadata[] = [];
    let pageToken: string | null = null;

    do {
      const endpoint = new URL("https://mybusinessbusinessinformation.googleapis.com/v1/attributes");
      endpoint.searchParams.set("parent", input.parentLocationName);
      endpoint.searchParams.set("languageCode", languageCode);
      endpoint.searchParams.set("pageSize", String(pageSize));
      if (pageToken) {
        endpoint.searchParams.set("pageToken", pageToken);
      }

      const result = await this.request<{
        attributes?: GbpAttributeMetadata[];
        nextPageToken?: string;
      }>(endpoint.toString());

      metadata.push(...(result.attributes ?? []));
      pageToken = typeof result.nextPageToken === "string" && result.nextPageToken ? result.nextPageToken : null;
    } while (pageToken);

    return metadata;
  }

  async listPlaceActionLinks(locationId: string): Promise<GbpPlaceActionLink[]> {
    const links: GbpPlaceActionLink[] = [];
    let pageToken: string | null = null;

    do {
      const endpoint = new URL(
        `https://mybusinessplaceactions.googleapis.com/v1/locations/${encodeURIComponent(locationId)}/placeActionLinks`
      );
      endpoint.searchParams.set("pageSize", "100");
      if (pageToken) {
        endpoint.searchParams.set("pageToken", pageToken);
      }

      const result = await this.request<{
        placeActionLinks?: GbpPlaceActionLink[];
        nextPageToken?: string;
      }>(endpoint.toString());
      links.push(...(result.placeActionLinks ?? []));
      pageToken = typeof result.nextPageToken === "string" && result.nextPageToken ? result.nextPageToken : null;
    } while (pageToken);

    return links;
  }

  async createPlaceActionLink(
    locationId: string,
    payload: Pick<GbpPlaceActionLink, "uri" | "placeActionType" | "isPreferred">
  ): Promise<GbpPlaceActionLink> {
    const endpoint = `https://mybusinessplaceactions.googleapis.com/v1/locations/${encodeURIComponent(locationId)}/placeActionLinks`;
    return this.request<GbpPlaceActionLink>(endpoint, {
      method: "POST",
      body: payload as Record<string, unknown>
    });
  }

  async patchPlaceActionLink(
    name: string,
    payload: Pick<GbpPlaceActionLink, "uri" | "placeActionType" | "isPreferred">,
    updateMask: string[]
  ): Promise<GbpPlaceActionLink> {
    const endpoint = new URL(`https://mybusinessplaceactions.googleapis.com/v1/${name}`);
    const dedupedMask = [...new Set(updateMask.map((entry) => entry.trim()).filter(Boolean))];
    if (!dedupedMask.length) {
      throw new Error("updateMask is required for patchPlaceActionLink");
    }
    endpoint.searchParams.set("updateMask", dedupedMask.join(","));

    return this.request<GbpPlaceActionLink>(endpoint.toString(), {
      method: "PATCH",
      body: payload as Record<string, unknown>
    });
  }
}
