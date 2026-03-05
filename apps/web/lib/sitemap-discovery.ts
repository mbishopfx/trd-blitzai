interface SitemapDiscoveryResult {
  sitemapUrl: string | null;
  defaultPostUrl: string | null;
  source: "robots" | "candidate" | "none";
  checkedUrls: string[];
  reason?: string;
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function websiteBaseUrl(websiteUrl: string): string | null {
  const normalized = normalizeUrl(websiteUrl);
  if (!normalized) {
    return null;
  }
  const parsed = new URL(normalized);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  return parsed.toString();
}

function originFromWebsite(websiteUrl: string): string | null {
  const normalized = normalizeUrl(websiteUrl);
  if (!normalized) {
    return null;
  }
  return new URL(normalized).origin;
}

function parseSitemapEntries(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)];
  return matches
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

async function fetchText(url: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/xml,text/xml,text/plain,*/*"
      }
    });
    const body = await response.text().catch(() => "");
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeSitemapDocument(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("<urlset") || normalized.includes("<sitemapindex") || normalized.includes("<loc>");
}

function candidateSitemapUrls(origin: string): string[] {
  return [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
    `${origin}/sitemap/sitemap.xml`
  ];
}

async function discoverFromRobots(origin: string): Promise<{ sitemapUrl: string | null; checked: string[] }> {
  const robotsUrl = `${origin}/robots.txt`;
  const checked: string[] = [robotsUrl];
  const response = await fetchText(robotsUrl, 10000).catch(() => ({ ok: false, status: 0, body: "" }));
  if (!response.ok || !response.body) {
    return {
      sitemapUrl: null,
      checked
    };
  }

  const lines = response.body.split(/\r?\n/);
  const sitemapLines = lines
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.replace(/^sitemap:\s*/i, "").trim());

  for (const entry of sitemapLines) {
    const normalized = normalizeUrl(entry);
    if (!normalized) {
      continue;
    }
    checked.push(normalized);
    const sitemapResponse = await fetchText(normalized, 10000).catch(() => ({ ok: false, status: 0, body: "" }));
    if (sitemapResponse.ok && looksLikeSitemapDocument(sitemapResponse.body)) {
      return {
        sitemapUrl: normalized,
        checked
      };
    }
  }

  return {
    sitemapUrl: null,
    checked
  };
}

export async function discoverSitemapForWebsite(websiteUrl: string): Promise<SitemapDiscoveryResult> {
  const origin = originFromWebsite(websiteUrl);
  const defaultPostUrl = websiteBaseUrl(websiteUrl);
  if (!origin) {
    return {
      sitemapUrl: null,
      defaultPostUrl: null,
      source: "none",
      checkedUrls: [],
      reason: "invalid_website_url"
    };
  }

  const checkedUrls: string[] = [];

  const robots = await discoverFromRobots(origin);
  checkedUrls.push(...robots.checked);
  if (robots.sitemapUrl) {
    return {
      sitemapUrl: robots.sitemapUrl,
      defaultPostUrl,
      source: "robots",
      checkedUrls
    };
  }

  for (const candidate of candidateSitemapUrls(origin)) {
    checkedUrls.push(candidate);
    const response = await fetchText(candidate, 10000).catch(() => ({ ok: false, status: 0, body: "" }));
    if (!response.ok || !looksLikeSitemapDocument(response.body)) {
      continue;
    }

    const entries = parseSitemapEntries(response.body);
    if (entries.length > 0) {
      return {
        sitemapUrl: candidate,
        defaultPostUrl,
        source: "candidate",
        checkedUrls
      };
    }
  }

  return {
    sitemapUrl: null,
    defaultPostUrl,
    source: "none",
    checkedUrls,
    reason: "not_found"
  };
}

