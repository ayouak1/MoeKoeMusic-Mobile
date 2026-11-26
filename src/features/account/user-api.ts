import { pickNumber, pickStringLike, pickText, toRecord, toRecords } from "@/lib/api-parse";
import { sizedImage } from "@/lib/format";
import { bootstrapMobileApi, getApiSession, mobileApi } from "@/lib/kugou-api";

export type UserProfile = {
  userid: string;
  nickname: string;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  signature: string;
  fans: number;
  follows: number;
  listenMinutes: number;
  isVip: boolean;
  vipLabel: string;
  vipExpireAt?: number;
};

function parseVipTimestamp(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return num > 0 ? (num < 1e12 ? num * 1000 : num) : undefined;
    }
    const iso = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}+08:00`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

export function isLoggedIn(): boolean {
  const session = getApiSession();
  return Boolean(session.userid && session.userid !== "0" && session.token);
}

export async function fetchUserProfile(): Promise<UserProfile> {
  await bootstrapMobileApi();
  const [detailResult, vipResult] = await Promise.allSettled([
    mobileApi.user_detail({}),
    mobileApi.user_vip_detail({}),
  ]);

  if (detailResult.status === "rejected") {
    throw detailResult.reason instanceof Error
      ? detailResult.reason
      : new Error("获取用户信息失败");
  }

  const data = toRecord(toRecord(detailResult.value.body).data);
  const session = getApiSession();

  let isVip = false;
  let vipLabel = "";
  let vipExpireAt: number | undefined;
  if (vipResult.status === "fulfilled") {
    const vipData = toRecord(toRecord(vipResult.value.body).data);
    const vipRecords = toRecords(vipData.busi_vip);
    const activeVip = vipRecords.find((item) => pickNumber(item.is_vip) === 1);
    if (activeVip) {
      isVip = true;
      vipLabel = pickText(activeVip.product_type).toLowerCase() === "svip" ? "SVIP" : "VIP";
      vipExpireAt =
        parseVipTimestamp(activeVip.vip_end_time) ??
        parseVipTimestamp(activeVip.end_time) ??
        parseVipTimestamp(activeVip.m_end_time) ??
        parseVipTimestamp(vipData.vip_end_time) ??
        parseVipTimestamp(vipData.m_end_time);
    }
  }

  return {
    userid: pickStringLike(data.userid, session.userid),
    nickname: pickText(data.nickname, `用户 ${session.userid ?? ""}`),
    avatarUrl: sizedImage(pickText(data.pic), 240),
    backgroundUrl: sizedImage(pickText(data.bg_pic), 720),
    signature: pickText(data.descri),
    fans: pickNumber(data.fans),
    follows: pickNumber(data.follows),
    listenMinutes: pickNumber(data.duration),
    isVip,
    vipLabel,
    vipExpireAt,
  };
}
