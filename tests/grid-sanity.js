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
 *   2. tire order - slowest to quickest:
 *                   prepped   Street > Summer > UHP > R-Compound > Drag Radial > Slick
 *                   unprepped Street > Summer > UHP > R-Compound > Slick > Drag Radial
 *                   (a bias slick needs prep/heat to bite; on untreated asphalt the
 *                   drag radial is the quicker of the two - owner direction, sources
 *                   mixed: fromforty-noprep-VERIFY.md)
 *   3. prep       - prepped is quicker than unprepped on every tire
 *   4. power      - 60 ft never gets slower as the trap rises (80-180 mph, 2.5 mph steps)
 *   5. ranges     - every 60 ft in 1.10-3.20 s; RWD reference bands:
 *        unprepped Street, trap >= 130 mph: 1.95-2.60 s (street/no-prep launches
 *          of 450-800 hp RWD cars, Hot Rod "mild street car on radials often
 *          well above 2.2"; mustang6g "anything under 2.0 is good on stock tires")
 *        prepped Slick, trap 130-150 mph: 1.40-1.80 s (street cars on slicks:
 *          C/D Hellcat Hoosier 1.685 @ 119, SN95 Vortech 1.65 @ 121, GT500
 *          1.80 @ 114; purpose-built drag cars run quicker, ~1.36-1.50)
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
// slowest -> quickest on each prep (see header, item 2)
var ORDER = { prepped: [0, 3, 4, 5, 1, 2], unprepped: [0, 3, 4, 5, 2, 1] };
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
    var O = ORDER[p];
    for (var i = 1; i < O.length; i++) {
      var a = g(q, d, O[i - 1], p), b = g(q, d, O[i], p), gap = Math.abs(a - b);
      minGap = Math.min(minGap, gap);
      var m1 = q + ' mph ' + d + ' ' + p + ': ' + LAB[O[i - 1]] + ' ' + a.toFixed(3) + ' vs ' + LAB[O[i]] + ' ' + b.toFixed(3);
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
    var O = ORDER[p];
    for (var j = 1; j < O.length; j++) {
      var a = g(q, d, O[j - 1], p), b = g(q, d, O[j], p);
      check('order', b < a, q + ' mph ' + d + ' ' + p + ': ' + LAB[O[j]] + ' ' + b.toFixed(3) + ' not quicker than ' + LAB[O[j - 1]] + ' ' + a.toFixed(3));
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
    if (q <= 150) check('ranges', sl >= 1.4 && sl <= 1.8, q + ' mph RWD Slick/prepped ' + sl.toFixed(3) + ' outside 1.40-1.80');
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
