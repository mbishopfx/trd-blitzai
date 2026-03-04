import { afterEach, describe, expect, it, vi } from "vitest";
import { compareSnapshots, ensureFreshAccessToken } from "../src";

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
