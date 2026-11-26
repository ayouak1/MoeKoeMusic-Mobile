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

// 2. Patch AudioTapProcessor.m with real-time C/ObjC DSP (8D auto-pan, 3D, stereo, bass, vocal, live)
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
  memset(&context->bassShelf, 0, sizeof(MoeKoeBiquad));
  memset(&context->vocalPeak, 0, sizeof(MoeKoeBiquad));
  mkSetupLowShelf(&context->bassShelf, sr, 135.0, 6.5);
  mkSetupPeaking(&context->vocalPeak, sr, 2400.0, 0.9, 5.0);
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
      double phaseInc = (2.0 * M_PI * 0.125) / sr;
      int d1 = (int)(sr * 0.017);
      int d2 = (int)(sr * 0.043);
      int d3 = (int)(sr * 0.089);
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
          float pan = sinf((float)context->panPhase);
          context->panPhase += phaseInc;
          if (context->panPhase > 2.0 * M_PI) context->panPhase -= 2.0 * M_PI;
          float angle = (pan + 1.0f) * (float)(M_PI * 0.25);
          float gL = cosf(angle) * 1.15f;
          float gR = sinf(angle) * 1.15f;
          int rIdx = (wIdx - d1 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx2 = (wIdx - d2 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          float rev = 0.14f * (context->delayL[rIdx2] + context->delayR[rIdx2]);
          float mono = (l + r) * 0.52f;
          float outL = mono * gL + context->delayR[rIdx] * 0.16f + rev;
          float outR = mono * gR + context->delayL[rIdx] * 0.16f + rev;
          l = mkClamp(outL);
          r = mkClamp(outR);
        } else if (fxMode == MoeKoeFx3D) {
          int rIdx = (wIdx - d1 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          float mid = (l + r) * 0.5f;
          float side = (l - r) * 0.5f;
          float outL = mid * 0.85f + side * 1.65f + context->delayR[rIdx] * 0.18f;
          float outR = mid * 0.85f - side * 1.65f + context->delayL[rIdx] * 0.18f;
          l = mkClamp(outL);
          r = mkClamp(outR);
        } else if (fxMode == MoeKoeFxStereo) {
          float mid = (l + r) * 0.5f;
          float side = (l - r) * 0.5f;
          l = mkClamp(mid + side * 1.48f);
          r = mkClamp(mid - side * 1.48f);
        } else if (fxMode == MoeKoeFxBass) {
          l *= 0.78f;
          r *= 0.78f;
          mkProcessBiquad(&context->bassShelf, &l, &r);
          l = mkClamp(l);
          r = mkClamp(r);
        } else if (fxMode == MoeKoeFxVocal) {
          l *= 0.86f;
          r *= 0.86f;
          mkProcessBiquad(&context->vocalPeak, &l, &r);
          l = mkClamp(l);
          r = mkClamp(r);
        } else if (fxMode == MoeKoeFxLive) {
          int rIdx1 = (wIdx - d1 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx2 = (wIdx - d2 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          int rIdx3 = (wIdx - d3 + MOEK_REVERB_BUF_SIZE) & (MOEK_REVERB_BUF_SIZE - 1);
          float wetL = 0.20f * context->delayL[rIdx1] + 0.15f * context->delayR[rIdx2] + 0.10f * context->delayL[rIdx3];
          float wetR = 0.20f * context->delayR[rIdx1] + 0.15f * context->delayL[rIdx2] + 0.10f * context->delayR[rIdx3];
          float mid = (l + r) * 0.5f;
          float side = (l - r) * 0.5f;
          l = mkClamp((mid * 0.85f + side * 1.3f) + wetL);
          r = mkClamp((mid * 0.85f - side * 1.3f) + wetR);
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

// 3. Patch AudioPlayer.swift to skip JS event bridge when only DSP FX is active
const playerSwiftPath = path.join(iosDir, "AudioPlayer.swift");
let playerSwift = fs.readFileSync(playerSwiftPath, "utf8");
if (!playerSwift.includes("AudioTapProcessor.currentEffectMode()")) {
  playerSwift = playerSwift.replace(
    "          self.samplingEnabled else {",
    "          self.samplingEnabled,\n          AudioTapProcessor.currentEffectMode() == 0 else {"
  );
  fs.writeFileSync(playerSwiftPath, playerSwift, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioPlayer.swift");
}

// 4. Patch AudioModule.swift to expose setAudioEffectMode
const moduleSwiftPath = path.join(iosDir, "AudioModule.swift");
let moduleSwift = fs.readFileSync(moduleSwiftPath, "utf8");
if (!moduleSwift.includes("setAudioEffectMode")) {
  moduleSwift = moduleSwift.replace(
    `      Function("setAudioSamplingEnabled") { (player, enabled: Bool) in`,
    `      Function("setAudioEffectMode") { (mode: String) in
        AudioTapProcessor.setEffectMode(mode)
      }

      Function("setAudioSamplingEnabled") { (player, enabled: Bool) in`
  );
  fs.writeFileSync(moduleSwiftPath, moduleSwift, "utf8");
  console.log("[patch-ios-audio-fx] Patched AudioModule.swift");
}
