import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { messagingApi } from "@line/bot-sdk";
import { officialTransport } from "../src/line";
import { menu } from "../src/flex";
test("official SDK serializes group Flex reply, retry header, accepted 409 and quota/profile endpoints against a loopback mock", async () => {
  const requests: { path: string; data: unknown; retry: string | undefined }[] =
    [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    requests.push({
      path: req.url!,
      data: raw ? JSON.parse(raw) : null,
      retry: req.headers["x-line-retry-key"] as string | undefined,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/push")) {
      res.setHeader("x-line-accepted-request-id", "already-accepted");
      res.writeHead(409).end('{"message":"The retry key is already accepted"}');
    } else if (req.url?.endsWith("/consumption")) res.end('{"totalUsage":10}');
    else if (req.url?.endsWith("/quota"))
      res.end('{"type":"limited","value":200}');
    else if (req.url?.endsWith("/count")) res.end('{"count":16}');
    else if (req.url?.includes("/member/"))
      res.end('{"displayName":"隔離測試隊員","userId":"mock-user"}');
    else res.end('{"sentMessages":[]}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = new messagingApi.MessagingApiClient({
        channelAccessToken: "mock-only-no-real-token",
        baseURL: `http://127.0.0.1:${address.port}`,
      }),
      t = officialTransport("unused", client);
    await t.reply("mock-reply-token", [menu()]);
    assert.equal(requests[0].path, "/v2/bot/message/reply");
    assert.deepEqual(requests[0].data, {
      replyToken: "mock-reply-token",
      messages: [menu()],
    });
    await t.push(
      "mock-group",
      [menu()],
      "00000000-0000-4000-8000-000000000001",
    );
    assert.equal(requests[1].retry, "00000000-0000-4000-8000-000000000001");
    assert.equal((await t.quota()).remaining, 190);
    assert.equal(await t.memberCount("mock-group"), 16);
    assert.equal(await t.profile("mock-group", "mock-user"), "隔離測試隊員");
    assert.ok(
      requests.some(
        (r) => r.path === "/v2/bot/group/mock-group/member/mock-user",
      ),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
