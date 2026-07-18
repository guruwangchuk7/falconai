import { describe, it, expect } from "vitest";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { mintParticipantToken } from "../../src/livekit/mintToken";

describe("mintParticipantToken", () => {
  it("mints a token that grants join access to the configured room under the given name", async () => {
    const deps = {
      apiKey: "test-key",
      apiSecret: "test-secret-that-is-long-enough",
      roomName: "falcon-meet",
      url: "wss://example.livekit.cloud",
    };

    const { token, url } = await mintParticipantToken(deps, "Alex");

    expect(url).toBe("wss://example.livekit.cloud");
    const verifier = new TokenVerifier(deps.apiKey, deps.apiSecret);
    const claims = await verifier.verify(token);
    expect(claims.video?.room).toBe("falcon-meet");
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.sub).toBe("Alex");
  });
});
