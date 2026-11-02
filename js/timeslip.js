/**
 * FromForty timeslip. Reads the page's existing speed/time trace and the
 * existing Drag Racing trap projections; it never changes either one.
 *
 * Everything from 40 mph up comes straight off the existing trace:
 *   time to reach v = FromFortyRoll.rollTime(profileDistance, 40, v, profileTrap)
 * and each slip MPH is the page's own projected trap speed for that mark.
 *
 * The trace starts at 40 mph, so the slip adds an ESTIMATED standing-start
 * launch segment (0 to 40 mph). It uses two stated assumptions and no fitted
 * per-car numbers:
 *   1. Traction limit: 1.0 g (tire friction coefficient on dry pavement,
 *      low end of Michelin's published 1.0 to 1.3 range).
 *   2. Power: the trace's own acceleration at 40 mph, a40, read numerically
 *      off rollTime, held as constant power P = a40 * v40 below 40 mph
 *      (a = P / v), the same constant-power basis the roll formula uses.
 * Acceleration below 40 mph is the smaller of the two, so the car is traction
 * limited off the line and power limited once moving, and speed and
 * acceleration both meet the trace at 40 mph with no step. If the trace's
 * own a40 is above 1.0 g (high-power inputs), the grip limit rises linearly
 * with speed from 1.0 g at rest to a40 at 40 mph so there is still no step.
 * The clock starts after a 1-ft rollout, as on a dragstrip.
 */
