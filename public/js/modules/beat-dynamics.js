(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, num(value, 0)));
  }

  function clampRange(value, min, max) {
    return Math.max(min, Math.min(max, num(value, min)));
  }

  function comboLift(combo) {
    if (combo === 'downbeat') return 0.18;
    if (combo === 'drop') return 0.24;
    if (combo === 'accent') return 0.22;
    if (combo === 'push') return 0.07;
    return 0;
  }

  function readBeat(beat) {
    beat = beat || {};
    var strength = clamp01(beat.strength == null ? 0.72 : beat.strength);
    var confidence = clamp01(beat.confidence == null ? 0.72 : beat.confidence);
    var impact = clamp01(beat.impact == null ? strength : beat.impact);
    var low = clamp01(beat.low == null ? 0.62 : beat.low);
    var body = clamp01(beat.body == null ? 0.22 : beat.body);
    var snap = clamp01(beat.snap == null ? 0.16 : beat.snap);
    var mass = clamp01(beat.mass == null ? (low * 0.72 + body * 0.28) : beat.mass);
    var sharpness = clamp01(beat.sharpness == null ? snap : beat.sharpness);
    return {
      strength: strength,
      confidence: confidence,
      impact: impact,
      low: low,
      body: body,
      snap: snap,
      mass: mass,
      sharpness: sharpness,
      combo: beat.combo || '',
      primary: beat.primary !== false,
      dj: !!beat.dj
    };
  }

  function sectionDrive(options) {
    options = options || {};
    var energy = clamp01(options.sectionEnergy);
    var low = clamp01(options.sectionLow);
    var change = clamp01(options.sectionChange);
    return clamp01(((energy * 0.42 + low * 0.58) - 0.28) / 0.54 + change * 0.16);
  }

  function beatClimaxScore(beat, options) {
    var b = readBeat(beat);
    var lowDrive = clamp01((b.low - 0.34) / 0.52);
    var hitDrive = clamp01((b.impact * 0.56 + b.strength * 0.44 - 0.42) / 0.48);
    var bodyDrive = clamp01((b.body - 0.18) / 0.48);
    var snapAccent = b.combo === 'accent' ? clamp01((b.snap - 0.16) / 0.52) : 0;
    var combo = comboLift(b.combo);
    var section = sectionDrive(options);
    var confidenceGate = 0.74 + b.confidence * 0.26;
    var primaryLift = b.primary ? 0.04 : -0.06;
    var raw = lowDrive * 0.30 + hitDrive * 0.34 + combo * 0.62 + section * 0.18 + bodyDrive * 0.08 + snapAccent * 0.06 + primaryLift;
    if (b.low > 0.70 && b.impact > 0.68) raw += 0.08;
    if (b.combo === 'drop' && b.low > 0.58) raw += 0.06;
    return clamp01(raw * confidenceGate);
  }

  function cameraBeatEnvelope(beat, source, options) {
    options = options || {};
    var b = readBeat(beat);
    var src = source || 'map';
    var climax = beatClimaxScore(b, options);
    var lowDrive = clamp01((b.low - 0.34) / 0.52);
    var impactDrive = clamp01((b.impact - 0.44) / 0.50);
    var bodyDrive = clamp01((b.body - 0.18) / 0.48);
    var snapDrive = clamp01((b.snap - 0.16) / 0.54);
    var sourceLift = src === 'djmap' ? 1.08 : (src === 'live' || src === 'fallback' ? 0.94 : 1);
    var liveTame = src === 'live' || src === 'fallback' ? 0.92 : 1;
    var shakeLift = 0.96 + clamp01(num(options.cinemaShake, 1) / 1.4) * 0.08;

    var ampScale = (1 + climax * 0.34 + lowDrive * 0.12 + impactDrive * 0.08) * sourceLift * shakeLift;
    var zoomScale = 1 + climax * 0.52 + lowDrive * 0.16 + (b.combo === 'downbeat' ? 0.08 : 0);
    var phiScale = 1 + climax * (b.combo === 'drop' ? 0.46 : 0.26) + bodyDrive * 0.18;
    var thetaScale = 1 + climax * 0.18 + bodyDrive * 0.20;
    var rollScale = 1 + climax * 0.24 + snapDrive * 0.22 + (b.combo === 'accent' ? 0.24 : 0);
    var pulseScale = 1 + climax * 0.38 + impactDrive * 0.10 + lowDrive * 0.08;
    var intervalScale = clampRange(1 - climax * 0.34 - lowDrive * 0.06 - (b.combo === 'accent' ? 0.05 : 0), 0.58, 1.05);

    if (src === 'live' || src === 'fallback') {
      ampScale = 1 + (ampScale - 1) * liveTame;
      zoomScale = 1 + (zoomScale - 1) * liveTame;
      phiScale = 1 + (phiScale - 1) * liveTame;
      intervalScale = clampRange(intervalScale, 0.66, 1.05);
    }

    return {
      climax: climax,
      ampScale: clampRange(ampScale, 0.82, b.dj ? 1.46 : 1.38),
      zoomScale: clampRange(zoomScale, 0.88, b.dj ? 1.70 : 1.58),
      phiScale: clampRange(phiScale, 0.90, b.dj ? 1.62 : 1.46),
      thetaScale: clampRange(thetaScale, 0.92, b.dj ? 1.42 : 1.32),
      rollScale: clampRange(rollScale, 0.88, b.dj ? 1.64 : 1.48),
      pulseScale: clampRange(pulseScale, 0.90, b.dj ? 1.50 : 1.42),
      intervalScale: intervalScale,
      attackScale: clampRange(1 - climax * 0.22 - b.sharpness * 0.06, 0.70, 1.04),
      holdScale: clampRange(1 + lowDrive * 0.12 + climax * 0.06, 0.92, 1.18),
      releaseScale: clampRange(1 + lowDrive * 0.10 + climax * 0.14 - snapDrive * 0.08, 0.86, 1.24),
      strongBypass: climax >= 0.64 || (b.impact >= 0.78 && b.low >= 0.58) || (b.combo === 'accent' && b.strength >= 0.78)
    };
  }

  function pulseEnvelope(beat, options) {
    var env = cameraBeatEnvelope(beat || {}, 'pulse', options || {});
    return {
      climax: env.climax,
      pulseScale: env.pulseScale,
      maxPulse: 0.78 + env.climax * 0.16,
      djMaxPulse: 0.92 + env.climax * 0.06
    };
  }

  global.MineradioModules.beatDynamics = {
    beatClimaxScore: beatClimaxScore,
    cameraBeatEnvelope: cameraBeatEnvelope,
    pulseEnvelope: pulseEnvelope
  };
})(typeof window !== 'undefined' ? window : globalThis);
