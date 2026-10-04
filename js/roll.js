/**
 * FromForty trap-to-roll math. Independent of PowerCurve.
 *
 * Trap-only mode
 * --------------
 * Inputs: a trap speed v_t at a timeslip distance D, or a measured 60–130 time.
 * Supported timeslip marks are 660 ft (1/8 mile), 1000 ft, and
 * 1320 ft (1/4 mile). If several are filled, the farthest mark wins.
 *
 * Constant power, no drag:
 *   P = m * v_t^3 / (3 * D)
 *   t0 = (m / (2 P)) * (v2^2 - v1^2)
 *      = (3 D / (2 v_t^3)) * (v2^2 - v1^2), so mass cancels.
 * Reported time is t0 * (v_rms / v_t)^0.229,
 *   v_rms = sqrt((v1^2 + v2^2) / 2).
 * The exponent is the same for every car.
 *
 * The correction is retained from the previous calibration pass. No mass,
 * weight, drag, or other vehicle parameter is used by this calculator.
 */
(function (global) {
  'use strict';

  var FT_TO_M = 0.3048;
  var MPH_TO_MPS = 0.44704;
  var TRAP_MARKS = [
    { key: 'trapEighth', distanceFt: 660, source: 'eighth' },
    { key: 'trap1000', distanceFt: 1000, source: '1000' },
    { key: 'trapQuarter', distanceFt: 1320, source: 'quarter' }
  ];
  var EIGHTH_FT = 660;
  var THOUSAND_FT = 1000;
  var QUARTER_FT = 1320;
  var ROLL_EXPONENT = 0.229;

  function trim(raw) {
    return raw == null ? '' : String(raw).trim();
  }

  function parseNumber(raw) {
    if (typeof raw === 'number') {
      return isFinite(raw) ? { value: raw } : { invalid: true };
    }
    var s = trim(raw);
    if (s === '') return { missing: true };
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return { invalid: true };
    var n = Number(s);
    return isFinite(n) ? { value: n } : { invalid: true };
  }

  /**
   * Resolve which timeslip mark to use. Prefer the farthest filled mark;
   * never average or manufacture a mark that was not entered.
   */
  function resolveTrap(input) {
    input = input || {};
    var parsed = {};
    var issues = [];
    var i;

    for (i = 0; i < TRAP_MARKS.length; i++) {
      var mark = TRAP_MARKS[i];
      var value = parseNumber(input[mark.key]);
      parsed[mark.key] = value;
      if (value.invalid) {
        issues.push(mark.key === 'trapEighth' ? '1/8-mile trap must be a number.' :
          mark.key === 'trap1000' ? '1000-foot trap must be a number.' :
          '1/4-mile trap must be a number.');
      }
      if (value.value != null && !(value.value > 0)) {
        issues.push(mark.key === 'trapEighth' ? '1/8-mile trap must be greater than zero.' :
          mark.key === 'trap1000' ? '1000-foot trap must be greater than zero.' :
          '1/4-mile trap must be greater than zero.');
      }
    }
    if (issues.length) return { ok: false, issues: issues };

    // TRAP_MARKS is ordered from nearest to farthest, so the last present
    // mark is the authoritative one.
    for (i = TRAP_MARKS.length - 1; i >= 0; i--) {
      var chosen = TRAP_MARKS[i];
      var parsedChosen = parsed[chosen.key];
      if (!parsedChosen.missing && parsedChosen.value != null) {
        return {
          ok: true,
          trapMph: parsedChosen.value,
          distanceFt: chosen.distanceFt,
          source: chosen.source,
          note: null
        };
      }
    }
    return { ok: false, issues: ['Enter a timeslip trap speed or a 60–130 time.'] };
  }

  /**
   * Resolve the user input. A measured 60–130 can stand in for a trap, but
   * it must never be turned into a drag trap speed for display.
   */
  function resolveInput(input) {
    input = input || {};
    var hasTrap = TRAP_MARKS.some(function (mark) {
      return !parseNumber(input[mark.key]).missing;
    });

    // A slip mph is authoritative whenever any mark is filled. This also
    // keeps malformed slip input visible instead of silently falling back.
    if (hasTrap) {
      var trap = resolveTrap(input);
      if (!trap.ok) return trap;
      return {
        ok: true,
        mode: 'trap',
        trap: trap,
        referenceSeconds: null
      };
    }

    var time = parseNumber(input.t60_130);
    var issues = [];
    if (time.invalid) issues.push('60–130 time must be a number.');
    if (time.value != null && !(time.value > 0)) {
      issues.push('60–130 time must be greater than zero.');
    }
    if (issues.length) return { ok: false, issues: issues };
    if (time.value != null) {
      return {
        ok: true,
        mode: 'time',
        trap: null,
        referenceSeconds: time.value
      };
    }
    return { ok: false, issues: ['Enter a trap speed or a 60–130 time.'] };
  }

  function carIssues(input) {
    var resolved = resolveInput(input || {});
    return resolved.ok ? [] : resolved.issues;
  }

  /* Net power per unit mass implied by the trap. Mass is intentionally absent. */
  function powerPerMassFromTrap(trapMph, distanceFt) {
    var v = trapMph * MPH_TO_MPS;
    var D = distanceFt * FT_TO_M;
    if (!(v > 0) || !(D > 0)) return null;
    return (v * v * v) / (3 * D);
  }

  function correctRoll(seconds, v0Mph, v1Mph, trapMph) {
    var vRms = Math.sqrt((v0Mph * v0Mph + v1Mph * v1Mph) / 2);
    // t = t0 * (sqrt((v1^2+v2^2)/2) / v_trap)^0.229, one exponent for every car.
    return seconds * Math.pow(vRms / trapMph, ROLL_EXPONENT);
  }

  /**
   * Roll time from trap speed alone. The base equation is mass-cancelling;
   * the retained correction is applied after it.
   */
  function rollTime(distanceFt, v0Mph, v1Mph, trapMph) {
    var v0 = v0Mph * MPH_TO_MPS;
    var v1 = v1Mph * MPH_TO_MPS;
    var vt = trapMph * MPH_TO_MPS;
    var D = distanceFt * FT_TO_M;
    if (!(D > 0) || !(v0 > 0) || !(v1 > v0) || !(vt > 0)) {
      return { seconds: null, note: 'Speed window is not a roll.' };
    }
    var t0 = (3 * D / (2 * vt * vt * vt)) * (v1 * v1 - v0 * v0);
    if (!(t0 > 0) || !isFinite(t0)) {
      return { seconds: null, note: "Didn't reach " + v1Mph + '.' };
    }
    var t = correctRoll(t0, v0Mph, v1Mph, trapMph);
    return isFinite(t) && t > 0
      ? { seconds: t }
      : { seconds: null, note: "Didn't reach " + v1Mph + '.' };
  }

  /**
   * Invert the same corrected roll equation used by rollTime. This is used
   * only to project trap speeds from a measured 60–130; it never creates an
   * elapsed time or an unmeasured track result.
   */
  function trapSpeedFromRollTime(distanceFt, seconds, v0Mph, v1Mph) {
    var D = distanceFt * FT_TO_M;
    var v0 = v0Mph * MPH_TO_MPS;
    var v1 = v1Mph * MPH_TO_MPS;
    var vRms = Math.sqrt((v0Mph * v0Mph + v1Mph * v1Mph) / 2);
    if (!(D > 0) || !(seconds > 0) || !(v0 > 0) || !(v1 > v0) || !(vRms > 0)) {
      return null;
    }
    // rollTime(t) = [3D * (v1²-v0²) / 2] * (vRms/vt)^e / vt³.
    // Keep the velocity units explicit while solving for vt.
    var base = (3 * D / 2) * (v1 * v1 - v0 * v0);
    var vtMps = Math.pow(base * Math.pow(vRms, ROLL_EXPONENT) *
      Math.pow(MPH_TO_MPS, ROLL_EXPONENT) / seconds,
      1 / (3 + ROLL_EXPONENT));
    var trapMph = vtMps / MPH_TO_MPS;
    return isFinite(trapMph) && trapMph > 0 ? trapMph : null;
  }

  // The existing roll model is proportional to
  // (v1² - v0²) * vRms^ROLL_EXPONENT. This lets a measured 60–130 seed all
  // other windows without manufacturing a trap speed.
  function rollTimeFromReference(referenceSeconds, refStartMph, refEndMph, v0Mph, v1Mph) {
    if (!(referenceSeconds > 0) || !(v0Mph > 0) || !(v1Mph > v0Mph)) return null;
    if (!(refStartMph > 0) || !(refEndMph > refStartMph)) return null;
    var refRms = Math.sqrt((refStartMph * refStartMph + refEndMph * refEndMph) / 2);
    var rms = Math.sqrt((v0Mph * v0Mph + v1Mph * v1Mph) / 2);
    var refFactor = (refEndMph * refEndMph - refStartMph * refStartMph) *
      Math.pow(refRms, ROLL_EXPONENT);
    var factor = (v1Mph * v1Mph - v0Mph * v0Mph) *
      Math.pow(rms, ROLL_EXPONENT);
    var seconds = referenceSeconds * factor / refFactor;
    return isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  function runCar(input) {
    input = input || {};
    var resolved = resolveInput(input);
    var issues = resolved.ok ? [] : resolved.issues;
    var empty = {
      t40_60: null,
      t40_80: null,
      t40_100: null,
      t40_120: null,
      t50_100: null,
      t60_100: null,
      t60_120: null,
      t60_130: null,
      t80_120: null,
      t100_130: null,
      t100_150: null,
      t100_180: null,
      t100_200: null,
      t150_200: null
    };
    if (issues.length) {
      return {
        ok: false,
        name: trim(input.name),
        issues: issues,
        notes: empty,
        trapNote: null,
        trapSource: null,
        trapDistanceFt: null,
        trapMph: null,
        inputMode: null,
        powerHp: null,
        t60_130: null,
        t100_150: null
      };
    }

    var trap = resolved.trap;
    var result = {
      ok: true,
      name: trim(input.name),
      issues: [],
      notes: {
        t40_60: null,
        t40_80: null,
        t40_100: null,
        t40_120: null,
        t50_100: null,
        t60_100: null,
        t60_120: null,
        t60_130: null,
        t80_120: null,
        t100_130: null,
        t100_150: null,
        t100_180: null,
        t100_200: null,
        t150_200: null
      },
      trapNote: trap ? trap.note : null,
      trapSource: trap ? trap.source : null,
      trapDistanceFt: trap ? trap.distanceFt : null,
      trapMph: trap ? trap.trapMph : null,
      dragTraps: [],
      powerPerMass: trap ? powerPerMassFromTrap(trap.trapMph, trap.distanceFt) : null,
      powerHp: null,
      mode: trap ? 'trap-only-corrected' : 'measured-60-130',
      inputMode: resolved.mode,
      referenceSeconds: resolved.referenceSeconds,
      t60_130: null,
      t100_150: null
    };
    if (trap) {
      result.dragTraps = [{ source: trap.source, trapMph: trap.trapMph }];
    } else {
      [
        { source: 'eighth', distanceFt: EIGHTH_FT },
        { source: '1000', distanceFt: THOUSAND_FT },
        { source: 'quarter', distanceFt: QUARTER_FT }
      ].forEach(function (mark) {
        var trapMph = trapSpeedFromRollTime(mark.distanceFt, resolved.referenceSeconds, 60, 130);
        if (trapMph != null) result.dragTraps.push({ source: mark.source, trapMph: trapMph });
      });
    }

    var pulls = [
      ['t40_60', 40, 60],
      ['t40_80', 40, 80],
      ['t40_100', 40, 100],
      ['t40_120', 40, 120],
      ['t50_100', 50, 100],
      ['t60_100', 60, 100],
      ['t60_120', 60, 120],
      ['t60_130', 60, 130],
      ['t80_120', 80, 120],
      ['t100_130', 100, 130],
      ['t100_150', 100, 150],
      ['t100_180', 100, 180],
      ['t100_200', 100, 200],
      ['t150_200', 150, 200]
    ];
    for (var i = 0; i < pulls.length; i++) {
      var key = pulls[i][0];
      var roll = trap
        ? rollTime(trap.distanceFt, pulls[i][1], pulls[i][2], trap.trapMph)
        : { seconds: rollTimeFromReference(resolved.referenceSeconds, 60, 130, pulls[i][1], pulls[i][2]) };
      result[key] = roll.seconds;
      result.notes[key] = roll.note || null;
    }
    if (!trap) result.t60_130 = resolved.referenceSeconds;
    return result;
  }

  var api = {
    EIGHTH_FT: EIGHTH_FT,
    THOUSAND_FT: THOUSAND_FT,
    QUARTER_FT: QUARTER_FT,
    TRAP_MARKS: TRAP_MARKS,
    rollTime: rollTime,
    trapSpeedFromRollTime: trapSpeedFromRollTime,
    rollTimeFromReference: rollTimeFromReference,
    ROLL_EXPONENT: ROLL_EXPONENT,
    resolveTrap: resolveTrap,
    resolveInput: resolveInput,
    carIssues: carIssues,
    runCar: runCar
  };

  global.FromFortyRoll = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
