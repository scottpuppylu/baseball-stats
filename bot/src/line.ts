import { messagingApi, HTTPFetchError } from "@line/bot-sdk";
import type { Message, Transport } from "./types";
export function officialTransport(
  accessToken: string,
  client = new messagingApi.MessagingApiClient({
    channelAccessToken: accessToken,
  }),
): Transport {
  return {
    async reply(replyToken, messages) {
      await client.replyMessage({ replyToken, messages });
    },
    async push(to, messages, retryKey) {
      try {
        await client.pushMessage({ to, messages }, retryKey);
      } catch (error) {
        if (
          !(
            error instanceof HTTPFetchError &&
            error.status === 409 &&
            error.headers.get("x-line-accepted-request-id")
          )
        )
          throw error;
      }
    },
    async quota() {
      const [quota, usage] = await Promise.all([
        client.getMessageQuota(),
        client.getMessageQuotaConsumption(),
      ]);
      return {
        remaining:
          quota.type === "none"
            ? Number.MAX_SAFE_INTEGER
            : Math.max(0, (quota.value || 0) - (usage.totalUsage || 0)),
      };
    },
    async memberCount(group) {
      return (await client.getGroupMemberCount(group)).count;
    },
    async profile(group, user) {
      try {
        return (await client.getGroupMemberProfile(group, user)).displayName;
      } catch {
        return null;
      }
    },
  };
}
