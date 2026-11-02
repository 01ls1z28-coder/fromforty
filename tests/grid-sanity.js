/*
 * FromForty launch grid sanity test.  Run:  node tests/grid-sanity.js
 * (Node only; the page itself never loads this file.)
 *
 * Grid: 1/4-mile trap 90-170 mph x RWD/FWD/AWD x 6 tires x unprepped/prepped.
 * Checks, for every trap and drivetrain:
 *   1. distinct   - neighbouring tires (same prep) and the two preps (same
 *                   tire) never tie: >= 0.001 s apart and different at the
 *                   slip's 3 decimals. Gaps under 0.005 s are listed as WARN
 *                   (expected only where the sourced step is small: Drag
 *                   Radial vs Slick x1.02, and torque-limited low-power cars)
 *   2. tire order - Street > Summer > UHP > R-Compound > Drag Radial > Slick
 *                   (slowest to quickest), on each prep
 *   3. prep       - prepped is quicker than unprepped on every tire
 *   4. power      - 60 ft never gets slower as the trap rises (80-180 mph, 2.5 mph steps)
 *   5. ranges     - every 60 ft in 1.10-3.20 s; RWD reference bands:
 *        unprepped Street, trap >= 130 mph: 1.95-2.60 s (street/no-prep launches
 *          of 450-800 hp RWD cars, Hot Rod "mild street car on radials often
 *          well above 2.2"; mustang6g "anything under 2.0 is good on stock tires")
 *        prepped Slick, trap 130-150 mph: 1.25-1.60 s (Hot Rod: mid-10s car
 *          on slicks ~1.45)
 *        prepped Street, trap 100 mph: 1.90-2.50 s (Civic Si / Mustang EcoBoost
 *          stock street-tire strip slips 1.93-2.27)
 * Exit code 1 if any check fails.
 */
'use strict';
var path = require('path');
global.FromFortyRoll = require(path.join(__dirname, '..', 'js', 'roll.js'));
var Aero = require(path.join(__dirname, '..', 'js', 'aero.js'));

var TRAPS = [90, 100, 115, 130, 150, 170];
var DRIVES = ['rwd', 'fwd', 'awd'];
var TIRES = Aero.TIRE_ORDER;          // [Street, Summer, UHP, R-Compound, Drag Radial, Slick]
var PREPS = ['unprepped', 'prepped'];
var LAB = Aero.TIRE_LABELS;
var MIN_GAP = 0.001, WARN_GAP = 0.005, warns = [];

function s60(q, d, t, p) {
  var row = Aero.runCar({ trapQuarter: String(q), drive: d, tire: t, prep: p });
  return Aero.slipEt(row, 60);
}

var fails = [], checks = { distinct: 0, order: 0, prep: 0, power: 0, ranges: 0 };
function check(kind, ok, msg) { checks[kind]++; if (!ok) fails.push(kind + ': ' + msg); }

var grid = {};
TRAPS.forEach(function (q) { DRIVES.forEach(function (d) { TIRES.forEach(function (t) { PREPS.forEach(function (p) {
  grid[[q, d, t, p].join('|')] = s60(q, d, t, p);
}); }); }); });
var g = function (q, d, t, p) { return grid[[q, d, t, p].join('|')]; };

// table
var head = 'trap drive | ' + PREPS.map(function (p) { return TIRES.map(function (t) { return (p === 'prepped' ? 'P-' : 'U-') + LAB[t].replace('R-Compound', 'R-comp').replace('Drag Radial', 'DragRad'); }).join(' '); }).join(' | ');
console.log(head);
TRAPS.forEach(function (q) { DRIVES.forEach(function (d) {
  console.log(String(q).padStart(4) + ' ' + d.toUpperCase() + '   | ' + PREPS.map(function (p) {
    return TIRES.map(function (t) { return g(q, d, t, p).toFixed(3); }).join(' ');
  }).join(' | '));
}); });

