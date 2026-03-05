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

export interface GbpAttributeMetadata {
  parent?: string;
  displayName?: string;
  valueType?: "ATTRIBUTE_VALUE_TYPE_UNSPECIFIED" | "BOOL" | "ENUM" | "URL" | "REPEATED_ENUM" | string;
  repeatable?: boolean;
  deprecated?: boolean;
  valueMetadata?: Array<Record<string, unknown>>;
}

export interface GbpPlaceActionLink {
  name?: string;
  uri?: string;
  placeActionType?:
    | "PLACE_ACTION_TYPE_UNSPECIFIED"
    | "APPOINTMENT"
    | "ONLINE_APPOINTMENT"
    | "DINING_RESERVATION"
    | "FOOD_ORDERING"
    | "FOOD_DELIVERY"
    | "FOOD_TAKEOUT"
    | "SHOP_ONLINE"
    | "SOLOPRENEUR_APPOINTMENT"
    | string;
  isPreferred?: boolean;
  isEditable?: boolean;
  providerType?: string;
  createTime?: string;
  updateTime?: string;
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

export interface GbpLocationMediaItem {
  name?: string;
  mediaFormat?: "PHOTO" | "VIDEO" | string;
  sourceUrl?: string;
  googleUrl?: string;
  thumbnailUrl?: string;
  createTime?: string;
  updateTime?: string;
  description?: string;
}

export interface GbpApiConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
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
