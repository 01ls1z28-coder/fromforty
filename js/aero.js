/**
 * FromForty aero model (local branch timeslip-aero).
 *
 * One measured input (a trap mph at 660/1000/1320 ft, or a measured 60-130 /
 * 100-150) sets the car's power-to-mass p. Everything else is physics:
 *
 *   dv/dt = [ p / v  -  k v^2  -  Crr g ] / MF(v)
 *     k  = 0.5 * rho * Cd * A / m           aerodynamic drag per unit mass
 *     rho = 1.225 kg/m^3                    ISA sea-level air density
 *     Crr = 0.012                           typical car tire on asphalt (0.010-0.015)
 *     MF(v) = 1.04 + 0.0025 * N^2           Gillespie rotating-mass factor,
 *       N = overall gear ratio = min(14, 222.5 / v[m/s])  (engine held near
 *       peak power; 222.5 m/s = 6,350 rpm on a 13.2 in tire radius).
 *       No separate EV term: EV-specific launch/inertia terms were tested and
 *       made the EV checks worse, so EVs run as their drivetrain.
 *
 * Drivetrain (launch only, Gillespie traction-limited acceleration with
 * longitudinal weight transfer, h/L = 0.553 m / 2.753 m):
 *   RWD a = mu*Wr/(1 - mu*h/L)   FWD a = mu*Wf/(1 + mu*h/L)   AWD a = AWD_FACTOR*mu
 *   AWD_FACTOR = realised share of the ideal four-wheel limit (fixed torque
 *   split + weight transfer leave one axle short of its limit); one class-wide
 *   value fitted on published gas and EV AWD tests (see VERIFY).
 *   The RWD launch grip (1.0 g x tire/prep) fixes the effective mu with a 45%
 *   rear static share (MotorTrend 2024 Mustang GT 55/45). RWD is unchanged by construction.
 *   FWD uses an EFFECTIVE front share of 0.48 (static share is ~0.62, MotorTrend
 *   Civic Type R / GTI 62/38): wheelspin, traction control and torque steer keep
 *   a street FWD launch well short of the static-share limit. Fitted with
 *   leave-one-out on 26 published FWD tests (see fromforty-accuracy-fixes-VERIFY).
 *   FWD drag uses a 3,375 lb default mass instead of 4,050 lb: this is a weight
 *   effect (C/D curb weights of the FWD set average 3,233 lb; + driver/gear),
 *   and the class-wide fit (drag x1.2 = 4050/3375) matches it.
 *
 * Below 40 mph the same equation runs, capped by launch grip:
 *   a <= gripG(v) * g - k v^2 - Crr g.  Base grip 1.0 g, scaled by the PowerCurve
 *   tire/prep mu ladder relative to Street + Unprepped (so the defaults give
 *   exactly 1.0 g). If the power-limited push at 40 mph needs more than the
 *   grip, the grip limit ramps linearly to that value at 40 mph: no step.
 *
 * Power is always solved with the DEFAULT launch (Street, Unprepped), so the
 * 40+ trace, every roll window and every projected trap depend only on the
 * measured input and Cd/area/weight. Tire and prep only re-time 0-40 mph.
 *
 * Trap mph = average speed over the last 66 ft before the mark (NHRA style).
 * The clock starts after a 1-ft rollout. No reaction time.
 */
