import { afterEach, describe, expect, it, vi } from "vitest";
import { GbpApiClient, compareSnapshots, ensureFreshAccessToken, generateReviewReply, hasReviewComment } from "../src";

const oauthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://example.com/callback"
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ensureFreshAccessToken", () => {
  it("returns existing token when still valid", async () => {
    const token = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      scopes: ["scope-a"],
      tokenType: "Bearer"
    };

    const result = await ensureFreshAccessToken({ config: oauthConfig, tokenSet: token });
    expect(result).toEqual(token);
  });

  it("refreshes token when expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "new-access",
          expires_in: 3600,
          scope: "scope-a scope-b",
          token_type: "Bearer"
        })
      }))
    );

    const result = await ensureFreshAccessToken({
      config: oauthConfig,
      tokenSet: {
        accessToken: "old-access",
        refreshToken: "refresh",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scopes: ["scope-a"],
        tokenType: "Bearer"
      }
    });

    expect(result.accessToken).toBe("new-access");
    expect(result.scopes).toContain("scope-b");
  });
});

describe("compareSnapshots", () => {
  it("detects business and review changes", () => {
    const changes = compareSnapshots(
      {
        locationName: "locations/1",
        businessInfo: {
          name: "locations/1",
          title: "Old Name",
          primaryPhone: "111",
          websiteUri: "https://old.example.com"
        },
        reviews: [],
        posts: [],
        fetchedAt: new Date().toISOString()
      },
      {
        locationName: "locations/1",
        businessInfo: {
          name: "locations/1",
          title: "New Name",
          primaryPhone: "222",
          websiteUri: "https://new.example.com"
        },
        reviews: [
          {
            name: "accounts/x/locations/y/reviews/z",
            starRating: "FIVE",
            comment: "Great"
          }
        ],
        posts: [],
        fetchedAt: new Date().toISOString()
      }
    );

    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(changes.some((change) => change.fieldName === "title")).toBe(true);
    expect(changes.some((change) => change.fieldName === "new_review")).toBe(true);
  });
});

describe("review replies", () => {
  it("treats whitespace-only review text as rating-only", () => {
    expect(hasReviewComment("   \n\t  ")).toBe(false);
    expect(hasReviewComment("Quick and professional")).toBe(true);
  });

  it("generates a generic positive reply when no review text is present", () => {
    const reply = generateReviewReply({
      review: {
        name: "accounts/1/locations/2/reviews/3",
        starRating: "FIVE",
        comment: "   "
      },
      businessName: "Brooklyn Paint",
      brandVoice: "Brooklyn Paint Team"
    });

    expect(reply).toContain("5-star review");
    expect(reply).not.toContain("Brooklyn Paint Team");
    expect(reply).not.toContain("positive rating");
    expect(reply).not.toContain(" - ");
  });

  it("keeps positive written-review replies short and natural", () => {
    const reply = generateReviewReply({
      review: {
        name: "accounts/1/locations/2/reviews/3",
        starRating: "FIVE",
        comment: "Fast, friendly, and professional service."
      },
      businessName: "Road Warrior Towing"
    });

    expect(reply).toContain("Road Warrior Towing");
    expect(reply).not.toContain('"Fast, friendly, and professional service."');
    expect(reply).not.toContain("Thanks for sharing this feedback");
  });
});

describe("review reply API client", () => {
  it("uses the canonical review resource name when provided", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "{}"
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GbpApiClient("token");
    await client.postReviewReply(
      "123",
      "456",
      "accounts/123/locations/456/reviews/abc123",
      "Thanks for the review."
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews/abc123/reply",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });
});
