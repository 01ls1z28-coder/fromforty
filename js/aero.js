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
 *   The RWD launch grip (tire/prep table below) fixes the effective mu with a 45%
 *   rear static share (MotorTrend 2024 Mustang GT 55/45).
 *   FWD uses an EFFECTIVE front share of 0.655, fitted (static share is ~0.62,
 *   MotorTrend Civic Type R / GTI 62/38). It now sits slightly above the static
 *   share because the soft torque/grip blend below always keeps the launch a
 *   little under the grip; flagged in VERIFY. AWD_FACTOR 0.947 (fitted; same reason).
 *   FWD on drag rubber keeps x0.753 of the drag-tire grip (2 cited FWD slips;
 *   held at the floor that keeps FWD Drag Radial >= 1.03 x R-Compound grip on
 *   both preps, so the tire order holds).
 *   FWD drag uses a 3,375 lb default mass instead of 4,050 lb (C/D curb weights
 *   of the FWD set average 3,233 lb; + driver/gear).
 *
 * Launch grip, RWD-equivalent g on a prepped track. Two anchors are fitted
 * (leave-one-out, 41 cited 60 ft slips + 44 C/D 0-60 tests, see
 * fromforty-tireprep-VERIFY.md); the steps between classes are sourced:
 *   Street (all-season)            0.779  fitted
 *   Summer (UHP summer)    x1.075  0.837  C/D G70 PS4 vs Primacy Tour A/S:
 *                                         skidpad 0.90/0.84, 70-0 178/165 ft
 *   UHP (max-performance)  x1.100  0.857  C/D same-car all-season vs summer:
 *                                         Prelude 0.97/0.90 g, Fusion 0.89/0.84 g + braking
 *   R-Compound            x1.142  0.890  UHP x1.038, C/D Focus RS Cup 2 vs
 *                                         Pilot Super Sport: 1.04/0.99 g, 70-0 158/154 ft
 *   Drag Radial                   1.985  fitted
 *   Slick                  x1.02   2.025  Hot Rod same-car ET Drag vs Pro Drag
 *                                         Radial 60 ft 1.51 vs 1.525 avg (thin: other RWD
 *                                         A/B pairs show no gap)
 * Unprepped surface: street-type rubber x0.902 (fitted); drag rubber x0.75,
 *   set so a RWD drag-radial car that cuts 1.27 prepped (157 mph trap) runs
 *   x1.115 unprepped: mean of the cited no-prep pairs (ls1tech 1.27 vs high
 *   1.3s, yellowbullet low 1.2s vs 1.3-1.5).
 * Launch acceleration cap (launchCapG): drive force p / 25 mph scaled by
 *   grip^0.15 (launch rpm: a stickier tire holds more launch rpm / slip), soft
 *   minimum with the grip (n = 2.92), Street-tire wheelspin above the grip
 *   (keeps 1 - 0.148 (1 - 1/E) of it), and the best of any lower throttle so
 *   the 60 ft never slows as power rises.
 * Below the handoff the same equation runs, capped by that launch grip:
 *   a <= gripG * g - k v^2 - Crr g. A traction-limited launch holds the cap
 *   until it meets the power-limited curve (>= 40 mph) and then follows the
 *   40+ trace from that speed.
 *
 * Power is always solved with a fixed 1.0 g reference launch, so the 40+
 * trace, every roll window and every projected trap depend only on the
 * measured input and Cd/area/weight. Tire and prep only re-time the launch.
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
  var H_OVER_L = 0.553 / 2.753, RWD_REAR = 0.45, FWD_FRONT = 0.655, FWD_DRAG_TIRE = 0.753;
  var DRIVETRAINS = { rwd: 'RWD', fwd: 'FWD', awd: 'AWD' };
  var AWD_FACTOR = 0.947;
  var BASE_GRIP_G = 1.0, HANDOFF_MPH = 40, ROLLOUT_FT = 1, TRAP_SPAN_FT = 66;
  var MAX_MPH = 200.5, MAX_FT = 5300;

  var TIRE_LABELS = { 0: 'Street', 1: 'Drag Radial', 2: 'Slick', 3: 'Summer', 4: 'UHP', 5: 'R-Compound' };
  var TIRE_ORDER = [0, 3, 4, 5, 1, 2];   // PowerCurve <select> order
  // PowerCurve tire option id -> launch class (see header).
  var TIRE_CLASS = { 0: 'street', 3: 'summer', 4: 'uhp', 5: 'rcomp', 1: 'dragradial', 2: 'slick' };
  // Grip ratios between neighbouring classes (sourced, see header); the two
  // anchors (Street, Drag Radial) and the launch terms are fitted (LOO).
  var TIRE_RATIO = { summer: 1.075, uhp: 1.10, rcomp: 1.142, slick: 1.02 };
  var STREET_G = 0.779, DRAG_RADIAL_G = 1.985;
  var TIRE_GRIP_G = {
    street: STREET_G, summer: STREET_G * TIRE_RATIO.summer, uhp: STREET_G * TIRE_RATIO.uhp,
    rcomp: STREET_G * TIRE_RATIO.rcomp, dragradial: DRAG_RADIAL_G, slick: DRAG_RADIAL_G * TIRE_RATIO.slick
  };
  var UNPREP = { street: 0.902, drag: 0.75 };       // street-type rubber / drag rubber
  var SPIN = 0.148, SOFT_N = 2.923, LAUNCH_VT_MPH = 25, LAUNCH_RPM_BETA = 0.15;
  function normalizePrep(p) {
    p = String(p == null ? 'unprepped' : p).toLowerCase();
    return (p === 'prepped' || p === 'prep') ? 'prepped' : 'unprepped';
  }
  function tireClass(tire) { return TIRE_CLASS[(tire == null || tire === '' ? 0 : Number(tire)) | 0] || 'street'; }
  function isDrag(c) { return c === 'dragradial' || c === 'slick'; }
  function launchGripG(tire, prep) {
    var c = tireClass(tire), g = TIRE_GRIP_G[c];
    if (normalizePrep(prep) !== 'prepped') g *= isDrag(c) ? UNPREP.drag : UNPREP.street;
    return g;
  }
  /* Launch acceleration cap (g) for drive-adjusted tire grip gp and power/mass p.
   *   drive force  at = p / 25 mph * gp^0.15   (g)   - full power early in first
   *     gear; the gp^0.15 term is the launch rpm / clutch-converter slip a
   *     stickier tire lets the driver hold (street tires ~1,500-2,000 rpm,
   *     drag tires 3,000-3,500 rpm, mustang6g threads cited in VERIFY)
   *   Street tire above its grip (E = at / gp > 1) spins: grip x (1 - 0.148 (1 - 1/E))
   *   combined limit  (ag^-n + at^-n)^(-1/n), n = 2.92: drive force and grip
   *     blend (clutch/converter slip, tire force-slip curve), so the tire
   *     still matters when the launch is torque-limited
   *   best over any throttle up to full (driver / traction control can always
   *     use less), so the 60 ft never gets slower as power rises. */
  function launchCapG(gp, p, tire) {
    var s = tireClass(tire) === 'street' ? SPIN : 0;
    var vT = LAUNCH_VT_MPH * MPS, n = SOFT_N, rpmGain = Math.pow(gp, LAUNCH_RPM_BETA);
    function f(q) {
      var at = q / vT / G * rpmGain, E = at / gp, ag = (s > 0 && E > 1) ? gp * (1 - s * (1 - 1 / E)) : gp;
      return Math.pow(Math.pow(ag, -n) + Math.pow(at, -n), -1 / n);
    }
    var best = 0, N = 60;
    for (var i = 0; i <= N; i++) { var v = f(p * Math.pow(1 / 60, i / N)); if (v > best) best = v; }
    return best;
  }

  function normalizeDrive(d) { d = String(d == null ? 'rwd' : d).toLowerCase(); return DRIVETRAINS[d] ? d : 'rwd'; }

  /* Launch grip (g) for a drivetrain, from the RWD-equivalent tire grip. */
  function driveGripG(rwdG, drive) {
    drive = normalizeDrive(drive);
    if (drive === 'rwd') return rwdG;
    var mu = rwdG / (RWD_REAR + rwdG * H_OVER_L);          // effective mu behind the RWD figure
    if (drive === 'awd') return AWD_FACTOR * mu;
    return mu * FWD_FRONT / (1 + mu * H_OVER_L);
  }
  /* FWD on drag rubber keeps only part of the drag-tire gain (wheel hop and
   * load coming off the front tires; fitted on 2 cited FWD drag-radial slips). */
  function driveTireGripG(rwdG, drive, tire) {
    var g = driveGripG(rwdG, drive);
    return normalizeDrive(drive) === 'fwd' && isDrag(tireClass(tire)) ? g * FWD_DRAG_TIRE : g;
  }

  function interp(A, B, a) {
    var n = A.length; if (!n || a < A[0] || a > A[n - 1]) return null;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (A[m] < a) lo = m; else hi = m; }
    var d = A[hi] - A[lo];
    return B[lo] + (B[hi] - B[lo]) * (d ? (a - A[lo]) / d : 0);
  }

  function mfGas(v) { var N = Math.min(MF_NMAX, v > 0.1 ? MF_WR / v : MF_NMAX); return 1.04 + 0.0025 * N * N; }
  function accelFn(p, k, gripG, hold) {
    var mfAt = mfGas;
    var c = CRR * G, v40 = HANDOFF_MPH * MPS, A0 = gripG * G;
    function aPow(v) { return (p / Math.max(v, 1e-6) - k * v * v - c) / mfAt(v); }
    var need40 = aPow(v40) + k * v40 * v40 + c;
    var ramp = need40 > A0;
    if (hold && ramp) return function (v) { return Math.min(A0 - k * v * v - c, aPow(v)); };
    return function (v) {
      if (v >= v40) return aPow(v);
      var grip = ramp ? A0 + (need40 - A0) * (v / v40) : A0;
      return Math.min(grip - k * v * v - c, aPow(v));
    };
  }

  /* RK4 from rest. stop(t,x,v) ends early (used while solving). */
  function simulate(p, k, gripG, stop, hold) {
    var acc = accelFn(p, k, gripG, hold);
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

  /* Speed where a traction-limited launch meets the power-limited curve (>= 40 mph). */
  function handoffMps(p, k, gripG) {
    var c = CRR * G, A0 = gripG * G, v40 = HANDOFF_MPH * MPS;
    function f(v) { return (p / v - k * v * v - c) / mfGas(v) - (A0 - k * v * v - c); }
    if (f(v40) <= 0) return v40;
    var lo = v40, hi = v40;
    while (f(hi) > 0 && hi < 120) hi += 2;
    if (f(hi) > 0) return hi;
    for (var i = 0; i < 40; i++) { var m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
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
    veh.gripG = driveTireGripG(veh.rwdGripG, veh.drive, veh.tire);
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
    var launch = makeLaunch(p, veh, trace, xx, tt, vv);
    launch.defaultSeconds = run.t40 - run.t0; launch.defaultFeet = (run.x40 - run.rollM) / FT;

    row.aero = {
      p: p, vehicle: veh, trace: trace, launch: launch, run: run, topMph: top,
      constants: { rho: RHO, crr: CRR, mfWr: MF_WR, mfNmax: MF_NMAX, baseGripG: BASE_GRIP_G }
    };
    row.mode = 'aero';
    return row;
  }

  /* Launch with the chosen tire/prep: grip-capped from rest; a traction-limited
   * launch holds its grip limit until it meets the power curve (handoff at
   * >= 40 mph), then the car follows the 40+ trace from that speed. */
  function makeLaunch(p, veh, trace, xx, tt, vv) {
    var gEff = launchCapG(veh.gripG, p, veh.tire);
    var vh = handoffMps(p, veh.k, gEff);
    var L = simulate(p, veh.k, gEff, function (t, x, v) { return v > Math.max(vh, HANDOFF_MPH * MPS) + 0.5 * MPS; }, true);
    var tH = interp(L.V, L.T, vh), xH = interp(L.T, L.X, tH);
    return {
      run: L, seconds: L.t40 - L.t0, feet: (L.x40 - L.rollM) / FT, gripG: gEff, peakGripG: veh.gripG,
      handoffMph: vh / MPS, hSeconds: tH - L.t0, hFeet: (xH - L.rollM) / FT,
      tOff: interp(vv, tt, vh) || 0, xOff: (interp(vv, xx, vh) || 0) / FT
    };
  }
  /* Slip ET at X ft = launch to the handoff speed + the 40+ trace beyond it. */
  function slipEt(row, ft) {
    var A = row.aero, L = A.launch;
    if (ft <= L.hFeet) return etAt(L.run, ft);
    var t = A.trace.secondsAtFeet(ft - L.hFeet + L.xOff);
    return t == null ? null : L.hSeconds + t - L.tOff;
  }
  /* Standing-start time to a speed (rollout excluded), same construction. */
  function slipTimeAtMph(row, mph) {
    var A = row.aero, L = A.launch;
    if (mph * MPS <= L.handoffMph * MPS) { var t = tAtMph(L.run, mph); return t == null ? null : t - L.run.t0; }
    var s = A.trace.seconds(mph);
    return s == null ? null : L.hSeconds + s - L.tOff;
  }
  var api = {
    DEFAULTS: DEFAULTS, RHO: RHO, CRR: CRR, MF_WR: MF_WR, MF_NMAX: MF_NMAX, BASE_GRIP_G: BASE_GRIP_G,
    TIRE_CLASS: TIRE_CLASS, TIRE_GRIP_G: TIRE_GRIP_G, TIRE_RATIO: TIRE_RATIO, UNPREP: UNPREP, SPIN: SPIN, SOFT_N: SOFT_N, launchCapG: launchCapG, TIRE_LABELS: TIRE_LABELS, TIRE_ORDER: TIRE_ORDER,
    launchGripG: launchGripG, driveGripG: driveGripG, DRIVETRAINS: DRIVETRAINS,
    AWD_FACTOR: AWD_FACTOR, H_OVER_L: H_OVER_L, RWD_REAR: RWD_REAR, FWD_FRONT: FWD_FRONT, FWD_DRAG_TIRE: FWD_DRAG_TIRE, simulate: simulate, etAt: etAt, trapAt: trapAt, rollSec: rollSec,
    tAtMph: tAtMph, runCar: runCar, slipEt: slipEt, slipTimeAtMph: slipTimeAtMph
  };
  global.FromFortyAero = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
