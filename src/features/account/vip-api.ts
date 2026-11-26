import { pickNumber, pickText, toRecord } from '@/lib/api-parse';
import { showToast } from '@/components/ui/toast';
import { bootstrapMobileApi, getApiSession, mobileApi } from '@/lib/kugou-api';

import { fetchUserProfile, isLoggedIn } from './user-api';

export type VipSignInResult = {
  message: string;
  /** 是否是“今天已签到”这类非错误的提示（用于区分成功/中性/失败的展示）。 */
  alreadyDone: boolean;
  /** 签到态正常（成功或今天已签），可以继续询问升级概念版 VIP；风控等异常不给升级入口。 */
  canUpgrade?: boolean;
};

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

/** 提取酷狗返回体里的错误码，兼容 { error_code } 与包在 body 里的两种形态。 */
function pickErrorCode(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 0;
  }
  const record = error as Record<string, unknown>;
  const bodyCode = pickNumber(toRecord(record.body).error_code);
  if (bodyCode) {
    return bodyCode;
  }
  const responseCode = pickNumber(toRecord(toRecord(record.response).data).error_code);
  if (responseCode) {
    return responseCode;
  }
  const direct = pickNumber(record.error_code, record.status);
  if (direct) {
    return direct;
  }
  return 0;
}

/**
 * 概念版每日签到：领取 1 天畅听 VIP。
 * 对应桌面端「个人中心 → 签到」调用的 /youth/day/vip。
 */
export async function signInDailyVip(): Promise<VipSignInResult> {
  await bootstrapMobileApi();

  try {
    const response = await mobileApi.youth_day_vip({ receive_day: todayKey() });
    const body = toRecord(response.body);
    if (pickNumber(body.status) === 1) {
      return { message: '签到成功，获得 1 天畅听 VIP', alreadyDone: false, canUpgrade: true };
    }
    const msg = pickText(body.error_msg);
    return { message: msg || '签到失败，请稍后重试', alreadyDone: false };
  } catch (error) {
    const code = pickErrorCode(error);
    if (code === 131001) {
      return { message: '你今天已经签到过了', alreadyDone: true, canUpgrade: true };
    }
    if (code === 20028) {
      return { message: '当前账号存在风控，请前往手机酷狗领取', alreadyDone: true };
    }
    const msg = pickText(toRecord((error as Record<string, unknown>)?.body).error_msg);
    throw new Error(msg || `签到失败${code ? `（${code}）` : ''}`);
  }
}

/**
 * 升级为概念版 VIP（更高音质），一天仅一次。
 * 对应桌面端 /youth/day/vip/upgrade。
 */
export async function upgradeDailyVip(): Promise<VipSignInResult> {
  await bootstrapMobileApi();

  try {
    const response = await mobileApi.youth_day_vip_upgrade({
      userid: getApiSession().userid,
    });
    const body = toRecord(response.body);
    if (pickNumber(body.status) === 1) {
      return { message: '升级成功，获得 1 天概念版 VIP', alreadyDone: false };
    }
    const msg = pickText(body.error_msg);
    return { message: msg || '升级失败，一天仅限一次', alreadyDone: true };
  } catch (error) {
    const code = pickErrorCode(error);
    if (code === 131001) {
      return { message: '你今天已经签到过了', alreadyDone: true };
    }
    if (code === 20028) {
      return { message: '当前账号风控,请前往手机端领取', alreadyDone: true };
    }
    const msg = pickText(toRecord((error as Record<string, unknown>)?.body).error_msg);
    throw new Error(msg || '升级 VIP 失败，一天仅限一次');
  }
}


let launchVipChecked = false;

/**
 * App 启动时自动检测当前账号 VIP 状态：
 * - 是 VIP：弹出剩余小时数提示
 * - 不是 VIP：自动领取并升级，弹出已自动领取提示
 */
export async function autoCheckAndClaimVipOnLaunch(): Promise<void> {
  if (launchVipChecked) {
    return;
  }
  launchVipChecked = true;

  try {
    await bootstrapMobileApi();
    if (!isLoggedIn()) {
      return;
    }

    const profile = await fetchUserProfile();
    if (profile.isVip) {
      if (profile.vipExpireAt && profile.vipExpireAt > Date.now()) {
        const hoursLeft = Math.max(1, Math.round((profile.vipExpireAt - Date.now()) / 3600000));
        showToast(`您当前是vip呢，只剩下${hoursLeft}个小时了`);
      } else {
        showToast("您当前是vip呢");
      }
      return;
    }

    const result = await signInDailyVip();
    if (!result.alreadyDone || result.canUpgrade) {
      if (result.canUpgrade) {
        await upgradeDailyVip().catch(() => undefined);
      }
      showToast("检测到您当前不是VIP已自动帮您领取");
    } else {
      showToast(result.message);
    }
  } catch {
    // 启动静默检测失败不阻断首页使用
  }
}
