export interface GbpOAuthState {
  organizationId: string;
  clientId: string;
  userId: string;
  returnPath: string;
}

export interface GbpTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  tokenType: string;
}

export interface GbpAccount {
  name: string;
  accountName?: string;
  type?: string;
}

export interface GbpLocation {
  name: string;
  title?: string;
  storefrontAddress?: Record<string, unknown>;
  websiteUri?: string;
  primaryPhone?: string;
  regularHours?: Record<string, unknown>;
  categories?: Array<Record<string, unknown> | string>;
  attributes?: Array<Record<string, unknown>>;
  profile?: Record<string, unknown>;
  phoneNumbers?: {
    primaryPhone?: string;
    additionalPhones?: string[];
  };
}

export interface GbpReview {
  name: string;
  reviewId?: string;
  reviewer?: {
    displayName?: string;
    profilePhotoUrl?: string;
  };
  comment?: string;
  starRating?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment: string; updateTime?: string };
}

export interface GbpPostPayload {
  summary: string;
  topicType: "STANDARD" | "EVENT" | "OFFER";
  mediaUrl?: string;
  ctaUrl?: string;
}

export interface GbpApiConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GbpPost {
  name: string;
  summary?: string;
  createTime?: string;
  updateTime?: string;
  callToAction?: {
    actionType?: string;
    url?: string;
  };
}

export interface GbpSnapshot {
  locationName: string;
  businessInfo: GbpLocation | null;
  reviews: GbpReview[];
  posts: GbpPost[];
  fetchedAt: string;
}

export interface SnapshotChange {
  changeType: "business_info" | "review" | "post" | "verification" | "rating";
  fieldName?: string;
  oldValue: unknown;
  newValue: unknown;
  severity: "critical" | "high" | "medium" | "low";
}

export interface GbpHealthScore {
  completenessScore: number;
  missingCritical: string[];
  missingRecommended: string[];
  staleSignals: string[];
}
