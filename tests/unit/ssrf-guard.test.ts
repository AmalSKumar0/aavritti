import { describe, it, expect } from 'vitest';
import { isPrivateIp, validateSafeHost } from '@/lib/ssrf';

describe('SSRF Protection Guard', () => {
  describe('isPrivateIp', () => {
    it('detects IPv4 loopback addresses (127.0.0.0/8)', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('127.0.0.2')).toBe(true);
      expect(isPrivateIp('127.255.255.254')).toBe(true);
    });

    it('detects Cloud metadata & link-local addresses (169.254.0.0/16)', () => {
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('169.254.1.1')).toBe(true);
    });

    it('detects Class A private addresses (10.0.0.0/8)', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('10.254.254.254')).toBe(true);
    });

    it('detects Class B private addresses (172.16.0.0/12)', () => {
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      // 172.32.0.1 is public
      expect(isPrivateIp('172.32.0.1')).toBe(false);
    });

    it('detects Class C private addresses (192.168.0.0/16)', () => {
      expect(isPrivateIp('192.168.1.1')).toBe(true);
      expect(isPrivateIp('192.168.0.254')).toBe(true);
    });

    it('detects IPv6 loopback, unspecified, and private addresses', () => {
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('::')).toBe(true);
      expect(isPrivateIp('fc00::1')).toBe(true);
      expect(isPrivateIp('fd12:3456:789a::1')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);
      expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIp('::ffff:192.168.1.1')).toBe(true);
    });

    it('allows valid public IP addresses', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false); // Google DNS
      expect(isPrivateIp('1.1.1.1')).toBe(false); // Cloudflare DNS
      expect(isPrivateIp('93.184.216.34')).toBe(false); // example.com
      expect(isPrivateIp('142.250.190.46')).toBe(false); // google.com
    });
  });

  describe('validateSafeHost', () => {
    it('blocks localhost directly', async () => {
      await expect(validateSafeHost('localhost')).rejects.toThrow(/Forbidden/);
    });

    it('blocks 127.0.0.1 directly', async () => {
      await expect(validateSafeHost('127.0.0.1')).rejects.toThrow(/Forbidden/);
    });

    it('blocks 169.254.169.254 cloud metadata', async () => {
      await expect(validateSafeHost('169.254.169.254')).rejects.toThrow(/Forbidden/);
    });

    it('allows safe public hostnames like example.com', async () => {
      const ips = await validateSafeHost('example.com');
      expect(ips.length).toBeGreaterThan(0);
      expect(isPrivateIp(ips[0])).toBe(false);
    });
  });
});
