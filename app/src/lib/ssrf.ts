import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import { StreamCheckResponse } from '@aavritti/shared';

// Checks whether an IPv4 or IPv6 address belongs to private/restricted ranges
export function isPrivateIp(ip: string): boolean {
  // Normalize IPv6 mapped IPv4 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // IPv4 check
  if (ip.includes('.')) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed = reject
    }

    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 (Private)
    if (a === 127) return true; // 127.0.0.0/8 (Loopback)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (Private)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (Private)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (Benchmarking)
    if (a >= 224) return true; // Multicast & Reserved
    return false;
  }

  // IPv6 check
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique local (fc00::/7)
  if (lower.startsWith('fe80')) return true; // Link local (fe80::/10)
  if (lower.startsWith('ff')) return true; // Multicast (ff00::/8)

  return false;
}

export async function validateSafeHost(hostname: string): Promise<string[]> {
  // If hostname is already an IP, test it directly
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Forbidden: IP ${hostname} is in a private or restricted network range.`);
    }
    return [hostname];
  }

  const lookupResults = await dns.lookup(hostname, { all: true });
  if (!lookupResults || lookupResults.length === 0) {
    throw new Error(`DNS resolution failed for host: ${hostname}`);
  }

  for (const { address } of lookupResults) {
    if (isPrivateIp(address)) {
      throw new Error(`Forbidden: Host ${hostname} resolves to private IP: ${address}`);
    }
  }

  return lookupResults.map((r) => r.address);
}

interface FetchHeadersResult {
  finalUrl: string;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
}

export async function fetchHeadersSafe(
  targetUrl: string,
  redirectCount = 0
): Promise<FetchHeadersResult> {
  if (redirectCount > 4) {
    throw new Error('Too many redirects (maximum 4 redirects allowed).');
  }

  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported protocol: Only http:// and https:// URLs are allowed.');
  }

  // Verify host against SSRF restrictions
  await validateSafeHost(parsed.hostname);

  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let resolved = false;

    const req = client.request(
      targetUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'AmalESP32Radio/1.0',
          'Icy-MetaData': '1',
          Accept: '*/*',
        },
        timeout: 5000,
      },
      async (res) => {
        resolved = true;
        const statusCode = res.statusCode || 0;

        // Abort the socket immediately so audio data is never streamed
        res.destroy();

        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          res.headers.location
        ) {
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();
          try {
            const nextResult = await fetchHeadersSafe(redirectUrl, redirectCount + 1);
            resolve(nextResult);
          } catch (err) {
            reject(err);
          }
          return;
        }

        resolve({
          finalUrl: targetUrl,
          statusCode,
          headers: res.headers,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      if (!resolved) {
        reject(new Error('Connection timed out after 5 seconds.'));
      }
    });

    req.on('error', (err) => {
      if (!resolved) reject(err);
    });

    req.end();
  });
}

export async function checkStream(
  url: string,
  fetchFn: (u: string) => Promise<FetchHeadersResult> = fetchHeadersSafe
): Promise<StreamCheckResponse> {
  const result = await fetchFn(url);
  const finalParsed = new URL(result.finalUrl);
  const isHttps = finalParsed.protocol === 'https:';

  const contentType = (result.headers['content-type'] || 'unknown').toLowerCase();
  const icyName = result.headers['icy-name'] as string | undefined;
  const icyBr = result.headers['icy-br']
    ? parseInt(result.headers['icy-br'] as string, 10)
    : undefined;
  const icyGenre = result.headers['icy-genre'] as string | undefined;

  const notes: string[] = [];
  let compatible = false;
  let status: StreamCheckResponse['status'] = 'ok';

  if (isHttps) {
    notes.push('Uses HTTPS: Requires ~40 KB TLS heap buffer on ESP32.');
  }

  // Audio format check
  if (
    contentType.includes('audio/mpeg') ||
    contentType.includes('audio/mp3') ||
    (contentType.includes('application/octet-stream') && (icyName || icyBr))
  ) {
    compatible = true;
    notes.push('Compatible MP3 audio stream.');
    if (icyBr && icyBr > 192) {
      notes.push(`High bitrate (${icyBr} kbps): Recommended <= 192 kbps for best stability.`);
      status = 'warning';
    }
  } else if (
    contentType.includes('aac') ||
    contentType.includes('ogg') ||
    contentType.includes('mpegurl') ||
    contentType.includes('m3u8')
  ) {
    compatible = false;
    status = 'incompatible';
    notes.push('ESP32 firmware decodes MP3 only (AAC/OGG/HLS are not supported).');
  } else {
    // Unknown or generic stream
    compatible = false;
    status = 'warning';
    notes.push(`Content-Type '${contentType}' might not be pure MP3 audio.`);
  }

  return {
    originalUrl: url,
    finalUrl: result.finalUrl,
    isHttps,
    contentType,
    icyName,
    icyBitrate: isNaN(icyBr ?? NaN) ? undefined : icyBr,
    icyGenre,
    compatible,
    status,
    notes,
  };
}