(function (global) {
  'use strict';

  var Roll = global.FromFortyRoll;
  var G = 9.80665;
  var MPH_TO_MPS = 0.44704;
  var FT_TO_M = 0.3048;
  var HANDOFF_MPH = 40;
  var LAUNCH_GRIP_G = 1.0;
  var ROLLOUT_FT = 1;
  var TRACE_STEP_MPH = 0.05;

  function traceTime(profile, mph) {
    if (!(mph > HANDOFF_MPH)) return 0;
    var r = Roll.rollTime(profile.distance, HANDOFF_MPH, mph, profile.trap);
    return r && r.seconds > 0 ? r.seconds : null;
  }

  // dv/dt of the existing trace right at 40 mph (m/s^2).
  function traceAccelAtHandoff(profile) {
    var dv = 0.001;
    var t = traceTime(profile, HANDOFF_MPH + dv);
    return t > 0 ? dv * MPH_TO_MPS / t : null;
  }

  function bisect(f, lo, hi) {
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* Launch kinematics from rest, in SI. Returns x(t), v(t), and t at 40 mph. */
  function launchModel(a40) {
    var A0 = LAUNCH_GRIP_G * G;
    var v40 = HANDOFF_MPH * MPH_TO_MPS;
    var P = a40 * v40;
    var m = {};
    if (a40 <= A0) {
      // Traction-limited at A0 until P / v falls to A0, then constant power.
      var vs = P / A0;
      var ts = vs / A0;
      var xs = vs * vs / (2 * A0);
      m.mode = 'traction-then-power';
      m.v = function (t) {
        return t <= ts ? A0 * t : Math.sqrt(vs * vs + 2 * P * (t - ts));
      };
      m.x = function (t) {
        if (t <= ts) return 0.5 * A0 * t * t;
        var v = m.v(t);
        return xs + (v * v * v - vs * vs * vs) / (3 * P);
      };
      m.t40 = ts + (v40 * v40 - vs * vs) / (2 * P);
      m.crossoverMph = vs / MPH_TO_MPS;
    } else {
      // Grip limit rises linearly with speed from A0 to a40: dv/dt = A0 + k v.
      var k = (a40 - A0) / v40;
      m.mode = 'grip-ramp';
      m.v = function (t) { return (A0 / k) * (Math.exp(k * t) - 1); };
      m.x = function (t) { return (A0 / k) * ((Math.exp(k * t) - 1) / k - t); };
      m.t40 = Math.log(1 + k * v40 / A0) / k;
      m.crossoverMph = null;
    }
    m.a40 = a40;
    m.A0 = A0;
    return m;
  }

  function build(row, profile) {
    if (!row || !profile || !(profile.trap > 0) || !(profile.distance > 0)) return null;
    var a40 = traceAccelAtHandoff(profile);
    if (!(a40 > 0)) return null;
    var m = launchModel(a40);
    var rollM = ROLLOUT_FT * FT_TO_M;
    var tRoll = bisect(function (t) { return m.x(t) - rollM; }, 0, m.t40);
    var tL = m.t40 - tRoll;                       // 0-40 mph on the slip clock
    var dL = (m.x(m.t40) - rollM) / FT_TO_M;      // feet from the start beam

    // Walk the existing trace from 40 mph and return slip time at X feet.
    function timeAtFeet(X) {
      if (X <= dL) {
        var t = bisect(function (tt) { return m.x(tt) - (X * FT_TO_M + rollM); }, tRoll, m.t40);
        return t - tRoll;
      }
      var feet = dL, prevMph = HANDOFF_MPH, prevT = 0;
      for (var mph = HANDOFF_MPH + TRACE_STEP_MPH; mph < 1000; mph += TRACE_STEP_MPH) {
        var tt2 = traceTime(profile, mph);
        if (tt2 == null) return null;
        var add = ((prevMph + mph) / 2) * (5280 / 3600) * (tt2 - prevT);
        if (feet + add >= X) return tL + prevT + (tt2 - prevT) * (X - feet) / add;
        feet += add; prevMph = mph; prevT = tt2;
      }
      return null;
    }

    function traceFeetTo(targetMph) {
      var feet = 0, prevMph = HANDOFF_MPH, prevT = 0;
      for (var mph = HANDOFF_MPH + TRACE_STEP_MPH; ; mph += TRACE_STEP_MPH) {
        var cur = Math.min(mph, targetMph);
        var tt = traceTime(profile, cur);
        feet += ((prevMph + cur) / 2) * (5280 / 3600) * (tt - prevT);
        prevMph = cur; prevT = tt;
        if (cur >= targetMph) return feet;
      }
    }

    var traps = {};
    (row.dragTraps || []).forEach(function (t) { traps[t.source] = t.trapMph; });

    function etAt(source) {
      var mph = traps[source];
      if (!(mph > HANDOFF_MPH)) return null;
      var t = traceTime(profile, mph);
      return t == null ? null : tL + t;
    }

    var marks = [
      { source: 'eighth', feet: 660 },
      { source: '1000', feet: 1000 },
      { source: 'quarter', feet: 1320 },
      { source: 'half-mile', feet: 2640 },
      { source: 'mile', feet: 5280 }
    ];
    var closure = marks.map(function (mk) {
      var mph = traps[mk.source];
      if (!(mph > HANDOFF_MPH)) return { source: mk.source, feet: mk.feet, traceFeet: null };
      return { source: mk.source, feet: mk.feet, traceFeet: dL + traceFeetTo(mph) };
    });

    return {
      launch: {
        mode: m.mode,
        seconds: tL,
        feet: dL,
        a40g: a40 / G,
        gripG: LAUNCH_GRIP_G,
        crossoverMph: m.crossoverMph,
        rolloutFt: ROLLOUT_FT
      },
      t60: timeAtFeet(60),
      t330: timeAtFeet(330),
      eighthEt: etAt('eighth'),
      eighthMph: traps.eighth == null ? null : traps.eighth,
      thousandEt: etAt('1000'),
      quarterEt: etAt('quarter'),
      quarterMph: traps.quarter == null ? null : traps.quarter,
      halfEt: etAt('half-mile'),
      halfMph: traps['half-mile'] == null ? null : traps['half-mile'],
      mileEt: etAt('mile'),
      mileMph: traps.mile == null ? null : traps.mile,
      closure: closure
    };
  }

  var api = {
    HANDOFF_MPH: HANDOFF_MPH,
    LAUNCH_GRIP_G: LAUNCH_GRIP_G,
    ROLLOUT_FT: ROLLOUT_FT,
    traceAccelAtHandoff: traceAccelAtHandoff,
    launchModel: launchModel,
    build: build
  };
  global.FromFortyTimeslip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
