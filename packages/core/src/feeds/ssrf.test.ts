import { afterEach, describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress, UnsafeUrlError } from "./ssrf.js";

afterEach(() => { delete process.env.ALLOW_PRIVATE_FETCH; });

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local, metadata and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("refuses internal targets before any request is made", async () => {
    for (const url of ["http://localhost:4000/api/me", "http://127.0.0.1/x", "http://[::1]/x", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/admin", "http://intranet/x", "http://db.internal/x", "ftp://example.com/x", "file:///etc/passwd"]) {
      await expect(assertPublicUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });
  it("accepts a public IP literal and honours the development override", async () => {
    await expect(assertPublicUrl("https://93.184.216.34/jobs/1")).resolves.toBeInstanceOf(URL);
    process.env.ALLOW_PRIVATE_FETCH = "1";
    await expect(assertPublicUrl("http://127.0.0.1:3000/x")).resolves.toBeInstanceOf(URL);
  });
});
