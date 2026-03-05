import type { GbpAccount, GbpLocation, GbpPost, GbpPostPayload, GbpReview } from "./types";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
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
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GBP API request failed (${response.status}): ${text.slice(0, 400)}`);
    }

    return (await response.json()) as T;
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

  async fetchReviews(accountId: string, locationId: string): Promise<GbpReview[]> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`;
    const result = await this.request<{ reviews?: GbpReview[] }>(endpoint);
    return result.reviews ?? [];
  }

  async postReviewReply(accountId: string, locationId: string, reviewId: string, comment: string): Promise<void> {
    const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`;
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
}