var minGap = Infinity;
TRAPS.forEach(function (q) { DRIVES.forEach(function (d) {
  // distinct: neighbouring tires on the same prep, and the two preps on the same tire
  PREPS.forEach(function (p) {
    for (var i = 1; i < TIRES.length; i++) {
      var a = g(q, d, TIRES[i - 1], p), b = g(q, d, TIRES[i], p), gap = Math.abs(a - b);
      minGap = Math.min(minGap, gap);
      var m1 = q + ' mph ' + d + ' ' + p + ': ' + LAB[TIRES[i - 1]] + ' ' + a.toFixed(3) + ' vs ' + LAB[TIRES[i]] + ' ' + b.toFixed(3);
      check('distinct', gap >= MIN_GAP && a.toFixed(3) !== b.toFixed(3), m1);
      if (gap < WARN_GAP) warns.push(m1);
    }
  });
  TIRES.forEach(function (t) {
    var gap = Math.abs(g(q, d, t, 'unprepped') - g(q, d, t, 'prepped'));
    minGap = Math.min(minGap, gap);
    var m2 = q + ' mph ' + d + ' ' + LAB[t] + ': unprepped vs prepped ' + gap.toFixed(3) + ' s apart';
    check('distinct', gap >= MIN_GAP && g(q, d, t, 'unprepped').toFixed(3) !== g(q, d, t, 'prepped').toFixed(3), m2);
    if (gap < WARN_GAP) warns.push(m2);
  });
  PREPS.forEach(function (p) {
    for (var j = 1; j < TIRES.length; j++) {
      var a = g(q, d, TIRES[j - 1], p), b = g(q, d, TIRES[j], p);
      check('order', b < a, q + ' mph ' + d + ' ' + p + ': ' + LAB[TIRES[j]] + ' ' + b.toFixed(3) + ' not quicker than ' + LAB[TIRES[j - 1]] + ' ' + a.toFixed(3));
    }
  });
  TIRES.forEach(function (t) {
    var u = g(q, d, t, 'unprepped'), pr = g(q, d, t, 'prepped');
    check('prep', pr < u, q + ' mph ' + d + ' ' + LAB[t] + ': prepped ' + pr.toFixed(3) + ' vs unprepped ' + u.toFixed(3));
  });
  PREPS.forEach(function (p) { TIRES.forEach(function (t) {
    var v = g(q, d, t, p);
    check('ranges', v >= 1.1 && v <= 3.2, q + ' mph ' + d + ' ' + LAB[t] + '/' + p + ' ' + v.toFixed(3) + ' outside 1.10-3.20');
  }); });
}); });

TRAPS.forEach(function (q) {
  var su = g(q, 'rwd', 0, 'unprepped'), sl = g(q, 'rwd', 2, 'prepped'), sp = g(q, 'rwd', 0, 'prepped');
  if (q >= 130) {
    check('ranges', su >= 1.95 && su <= 2.6, q + ' mph RWD Street/unprepped ' + su.toFixed(3) + ' outside 1.95-2.60');
    if (q <= 150) check('ranges', sl >= 1.25 && sl <= 1.6, q + ' mph RWD Slick/prepped ' + sl.toFixed(3) + ' outside 1.25-1.60');
  }
  if (q === 100) check('ranges', sp >= 1.9 && sp <= 2.5, '100 mph RWD Street/prepped ' + sp.toFixed(3) + ' outside 1.90-2.50');
});

var worstRise = 0;
DRIVES.forEach(function (d) { TIRES.forEach(function (t) { PREPS.forEach(function (p) {
  var prev = null, prevQ = null;
  for (var q = 80; q <= 180.01; q += 2.5) {
    var v = s60(q, d, t, p);
    if (prev != null) { worstRise = Math.max(worstRise, v - prev); check('power', v <= prev + 1e-4, d + ' ' + LAB[t] + '/' + p + ': ' + prevQ + ' mph ' + prev.toFixed(4) + ' -> ' + q + ' mph ' + v.toFixed(4)); }
    prev = v; prevQ = q;
  }
}); }); });

console.log('\nchecks: ' + Object.keys(checks).map(function (k) { return k + ' ' + checks[k]; }).join(', ') +
  ' | smallest tire-to-tire / prep-to-prep gap: ' + minGap.toFixed(3) + ' s | largest 60 ft rise with power: ' + worstRise.toFixed(4) + ' s');
if (warns.length) {
  console.log('WARN: ' + warns.length + ' neighbour gap(s) under ' + WARN_GAP + ' s (not failures):');
  warns.forEach(function (w) { console.log('  ' + w); });
}
if (fails.length) {
  console.log('FAIL: ' + fails.length + ' check(s) failed');
  fails.slice(0, 40).forEach(function (f) { console.log('  ' + f); });
  if (fails.length > 40) console.log('  ... ' + (fails.length - 40) + ' more');
  process.exit(1);
}
console.log('PASS: all ' + Object.keys(checks).reduce(function (s, k) { return s + checks[k]; }, 0) + ' checks');
