import { XMLParser } from 'fast-xml-parser';
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_FEED_BYTES = 5 * 1024 * 1024;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function text(value) {
  if (value == null) return null;
  if (typeof value === 'object') return String(value['#text'] ?? value.href ?? value.url ?? '');
  return String(value);
}

export function parseDuration(value) {
  if (value == null || value === '') return null;
  if (/^\d+$/.test(String(value).trim())) return Number(value);
  const parts = String(value).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

export async function validateFeedUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); } catch { throw new Error('Enter a valid RSS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('RSS feeds must use HTTP or HTTPS.');
  if (url.hostname.endsWith('.example')) throw new Error('This is a demo feed URL. Edit the podcast and add its real RSS URL before syncing.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Local RSS addresses are not allowed.');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => privateIp(record.address))) throw new Error('Private network RSS addresses are not allowed.');
  return url;
}

export async function fetchPodcastFeed(rawUrl) {
  const url = await validateFeedUrl(rawUrl);
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/rss+xml, application/xml, text/xml;q=0.9', 'User-Agent': 'SignalLedger/1.0 RSS Sync' },
  });
  if (!response.ok) throw new Error(`RSS server returned ${response.status}.`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_FEED_BYTES) throw new Error('RSS feed is larger than 5 MB.');
  const xml = await response.text();
  if (Buffer.byteLength(xml) > MAX_FEED_BYTES) throw new Error('RSS feed is larger than 5 MB.');

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed;
  if (!channel) throw new Error('The URL did not return a recognizable RSS or Atom podcast feed.');
  const author = text(channel['itunes:author']) || text(channel.author?.name) || text(channel.managingEditor);
  const image = text(channel['itunes:image']?.['@_href']) || text(channel.image?.url) || text(channel.logo);
  const categoryNode = first(channel['itunes:category']);
  const category = text(categoryNode?.['@_text']) || text(channel.category);
  const website = text(first(channel.link)?.['@_href']) || text(first(channel.link));
  const items = channel.item || channel.entry || [];
  const episodes = (Array.isArray(items) ? items : [items]).map((item, index) => {
    const enclosure = first(item.enclosure);
    const link = Array.isArray(item.link) ? item.link.find((entry) => entry?.['@_rel'] === 'enclosure') : item.link;
    const guid = text(item.guid) || text(item.id) || text(enclosure?.['@_url']) || `${text(item.title) || 'episode'}-${index}`;
    return {
      guid,
      title: text(item.title) || `Untitled episode ${index + 1}`,
      description: text(item['content:encoded']) || text(item.description) || text(item.summary),
      published_at: text(item.pubDate) || text(item.published) || text(item.updated),
      duration_seconds: parseDuration(text(item['itunes:duration'])),
      audio_url: text(enclosure?.['@_url']) || text(link?.['@_href']),
      episode_number: Number(text(item['itunes:episode'])) || null,
      season_number: Number(text(item['itunes:season'])) || null,
      explicit: ['yes', 'true', 'explicit'].includes(String(text(item['itunes:explicit']) || '').toLowerCase()),
    };
  });
  return {
    podcast: {
      title: text(channel.title) || 'Untitled podcast',
      description: text(channel.description) || text(channel.subtitle),
      category,
      host: author,
      network: text(channel['itunes:owner']?.['itunes:name']) || author,
      cover_art_url: image,
      website_url: website,
      language: text(channel.language) || 'en',
      rss_url: url.toString(),
    },
    episodes,
  };
}
