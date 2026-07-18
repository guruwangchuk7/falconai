import { AccessToken } from "livekit-server-sdk";

export interface MintTokenDeps {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  url: string;
}

export async function mintParticipantToken(
  deps: MintTokenDeps,
  name: string
): Promise<{ token: string; url: string }> {
  const accessToken = new AccessToken(deps.apiKey, deps.apiSecret, {
    identity: name,
    name,
  });
  accessToken.addGrant({
    roomJoin: true,
    room: deps.roomName,
    canPublish: true,
    canSubscribe: true,
  });
  const token = await accessToken.toJwt();
  return { token, url: deps.url };
}