(function (global) {
  'use strict';

  var Roll = global.FromFortyRoll;
  var G = 9.80665, MPS = 0.44704, FT = 0.3048, LB = 0.45359237, SQFT = 0.09290304;
  var RHO = 1.225, CRR = 0.012;
  var DEFAULTS = { cd: 0.33, areaSqft: 24.2, weightLb: 4050, weightLbFwd: 3375 };
  var MF_WR = 222.5, MF_NMAX = 14;
  var H_OVER_L = 0.553 / 2.753, RWD_REAR = 0.45, FWD_FRONT = 0.48;
  var DRIVETRAINS = { rwd: 'RWD', fwd: 'FWD', awd: 'AWD' };
  var AWD_FACTOR = 0.87;
  var BASE_GRIP_G = 1.0, HANDOFF_MPH = 40, ROLLOUT_FT = 1, TRAP_SPAN_FT = 66;
  var MAX_MPH = 200.5, MAX_FT = 5300;

  // Copied exactly from PowerCurve js/physics.js TIRE_MU_BY_PREP (live 15e74e3).
  var TIRE_MU_BY_PREP = {
    unprepped: { 0: 1.143, 3: 1.187, 4: 1.305, 2: 1.331, 5: 1.362, 1: 1.509 },
    prepped:   { 0: 1.253, 3: 1.284, 4: 1.371, 5: 1.435, 1: 1.650, 2: 1.700 }
  };
  var TIRE_LABELS = { 0: 'Street', 1: 'Drag Radial', 2: 'Slick', 3: 'Summer', 4: 'UHP', 5: 'R-Compound' };
  var TIRE_ORDER = [0, 3, 4, 5, 1, 2];   // PowerCurve <select> order
  var REF_MU = TIRE_MU_BY_PREP.unprepped[0];

  function normalizePrep(p) {
    p = String(p == null ? 'unprepped' : p).toLowerCase();
    return (p === 'prepped' || p === 'prep') ? 'prepped' : 'unprepped';
  }
  function tireMu(tire, prep) {
    var t = TIRE_MU_BY_PREP[normalizePrep(prep)];
    var mu = t[(tire == null || tire === '' ? 0 : Number(tire)) | 0];
    return mu != null ? mu : t[0];
  }
  function launchGripG(tire, prep) { return BASE_GRIP_G * tireMu(tire, prep) / REF_MU; }

  function normalizeDrive(d) { d = String(d == null ? 'rwd' : d).toLowerCase(); return DRIVETRAINS[d] ? d : 'rwd'; }

  /* Launch grip (g) for a drivetrain, from the RWD-equivalent tire grip. */
  function driveGripG(rwdG, drive) {
    drive = normalizeDrive(drive);
    if (drive === 'rwd') return rwdG;
    var mu = rwdG / (RWD_REAR + rwdG * H_OVER_L);          // effective mu behind the RWD figure
    if (drive === 'awd') return AWD_FACTOR * mu;
    return mu * FWD_FRONT / (1 + mu * H_OVER_L);
  }

  function interp(A, B, a) {
    var n = A.length; if (!n || a < A[0] || a > A[n - 1]) return null;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (A[m] < a) lo = m; else hi = m; }
    var d = A[hi] - A[lo];
    return B[lo] + (B[hi] - B[lo]) * (d ? (a - A[lo]) / d : 0);
  }

  function mfGas(v) { var N = Math.min(MF_NMAX, v > 0.1 ? MF_WR / v : MF_NMAX); return 1.04 + 0.0025 * N * N; }
  function accelFn(p, k, gripG) {
    var mfAt = mfGas;
    var c = CRR * G, v40 = HANDOFF_MPH * MPS, A0 = gripG * G;
    function aPow(v) { return (p / Math.max(v, 1e-6) - k * v * v - c) / mfAt(v); }
    var need40 = aPow(v40) + k * v40 * v40 + c;
    var ramp = need40 > A0;
    return function (v) {
      if (v >= v40) return aPow(v);
      var grip = ramp ? A0 + (need40 - A0) * (v / v40) : A0;
      return Math.min(grip - k * v * v - c, aPow(v));
    };
  }

  /* RK4 from rest. stop(t,x,v) ends early (used while solving). */
  function simulate(p, k, gripG, stop) {
    var acc = accelFn(p, k, gripG);
    var T = [0], X = [0], V = [0], t = 0, x = 0, v = 0;
    while (t < 400) {
      var dt = t < 4 ? 0.002 : (t < 30 ? 0.01 : 0.05);
      var k1 = acc(v), k2 = acc(v + 0.5 * dt * k1), k3 = acc(v + 0.5 * dt * k2), k4 = acc(v + dt * k3);
      var nv = v + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
      x += dt / 6 * (v + 2 * (v + 0.5 * dt * k1) + 2 * (v + 0.5 * dt * k2) + (v + dt * k3));
      v = nv; t += dt;
      T.push(t); X.push(x); V.push(v);
      if (k4 <= 1e-4 && v > 1) break;                     // at top speed
      if (stop && stop(t, x, v)) break;
      if (v >= MAX_MPH * MPS && x >= (MAX_FT + ROLLOUT_FT) * FT) break;
    }
    var run = { T: T, X: X, V: V, p: p, k: k, gripG: gripG, rollM: ROLLOUT_FT * FT };
    run.t0 = interp(X, T, run.rollM);
    run.t40 = interp(V, T, HANDOFF_MPH * MPS);
    run.x40 = run.t40 == null ? null : interp(T, X, run.t40);
    return run;
  }

  function etAt(run, ft) { var t = interp(run.X, run.T, run.rollM + ft * FT); return t == null ? null : t - run.t0; }
  function trapAt(run, ft) {
    var a = etAt(run, ft - TRAP_SPAN_FT), b = etAt(run, ft);
    return a == null || b == null ? null : (TRAP_SPAN_FT / (b - a)) * 3600 / 5280;
  }
  function tAtMph(run, mph) { return interp(run.V, run.T, mph * MPS); }
  function rollSec(run, a, b) { var x = tAtMph(run, a), y = tAtMph(run, b); return x == null || y == null ? null : y - x; }

  function solveP(k, metric, target, slowerWhenHigher, stopFor) {
    var lo = 1, hi = 8000;
    for (var i = 0; i < 48; i++) {
      var m = Math.sqrt(lo * hi);
      var val = metric(simulate(m, k, BASE_GRIP_G, stopFor));
      var tooWeak = slowerWhenHigher ? (val == null || val > target) : (val == null || val < target);
      if (tooWeak) lo = m; else hi = m;
    }
    return Math.sqrt(lo * hi);
  }

  function parseOpt(raw, lo, hi, label, issues) {
    var s = raw == null ? '' : String(raw).trim();
    if (s === '') return null;
    var n = Number(s);
    if (!isFinite(n) || n < lo || n > hi) { issues.push(label + ' must be between ' + lo + ' and ' + hi + '.'); return null; }
    return n;
  }

  function vehicleOf(input, issues) {
    var cd = parseOpt(input.cd, 0.1, 1.5, 'Drag coefficient (Cd)', issues);
    var area = parseOpt(input.areaSqft, 5, 80, 'Frontal area (sq ft)', issues);
    // Weight is no longer an input (Jorge: redundant); drag uses the default.
    var wt = null, drive = normalizeDrive(input.drive);
    var veh = {
      cd: cd == null ? DEFAULTS.cd : cd, cdDefault: cd == null,
      areaSqft: area == null ? DEFAULTS.areaSqft : area, areaDefault: area == null,
      weightLb: wt == null ? (drive === 'fwd' ? DEFAULTS.weightLbFwd : DEFAULTS.weightLb) : wt, weightDefault: wt == null,
      tire: input.tire == null || input.tire === '' ? 0 : (Number(input.tire) | 0),
      prep: normalizePrep(input.prep),
      drive: normalizeDrive(input.drive)
    };
    veh.k = 0.5 * RHO * veh.cd * veh.areaSqft * SQFT / (veh.weightLb * LB);
    veh.rwdGripG = launchGripG(veh.tire, veh.prep);
    veh.gripG = driveGripG(veh.rwdGripG, veh.drive);
    veh.driveLabel = DRIVETRAINS[veh.drive];
    veh.tireLabel = TIRE_LABELS[veh.tire] || TIRE_LABELS[0];
    veh.prepLabel = veh.prep === 'prepped' ? 'Prepped' : 'Unprepped';
    return veh;
  }

  var PULLS = [
    ['t40_60', 40, 60], ['t40_80', 40, 80], ['t40_100', 40, 100], ['t40_120', 40, 120],
    ['t50_100', 50, 100], ['t60_100', 60, 100], ['t60_120', 60, 120], ['t60_130', 60, 130],
    ['t80_120', 80, 120], ['t100_130', 100, 130], ['t100_150', 100, 150], ['t100_180', 100, 180],
    ['t100_200', 100, 200], ['t150_200', 150, 200]
  ];
  var MARKS = [
    { source: 'eighth', ft: 660 }, { source: '1000', ft: 1000 }, { source: 'quarter', ft: 1320 },
    { source: 'half-mile', ft: 2640 }, { source: 'mile', ft: 5280 }
  ];

  /* Same row shape as FromFortyRoll.runCar, numbers from the aero run. */
  function runCar(input) {
    input = input || {};
    var row = Roll.runCar(input);
    var issues = [];
    var veh = vehicleOf(input, issues);
    if (issues.length) { row.ok = false; row.issues = (row.issues || []).concat(issues); }
    if (!row.ok) return row;
    var resolved = Roll.resolveInput(input);
    var p;
    if (resolved.mode === 'trap') {
      var D = resolved.trap.distanceFt;
      p = solveP(veh.k, function (r) { return trapAt(r, D); }, resolved.trap.trapMph, false,
        function (t, x) { return x > (D + ROLLOUT_FT + 1) * FT; });
    } else {
      var a = resolved.referenceStartMph, b = resolved.referenceEndMph;
      p = solveP(veh.k, function (r) { return rollSec(r, a, b); }, resolved.referenceSeconds, true,
        function (t, x, v) { return v > (b + 0.5) * MPS; });
    }
    var run = simulate(p, veh.k, BASE_GRIP_G, null);
    var top = run.V[run.V.length - 1] / MPS;

    PULLS.forEach(function (pl) {
      var s = rollSec(run, pl[1], pl[2]);
      row[pl[0]] = s;
      row.notes[pl[0]] = s == null ? 'Tops out ' + top.toFixed(0) + ' mph' : null;
    });
    if (resolved.mode === 'time') row[resolved.referenceKey] = resolved.referenceSeconds;

    row.dragTraps = [];
    MARKS.forEach(function (mk) {
      var mph = trapAt(run, mk.ft);
      var entered = resolved.mode === 'trap' && mk.source === resolved.trap.source;
      if (entered) mph = resolved.trap.trapMph;
      if (mph != null) row.dragTraps.push({
        source: mk.source, trapMph: mph, projected: !entered,
        fromSource: resolved.mode === 'trap' ? resolved.trap.source : resolved.referenceLabel
      });
    });

    // 40+ trace, measured from the moment the car passes 40 mph.
    var i40 = 0; while (i40 < run.V.length && run.V[i40] < HANDOFF_MPH * MPS) i40++;
    var tt = [0], xx = [0], vv = [HANDOFF_MPH * MPS];
    for (var i = i40; i < run.V.length; i++) { tt.push(run.T[i] - run.t40); xx.push(run.X[i] - run.x40); vv.push(run.V[i]); }
    var trace = {
      maxMph: top,
      seconds: function (mph) { if (mph <= HANDOFF_MPH) return 0; return interp(vv, tt, mph * MPS); },
      secondsAtFeet: function (ft) { return ft <= 0 ? 0 : interp(xx, tt, ft * FT); }
    };

    // Launch with the chosen tire/prep (re-times 0-40 only).
    var L = veh.gripG === BASE_GRIP_G ? run : simulate(p, veh.k, veh.gripG, function (t, x, v) { return v > (HANDOFF_MPH + 0.5) * MPS; });
    var launch = {
      run: L, seconds: L.t40 - L.t0, feet: (L.x40 - L.rollM) / FT, gripG: veh.gripG,
      defaultSeconds: run.t40 - run.t0, defaultFeet: (run.x40 - run.rollM) / FT
    };

    row.aero = {
      p: p, vehicle: veh, trace: trace, launch: launch, run: run, topMph: top,
      constants: { rho: RHO, crr: CRR, mfWr: MF_WR, mfNmax: MF_NMAX, baseGripG: BASE_GRIP_G }
    };
    row.mode = 'aero';
    return row;
  }

  /* Slip read off the run: ET at X = launch time + 40+ trace time over (X - launch feet). */
  function slipEt(row, ft) {
    var A = row.aero, L = A.launch;
    if (ft <= L.feet) return etAt(L.run, ft);
    var t = A.trace.secondsAtFeet(ft - L.feet);
    return t == null ? null : L.seconds + t;
  }

  var api = {
    DEFAULTS: DEFAULTS, RHO: RHO, CRR: CRR, MF_WR: MF_WR, MF_NMAX: MF_NMAX, BASE_GRIP_G: BASE_GRIP_G,
    TIRE_MU_BY_PREP: TIRE_MU_BY_PREP, TIRE_LABELS: TIRE_LABELS, TIRE_ORDER: TIRE_ORDER,
    launchGripG: launchGripG, driveGripG: driveGripG, DRIVETRAINS: DRIVETRAINS,
    AWD_FACTOR: AWD_FACTOR, H_OVER_L: H_OVER_L, RWD_REAR: RWD_REAR, FWD_FRONT: FWD_FRONT, simulate: simulate, etAt: etAt, trapAt: trapAt, rollSec: rollSec,
    tAtMph: tAtMph, runCar: runCar, slipEt: slipEt
  };
  global.FromFortyAero = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
