import fs from "node:fs";
import path from "node:path";

const iosDir = path.resolve("node_modules/expo-audio/ios");
if (!fs.existsSync(iosDir)) {
  console.log("[patch-ios-audio-fx] expo-audio/ios not found, skipping.");
  process.exit(0);
}

// 1. Patch AudioTapProcessor.h
const headerPath = path.join(iosDir, "AudioTapProcessor.h");
let header = fs.readFileSync(headerPath, "utf8");
if (!header.includes("setEffectMode:")) {
  header = header.replace(
    "- (void)invalidate;",
    `- (void)invalidate;
+ (void)setEffectMode:(NSString *)mode;
+ (NSInteger)currentEffectMode;`
  );
  fs.writeFileSync(headerPath, header, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioTapProcessor.h");
}

// 2. Patch AudioTapProcessor.m with Binaural HRTF 8D + 3D + Stereo + EQ + Live DSP
const implPath = path.join(iosDir, "AudioTapProcessor.m");
let impl = fs.readFileSync(implPath, "utf8");
if (!impl.includes("setEffectMode:")) {
  const dspImportsAndGlobals = `#import "AudioTapProcessor.h"
#import <AudioToolbox/AudioToolbox.h>
#import <os/lock.h>
#import <math.h>
#import <stdatomic.h>

typedef NS_ENUM(NSInteger, MoeKoeFxMode) {
  MoeKoeFxOff = 0,
  MoeKoeFx8D = 1,
  MoeKoeFx3D = 2,
  MoeKoeFxStereo = 3,
  MoeKoeFxBass = 4,
  MoeKoeFxVocal = 5,
  MoeKoeFxLive = 6,
};

static atomic_int g_moekoeFxMode = MoeKoeFxOff;

#define MOEK_REVERB_BUF_SIZE 16384
#define MOEK_ITD_BUF_SIZE 128

typedef struct MoeKoeBiquad {
  float b0, b1, b2, a1, a2;
  float x1L, x2L, y1L, y2L;
  float x1R, x2R, y1R, y2R;
} MoeKoeBiquad;

static inline float mkClamp(float v) {
  if (v > 0.99f) return 0.99f;
  if (v < -0.99f) return -0.99f;
  return v;
}

static inline float mkSoftLimit(float v) {
  return tanhf(v * 0.92f);
}

static inline float mkReadFracDelay(const float *buf, int writeIdx, float delaySamples) {
  if (delaySamples < 0.0f) delaySamples = 0.0f;
  if (delaySamples > (float)(MOEK_ITD_BUF_SIZE - 2)) delaySamples = (float)(MOEK_ITD_BUF_SIZE - 2);
  int d0 = (int)delaySamples;
  float frac = delaySamples - (float)d0;
  int idx0 = (writeIdx - d0 + MOEK_ITD_BUF_SIZE) & (MOEK_ITD_BUF_SIZE - 1);
  int idx1 = (writeIdx - d0 - 1 + MOEK_ITD_BUF_SIZE) & (MOEK_ITD_BUF_SIZE - 1);
  return buf[idx0] * (1.0f - frac) + buf[idx1] * frac;
}

static void mkSetupLowShelf(MoeKoeBiquad *bq, double sampleRate, double freq, double gainDb) {
  double A = pow(10.0, gainDb / 40.0);
  double w0 = 2.0 * M_PI * freq / sampleRate;
  double cosw0 = cos(w0);
  double sinw0 = sin(w0);
  double alpha = sinw0 / 2.0 * sqrt(2.0);
  double sqrtA2Alpha = 2.0 * sqrt(A) * alpha;
  double a0 = (A + 1.0) + (A - 1.0) * cosw0 + sqrtA2Alpha;
  bq->b0 = (float)((A * ((A + 1.0) - (A - 1.0) * cosw0 + sqrtA2Alpha)) / a0);
  bq->b1 = (float)((2.0 * A * ((A - 1.0) - (A + 1.0) * cosw0)) / a0);
  bq->b2 = (float)((A * ((A + 1.0) - (A - 1.0) * cosw0 - sqrtA2Alpha)) / a0);
  bq->a1 = (float)((-2.0 * ((A - 1.0) + (A + 1.0) * cosw0)) / a0);
  bq->a2 = (float)(((A + 1.0) + (A - 1.0) * cosw0 - sqrtA2Alpha) / a0);
}

static void mkSetupPeaking(MoeKoeBiquad *bq, double sampleRate, double freq, double q, double gainDb) {
  double A = pow(10.0, gainDb / 40.0);
  double w0 = 2.0 * M_PI * freq / sampleRate;
  double cosw0 = cos(w0);
  double sinw0 = sin(w0);
  double alpha = sinw0 / (2.0 * q);
  double a0 = 1.0 + alpha / A;
  bq->b0 = (float)((1.0 + alpha * A) / a0);
  bq->b1 = (float)((-2.0 * cosw0) / a0);
  bq->b2 = (float)((1.0 - alpha * A) / a0);
  bq->a1 = (float)((-2.0 * cosw0) / a0);
  bq->a2 = (float)((1.0 - alpha / A) / a0);
}

static inline void mkProcessBiquad(MoeKoeBiquad *bq, float *l, float *r) {
  float inL = *l;
  float outL = bq->b0 * inL + bq->b1 * bq->x1L + bq->b2 * bq->x2L - bq->a1 * bq->y1L - bq->a2 * bq->y2L;
  bq->x2L = bq->x1L; bq->x1L = inL;
  bq->y2L = bq->y1L; bq->y1L = outL;
  *l = outL;

  float inR = *r;
  float outR = bq->b0 * inR + bq->b1 * bq->x1R + bq->b2 * bq->x2R - bq->a1 * bq->y1R - bq->a2 * bq->y2R;
  bq->x2R = bq->x1R; bq->x1R = inR;
  bq->y2R = bq->y1R; bq->y1R = outR;
  *r = outR;
}`;

  impl = impl.replace(
    `#import "AudioTapProcessor.h"
#import <AudioToolbox/AudioToolbox.h>
#import <os/lock.h>`,
    dspImportsAndGlobals
  );

  impl = impl.replace(
    `typedef struct AVAudioTapProcessorContext {
  Boolean isNonInterleaved;
  Boolean supportedTapProcessingFormat;
  void *self;
  Boolean isValid;
} AVAudioTapProcessorContext;`,
    `typedef struct AVAudioTapProcessorContext {
  Boolean isNonInterleaved;
  Boolean supportedTapProcessingFormat;
  void *self;
  Boolean isValid;
  double sampleRate;
  double panPhase;
  float delayL[MOEK_REVERB_BUF_SIZE];
  float delayR[MOEK_REVERB_BUF_SIZE];
  int delayWriteIdx;
  float itdBufL[MOEK_ITD_BUF_SIZE];
  float itdBufR[MOEK_ITD_BUF_SIZE];
  int itdWriteIdx;
  float headShadowL;
  float headShadowR;
  float backWarmL;
  float backWarmR;
  MoeKoeBiquad bassShelf;
  MoeKoeBiquad vocalPeak;
} AVAudioTapProcessorContext;`
  );

  impl = impl.replace(
    `- (instancetype)initWithPlayer:(AVPlayer *)player {`,
    `+ (void)setEffectMode:(NSString *)mode {
  MoeKoeFxMode next = MoeKoeFxOff;
  if ([mode isEqualToString:@"8d"]) next = MoeKoeFx8D;
  else if ([mode isEqualToString:@"3d"]) next = MoeKoeFx3D;
  else if ([mode isEqualToString:@"stereo"]) next = MoeKoeFxStereo;
  else if ([mode isEqualToString:@"bass"]) next = MoeKoeFxBass;
  else if ([mode isEqualToString:@"vocal"]) next = MoeKoeFxVocal;
  else if ([mode isEqualToString:@"live"]) next = MoeKoeFxLive;
  atomic_store(&g_moekoeFxMode, (int)next);
}

+ (NSInteger)currentEffectMode {
  return (NSInteger)atomic_load(&g_moekoeFxMode);
}

- (instancetype)initWithPlayer:(AVPlayer *)player {`
  );

  impl = impl.replace(
    `  AVAssetTrack *track = _player.currentItem.tracks.firstObject.assetTrack;`,
    `  AVAssetTrack *track = _player.currentItem.tracks.firstObject.assetTrack;
  if (!track) {
    track = [_player.currentItem.asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
  }`
  );

  impl = impl.replace(
    `  if (processingFormat->mFormatFlags & kAudioFormatFlagIsNonInterleaved) {
    context->isNonInterleaved = true;
  }
}`,
    `  if (processingFormat->mFormatFlags & kAudioFormatFlagIsNonInterleaved) {
    context->isNonInterleaved = true;
  }
  double sr = processingFormat->mSampleRate > 0 ? processingFormat->mSampleRate : 44100.0;
  context->sampleRate = sr;
  context->panPhase = 0.0;
  context->delayWriteIdx = 0;
  context->itdWriteIdx = 0;
  context->headShadowL = 0.0f;
  context->headShadowR = 0.0f;
  context->backWarmL = 0.0f;
  context->backWarmR = 0.0f;
  memset(&context->bassShelf, 0, sizeof(MoeKoeBiquad));
  memset(&context->vocalPeak, 0, sizeof(MoeKoeBiquad));
  mkSetupLowShelf(&context->bassShelf, sr, 135.0, 7.0);
  mkSetupPeaking(&context->vocalPeak, sr, 2400.0, 0.9, 5.5);
}`
  );

  const fxProcessSnippet = `  if (!context || !context->isValid || !context->self) {
    return;
  }

  int fxMode = atomic_load(&g_moekoeFxMode);
  if (fxMode != MoeKoeFxOff && bufferListInOut && numberFrames > 0) {
    BOOL nonInterleaved = context->isNonInterleaved;
    Float32 *left = NULL;
    Float32 *right = NULL;
    int stride = 1;
    if (nonInterleaved && bufferListInOut->mNumberBuffers >= 2) {
      left = (Float32 *)bufferListInOut->mBuffers[0].mData;
      right = (Float32 *)bufferListInOut->mBuffers[1].mData;
      stride = 1;
    } else if (!nonInterleaved && bufferListInOut->mNumberBuffers >= 1 && bufferListInOut->mBuffers[0].mNumberChannels >= 2) {
      Float32 *interleaved = (Float32 *)bufferListInOut->mBuffers[0].mData;
      left = interleaved;
      right = interleaved + 1;
      stride = (int)bufferListInOut->mBuffers[0].mNumberChannels;
    }

    if (left && right) {
      double sr = context->sampleRate > 0 ? context->sampleRate : 44100.0;
      double phaseInc = (2.0 * M_PI / 9.5) / sr;
      float maxItdSamples = (float)(sr * 0.00065);
      int d1 = (int)(sr * 0.019);
      int d2 = (int)(sr * 0.047);
      int d3 = (int)(sr * 0.093);
      if (d1 >= MOEK_REVERB_BUF_SIZE) d1 = MOEK_REVERB_BUF_SIZE - 1;
      if (d2 >= MOEK_REVERB_BUF_SIZE) d2 = MOEK_REVERB_BUF_SIZE - 1;
      if (d3 >= MOEK_REVERB_BUF_SIZE) d3 = MOEK_REVERB_BUF_SIZE - 1;

      for (CMItemCount i = 0; i < numberFrames; i++) {
        int idx = (int)i * stride;
        float l = left[idx];
        float r = right[idx];

        int wIdx = context->delayWriteIdx;
        context->delayL[wIdx] = l;
        context->delayR[wIdx] = r;

        if (fxMode == MoeKoeFx8D) {
          float theta = (float)context->panPhase;
          context->panPhase += phaseInc;
          if (context->panPhase >= 2.0 * M_PI) context->panPhase -= 2.0 * M_PI;

          float azSin = sinf(theta);
          float azCos = cosf(theta);

          // 1. 等功率 Mid/Side 编码，保持立体声细节的同时聚焦旋转声像
          float mid = (l + r) * 0.7071f;
          float side = (l - r) * 0.7071f;
          float srcL = mid + side * 0.45f;
          float srcR = mid - side * 0.45f;

          int iw = context->itdWriteIdx;
          context->itdBufL[iw] = srcL;
          context->itdBufR[iw] = srcR;

          // 2. 双耳 ITD（耳间时间差，最大 ±0.65ms 亚毫秒线性插值延迟）
          float itdL = azSin > 0.0f ? azSin * maxItdSamples : 0.0f;
          float itdR = azSin < 0.0f ? (-azSin) * maxItdSamples : 0.0f;
          float earL = mkReadFracDelay(context->itdBufL, iw, itdL);
          float earR = mkReadFracDelay(context->itdBufR, iw, itdR);
          context->itdWriteIdx = (iw + 1) & (MOEK_ITD_BUF_SIZE - 1);

          // 3. ILD + 头影效应动态高频衰减（远耳高频滚降）
          float angle = (azSin + 1.0f) * (float)(M_PI * 0.25);
          float gL = 0.28f + 0.84f * cosf(angle);
          float gR = 0.28f + 0.84f * sinf(angle);
          float alphaL = 0.92f - 0.62f * fmaxf(0.0f, azSin);
          float alphaR = 0.92f - 0.62f * fmaxf(0.0f, -azSin);
          context->headShadowL += alphaL * (earL - context->headShadowL);
          context->headShadowR += alphaR * (earR - context->headShadowR);
          float binL = context->headShadowL * gL;
          float binR = context->headShadowR * gR;

          // 4. 前后方耳廓深度感（声源绕到脑后时轻微柔化高频并加大空间反射）
          float backAmt = fmaxf(0.0f, -azCos);
          context->backWarmL += 0.35f * (binL - context->backWarmL);
          context->backWarmR += 0.35f * (binR - context->backWarmR);
          binL = binL * (1.0f - 0.28f * backAmt) + context->backWarmL * (0.28f * backAmt);
          binR = binR * (1.0f - 0.28f * backAmt) + context->backWarmR * (0.28f * backAmt);

          // 5. 早期反射 + 空间混响 + 软限幅防削波
          int rIdx1 = (wIdx - d1 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx2 = (wIdx - d2 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx3 = (wIdx - d3 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          float revGain = 0.14f + 0.10f * backAmt;
          float wetL = revGain * (0.50f * context->delayR[rIdx1] + 0.32f * context->delayL[rIdx2] + 0.18f * context->delayR[rIdx3]);
          float wetR = revGain * (0.50f * context->delayL[rIdx1] + 0.32f * context->delayR[rIdx2] + 0.18f * context->delayL[rIdx3]);
          l = mkSoftLimit(binL * 0.86f + wetL);
          r = mkSoftLimit(binR * 0.86f + wetR);
        } else if (fxMode == MoeKoeFx3D) {
          int rIdx = (wIdx - d1 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          float mid = (l + r) * 0.5f;
          float side = (l - r) * 0.5f;
          l = mkSoftLimit(mid * 0.75f + side * 1.95f + context->delayR[rIdx] * 0.16f);
          r = mkSoftLimit(mid * 0.75f - side * 1.95f + context->delayL[rIdx] * 0.16f);
        } else if (fxMode == MoeKoeFxStereo) {
          float mid = (l + r) * 0.5f;
          float side = (l - r) * 0.5f;
          l = mkSoftLimit(mid + side * 1.65f);
          r = mkSoftLimit(mid - side * 1.65f);
        } else if (fxMode == MoeKoeFxBass) {
          l *= 0.76f;
          r *= 0.76f;
          mkProcessBiquad(&context->bassShelf, &l, &r);
          l = mkClamp(l);
          r = mkClamp(r);
        } else if (fxMode == MoeKoeFxVocal) {
          l *= 0.85f;
          r *= 0.85f;
          mkProcessBiquad(&context->vocalPeak, &l, &r);
          l = mkClamp(l);
          r = mkClamp(r);
        } else if (fxMode == MoeKoeFxLive) {
          int rIdx1 = (wIdx - d1 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx2 = (wIdx - d2 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx3 = (wIdx - d3 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          float wetL = 0.22f * context->delayL[rIdx1] + 0.16f * context->delayR[rIdx2] + 0.11f * context->delayL[rIdx3];
          float wetR = 0.22f * context->delayR[rIdx1] + 0.16f * context->delayL[rIdx2] + 0.11f * context->delayR[rIdx3];
          float mid = (l + r) * 0.5f;
          float side = (l - r) * 0.5f;
          l = mkSoftLimit((mid * 0.82f + side * 1.35f) + wetL);
          r = mkSoftLimit((mid * 0.82f - side * 1.35f) + wetR);
        }

        left[idx] = l;
        right[idx] = r;
        context->delayWriteIdx = (wIdx + 1) & (MOEK_REVERB_BUF_SIZE - 1);
      }
    }
  }`;

  impl = impl.replace(
    `  if (!context || !context->isValid || !context->self) {
    return;
  }`,
    fxProcessSnippet
  );

  fs.writeFileSync(implPath, impl, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioTapProcessor.m");
}

// 3. Patch AudioPlayer.swift:
//    - Skip JS event bridge when only DSP FX is active
//    - Retry installTap() in periodic timeObserver when remote tracks finish loading
const playerSwiftPath = path.join(iosDir, "AudioPlayer.swift");
let playerSwift = fs.readFileSync(playerSwiftPath, "utf8");
if (!playerSwift.includes("AudioTapProcessor.currentEffectMode()")) {
  playerSwift = playerSwift.replace(
    "          self.samplingEnabled else {",
    "          self.samplingEnabled,\n          AudioTapProcessor.currentEffectMode() == 0 else {"
  );
  fs.writeFileSync(playerSwiftPath, playerSwift, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioPlayer.swift (skip JS emit)");
}
if (!playerSwift.includes("retry installTap when tracks become ready")) {
  playerSwift = playerSwift.replace(
    "      self.updateStatus(with: [",
    `      // retry installTap when tracks become ready
      if (self.samplingEnabled || AudioTapProcessor.currentEffectMode() != 0),
         self.audioProcessor?.isTapInstalled != true,
         self.isLoaded {
        self.installTap()
      }
      self.updateStatus(with: [`
  );
  fs.writeFileSync(playerSwiftPath, playerSwift, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioPlayer.swift (auto-retry installTap)");
}

// 4. Patch AudioModule.swift to expose setAudioEffectMode at module level (before Class(AudioPlayer.self))
const moduleSwiftPath = path.join(iosDir, "AudioModule.swift");
let moduleSwift = fs.readFileSync(moduleSwiftPath, "utf8");
// Remove any old misplaced definition if re-running locally
moduleSwift = moduleSwift.replace(
  /\n      Function\("setAudioEffectMode"\) \{ \(mode: String\) in\n        AudioTapProcessor\.setEffectMode\(mode\)\n      \}\n/g,
  "\n"
);
if (!moduleSwift.includes('Function("setAudioEffectMode")')) {
  moduleSwift = moduleSwift.replace(
    "    Class(AudioPlayer.self) {",
    `    Function("setAudioEffectMode") { (mode: String) in
      AudioTapProcessor.setEffectMode(mode)
    }

    Class(AudioPlayer.self) {`
  );
  fs.writeFileSync(moduleSwiftPath, moduleSwift, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioModule.swift (module-level)");
}
