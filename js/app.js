/**
 * FromForty page. Trap speed → roll times. Does not load PowerCurve.
 */
(function (global) {
  'use strict';

  var Roll = global.FromFortyRoll;
  if (!Roll || typeof document === 'undefined') return;

  var MAX_CARS = 2;
  var nextId = 1;
  var cars = [];

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function field(labelText, input) {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', labelText));
    wrap.appendChild(input);
    return wrap;
  }

  function makeInput(attrs) {
    var input = document.createElement('input');
    Object.keys(attrs).forEach(function (k) { input[k] = attrs[k]; });
    return input;
  }

  function blankCar() {
    return { id: nextId++ };
  }

  function readValue(card, key) {
    var node = card.querySelector('[data-key="' + key + '"]');
    return node ? node.value : '';
  }

  function inputOf(card) {
    return {
      trapEighth: readValue(card, 'trapEighth'),
      trap1000: readValue(card, 'trap1000'),
      trapQuarter: readValue(card, 'trapQuarter'),
      t60_130: readValue(card, 't60_130'),
      t100_150: readValue(card, 't100_150')
    };
  }

  function sourceDistanceFt(source) {
    return {
      eighth: Roll.EIGHTH_FT,
      '1000': Roll.THOUSAND_FT,
      quarter: Roll.QUARTER_FT,
      'half-mile': Roll.HALF_MILE_FT,
      mile: Roll.MILE_FT
    }[source] || null;
  }

  // Use the same projected speed/time curve as the graph, then integrate
  // speed over elapsed time. This reports model distance, without adding a
  // second physics or power formula.
  function profileForRow(row) {
    var profileTrap = row && row.trapMph;
    var profileDistance = row && row.trapDistanceFt;
    var dragTraps = row && row.dragTraps || [];
    if (!(profileTrap > 0) || !(profileDistance > 0)) {
      var quarter = dragTraps.filter(function (trap) { return trap.source === 'quarter'; })[0];
      var fallback = quarter || dragTraps[dragTraps.length - 1];
      profileTrap = fallback ? fallback.trapMph : null;
      profileDistance = fallback ? sourceDistanceFt(fallback.source) : null;
    }
    return { trap: profileTrap, distance: profileDistance };
  }

  function modelElapsedAt(profile, mph) {
    if (mph <= 40) return 0;
    if (!profile || !(profile.trap > 0) || !(profile.distance > 0)) return null;
    var result = Roll.rollTime(profile.distance, 40, mph, profile.trap);
    return result && result.seconds > 0 ? result.seconds : null;
  }

  function modelDistanceAt(row, targetMph) {
    if (!(targetMph > 40)) return targetMph === 40 ? 0 : null;
    var profile = profileForRow(row);
    if (!(profile.trap > 0) || !(profile.distance > 0)) return null;
    var step = 1;
    var previousMph = 40;
    var previousSeconds = 0;
    var feet = 0;
    for (var mph = 41; mph <= targetMph; mph += step) {
      var currentMph = Math.min(mph, targetMph);
      var currentSeconds = modelElapsedAt(profile, currentMph);
      if (currentSeconds == null || currentSeconds < previousSeconds) return null;
      feet += ((previousMph + currentMph) / 2) * (5280 / 3600) *
        (currentSeconds - previousSeconds);
      previousMph = currentMph;
      previousSeconds = currentSeconds;
      if (currentMph === targetMph) break;
    }
    return isFinite(feet) ? feet : null;
  }

  function modelWindowDistance(row, startMph, endMph) {
    var finish = modelDistanceAt(row, endMph);
    var start = modelDistanceAt(row, startMph);
    return finish == null || start == null ? null : Math.max(0, finish - start);
  }

  function renderResults(card, row, margins) {
    var host = card.querySelector('.results');
    host.textContent = '';

    var dragTraps = row.dragTraps || [];
    // Results start directly with the two clean data panels. The former
    // LIVE DATA SLIP / car-name / projected-speed banner added noise without
    // improving the measurement, so the data itself gets the emphasis.

    function section(title, tag, extraClass) {
      var block = el('section', 'slip-section' + (extraClass ? ' ' + extraClass : ''));
      var sectionHead = el('div', 'slip-section-head');
      sectionHead.appendChild(el('h2', 'slip-section-title', title));
      sectionHead.appendChild(el('span', 'slip-section-tag', tag));
      block.appendChild(sectionHead);
      return block;
    }

    function marginText(key) {
      var margin = margins[key];
      if (margin == null) return '';
      // A zero margin needs no extra text; the number is the useful result.
      return margin === 0 ? '' : '+' + margin.toFixed(4) + ' s';
    }

    function addDistanceLine(host, distance) {
      host.appendChild(el('span', 'distance-value', distance == null ? 'Distance unavailable' : distance.toFixed(1) + ' ft'));
    }

    function addRollRow(block, label, key, startMph, endMph) {
      var line = el('div', 'pull');
      line.appendChild(el('span', 'pull-name', label));
      var time = row[key];
      if (time == null) {
        line.appendChild(el('span', 'pull-time miss', '—'));
        line.appendChild(el('span', 'pull-margin', row.notes[key] || 'No time'));
      } else {
        line.appendChild(el('span', 'pull-time', time.toFixed(4) + ' s'));
        var detail = el('span', 'pull-margin');
        addDistanceLine(detail, modelWindowDistance(row, startMph, endMph));
        var margin = marginText(key);
        if (margin) detail.appendChild(el('span', 'pull-margin-delta' + (margins[key] === 0 ? ' best' : ''), margin));
        line.appendChild(detail);
      }
      block.appendChild(line);
    }

    function addFeature(block, label, key, startMph, endMph) {
      var metric = el('div', 'metric');
      metric.appendChild(el('span', 'metric-label', 'signature'));
      metric.appendChild(el('span', 'range', label));
      var time = row[key];
      if (time == null) {
        metric.appendChild(el('span', 'time miss', '—'));
        metric.appendChild(el('span', 'metric-margin', row.notes[key] || 'No time'));
      } else {
        metric.appendChild(el('span', 'time', time.toFixed(4) + ' s'));
        addDistanceLine(metric, modelWindowDistance(row, startMph, endMph));
        var margin = marginText(key);
        if (margin) metric.appendChild(el('span', 'metric-margin' + (margins[key] === 0 ? ' best' : ''), margin));
      }
      block.appendChild(metric);
    }

    var slipBody = el('div', 'slip-body');
    var roll = section('Roll Racing', 'SPEED WINDOWS', 'roll-panel');

    function addSpeedGraph(block) {
      var profileTrap = row.trapMph;
      var profileDistance = row.trapDistanceFt;
      if (profileTrap == null && dragTraps.length) {
        var quarter = dragTraps.filter(function (trap) { return trap.source === 'quarter'; })[0];
        var fallback = quarter || dragTraps[dragTraps.length - 1];
        profileTrap = fallback ? fallback.trapMph : null;
        profileDistance = fallback ? sourceDistanceFt(fallback.source) : null;
      }
      if (!(profileTrap > 0) || !(profileDistance > 0)) return;

      var graph = el('div', 'speed-graph');
      var graphHead = el('div', 'speed-graph-head');
      graphHead.appendChild(el('span', 'speed-graph-title', 'SPEED / TIME TRACE'));
      graphHead.appendChild(el('span', 'speed-graph-legend', 'X TIME (S)  •  Y SPEED (MPH)  •  HOVER FOR VALUES'));
      graph.appendChild(graphHead);

      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 760 300');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Interactive projected speed versus time, Y axis 0 to 250 miles per hour');
      var ns = 'http://www.w3.org/2000/svg';
      function svgEl(tag, attrs) {
        var node = document.createElementNS(ns, tag);
        Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        return node;
      }
      var left = 58, right = 735, top = 22, bottom = 228;
      var endSpeed = 200;
      var endRoll = Roll.rollTime(profileDistance, 40, endSpeed, profileTrap);
      if (!endRoll || !(endRoll.seconds > 0)) return;
      var endTime = endRoll.seconds;
      var speedMarks = [40, 80, 100, 130, 150, 200];
      [0, 50, 100, 150, 200, 250].forEach(function (speedMark) {
        var y = bottom - (speedMark / 250) * (bottom - top);
        svg.appendChild(svgEl('line', { x1: left, y1: y, x2: right, y2: y, class: 'graph-grid' }));
        var label = svgEl('text', { x: left - 10, y: y + 4, class: 'graph-y-label', 'text-anchor': 'end' });
        label.textContent = speedMark;
        svg.appendChild(label);
      });
      svg.appendChild(svgEl('line', { x1: left, y1: bottom, x2: right, y2: bottom, class: 'graph-axis' }));
      var yAxisLabel = svgEl('text', { x: 15, y: (top + bottom) / 2, class: 'graph-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 15 ' + ((top + bottom) / 2) + ')' });
      yAxisLabel.textContent = 'SPEED (MPH)';
      svg.appendChild(yAxisLabel);
      var samples = [];
      var points = [];
      for (var sample = 0; sample <= 160; sample++) {
        var mph = 40 + (160 * sample / 160);
        var elapsed = mph === 40 ? 0 : Roll.rollTime(profileDistance, 40, mph, profileTrap).seconds;
        var x = left + (elapsed / endTime) * (right - left);
        var y = bottom - (mph / 250) * (bottom - top);
        samples.push({ mph: mph, elapsed: elapsed, x: x, y: y });
        points.push(x.toFixed(2) + ',' + y.toFixed(2));
      }
      svg.appendChild(svgEl('polyline', { points: points.join(' '), class: 'graph-line' }));
      [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
        var x = left + fraction * (right - left);
        svg.appendChild(svgEl('line', { x1: x, y1: bottom, x2: x, y2: bottom + 5, class: 'graph-axis-tick' }));
        var label = svgEl('text', { x: x, y: bottom + 22, class: 'graph-x-label', 'text-anchor': 'middle' });
        label.textContent = (endTime * fraction).toFixed(2) + ' s';
        svg.appendChild(label);
      });
      speedMarks.forEach(function (speedMark) {
        var elapsed = speedMark === 40 ? 0 : Roll.rollTime(profileDistance, 40, speedMark, profileTrap).seconds;
        var x = left + (elapsed / endTime) * (right - left);
        var y = bottom - (speedMark / 250) * (bottom - top);
        svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 3, class: 'graph-dot' }));
      });
      var timeLabel = svgEl('text', { x: right, y: bottom + 48, class: 'graph-axis-label', 'text-anchor': 'end' });
      timeLabel.textContent = 'TIME (SECONDS)';
      svg.appendChild(timeLabel);

      // A pointer-following readout makes the curve useful as a speed/time lookup,
      // while leaving the underlying calculation untouched.
      var hoverLine = svgEl('line', {
        x1: left, y1: top, x2: left, y2: bottom, class: 'graph-hover-line'
      });
      var hoverDot = svgEl('circle', { cx: left, cy: bottom, r: 5, class: 'graph-hover-dot' });
      var tooltip = document.createElementNS(ns, 'g');
      tooltip.setAttribute('class', 'graph-tooltip');
      tooltip.setAttribute('visibility', 'hidden');
      var tooltipBg = svgEl('rect', { x: 0, y: 0, width: 168, height: 30, rx: 4, class: 'graph-tooltip-bg' });
      var tooltipText = svgEl('text', { x: 9, y: 18, class: 'graph-tooltip-text' });
      tooltip.appendChild(tooltipBg);
      tooltip.appendChild(tooltipText);
      svg.appendChild(hoverLine);
      svg.appendChild(hoverDot);
      svg.appendChild(tooltip);

      var hit = svgEl('rect', {
        x: left, y: top, width: right - left, height: bottom - top,
        class: 'graph-hitarea', 'aria-label': 'Hover to inspect speed and time'
      });
      svg.appendChild(hit);

      function pointAtViewX(viewX) {
        var x = Math.max(left, Math.min(right, viewX));
        var index = 0;
        while (index < samples.length - 2 && samples[index + 1].x < x) index += 1;
        var a = samples[index];
        var b = samples[Math.min(index + 1, samples.length - 1)];
        var span = b.x - a.x;
        var ratio = span > 0 ? (x - a.x) / span : 0;
        return {
          x: x,
          y: a.y + (b.y - a.y) * ratio,
          mph: a.mph + (b.mph - a.mph) * ratio,
          elapsed: a.elapsed + (b.elapsed - a.elapsed) * ratio
        };
      }

      function updateHover(event) {
        var viewX;
        var ctm = svg.getScreenCTM && svg.getScreenCTM();
        if (ctm && ctm.inverse) {
          var svgPoint = svg.createSVGPoint();
          svgPoint.x = event.clientX;
          svgPoint.y = event.clientY;
          viewX = svgPoint.matrixTransform(ctm.inverse()).x;
        } else {
          var bounds = svg.getBoundingClientRect();
          if (!bounds.width) return;
          viewX = (event.clientX - bounds.left) / bounds.width * 760;
        }
        var point = pointAtViewX(viewX);
        var tooltipX = Math.max(left, Math.min(right - 168, point.x - 84));
        var tooltipY = Math.max(top, point.y - 38);
        hoverLine.setAttribute('x1', point.x);
        hoverLine.setAttribute('x2', point.x);
        hoverDot.setAttribute('cx', point.x);
        hoverDot.setAttribute('cy', point.y);
        tooltip.setAttribute('transform', 'translate(' + tooltipX.toFixed(2) + ' ' + tooltipY.toFixed(2) + ')');
        tooltipText.textContent = point.elapsed.toFixed(2) + ' s  •  ' + point.mph.toFixed(1) + ' mph';
        tooltip.setAttribute('visibility', 'visible');
      }

      hit.addEventListener('pointermove', updateHover);
      hit.addEventListener('pointerenter', updateHover);
      hit.addEventListener('pointerleave', function () {
        tooltip.setAttribute('visibility', 'hidden');
      });
      graph.appendChild(svg);
      block.appendChild(graph);
    }

    var rollLayout = el('div', 'roll-window-layout');
    var feature = el('div', 'card b-feature');
    [
      ['60–130', 't60_130', 60, 130],
      ['100–150', 't100_150', 100, 150],
      ['40–120', 't40_120', 40, 120]
    ].forEach(function (pull) { addFeature(feature, pull[0], pull[1], pull[2], pull[3]); });
    rollLayout.appendChild(feature);

    var rest = el('div', 'card b-rest');
    var restHead = el('div', 'b-rest-head');
    restHead.appendChild(el('span', null, 'Results'));
    restHead.appendChild(el('span', null, 'time'));
    rest.appendChild(restHead);
    [
      ['40–100', 't40_100', 40, 100],
      ['50–100', 't50_100', 50, 100],
      ['60–100', 't60_100', 60, 100],
      ['60–120', 't60_120', 60, 120],
      ['100–130', 't100_130', 100, 130],
      ['100–200', 't100_200', 100, 200],
      ['150–200', 't150_200', 150, 200]
    ].forEach(function (pull) { addRollRow(rest, pull[0], pull[1], pull[2], pull[3]); });
    rollLayout.appendChild(rest);
    roll.appendChild(rollLayout);
    slipBody.appendChild(roll);

    var drag = section('Drag Racing', row.inputMode === 'time' ? 'PROJECTED TRAP MPH' :
      (dragTraps.length ? 'TRAP SPEEDS' : 'NO TRAP'), 'drag-panel');
    if (!dragTraps.length) {
      var emptyDragLine = el('div', 'pull drag-row');
      emptyDragLine.appendChild(el('span', 'pull-name', 'Timeslip mph'));
      emptyDragLine.appendChild(el('span', 'pull-time miss', '—'));
      emptyDragLine.appendChild(el('span', 'pull-margin trap-unit', 'no mph mark'));
      drag.appendChild(emptyDragLine);
    } else {
      var sourceLabels = {
        eighth: '1/8-mile trap',
        '1000': '1000-foot trap',
        quarter: '1/4-mile trap',
        'half-mile': '1/2-mile trap',
        mile: '1-mile trap'
      };
      dragTraps.forEach(function (trap) {
        var dragLine = el('div', 'pull drag-row');
        var source = sourceLabels[trap.source] || 'Timeslip trap';
        if (row.inputMode === 'time') {
          source += ' from ' + row.referenceLabel;
        } else if (trap.projected) {
          source += ' from ' + (sourceLabels[trap.fromSource] || 'entered trap');
        } else {
          source += ' entered';
        }
        dragLine.appendChild(el('span', 'pull-name', source));
        dragLine.appendChild(el('span', 'pull-time trap-speed', trap.trapMph.toFixed(2) + ' mph'));
        dragLine.appendChild(el('span', 'pull-margin trap-unit', sourceDistanceFt(trap.source) == null ? 'distance unavailable' : sourceDistanceFt(trap.source).toFixed(0) + ' ft'));
        drag.appendChild(dragLine);
      });
    }
    slipBody.appendChild(drag);
    host.appendChild(slipBody);
    // Keep the trace beneath the complete roll and drag results.
    addSpeedGraph(host);
  }

  function showIssues(card, issues) {
    var host = card.querySelector('.results');
    host.textContent = '';
    issues.forEach(function (text) {
      host.appendChild(el('p', 'error', text));
    });
  }

  var sharedRunAction = null;

  function makeRunAction() {
    var runAction = el('div', 'run-action');
    var run = el('button', 'run', 'Run');
    run.type = 'button';
    run.id = 'run';
    run.addEventListener('click', onRun);
    runAction.appendChild(run);
    var status = el('p', 'status', '');
    status.id = 'status';
    runAction.appendChild(status);
    return runAction;
  }

  function ensureRunAction() {
    var target;
    if (!sharedRunAction) sharedRunAction = makeRunAction();
    if (cars.length === 2) {
      target = document.getElementById('cars');
      if (target && sharedRunAction.parentNode !== target) target.appendChild(sharedRunAction);
      sharedRunAction.classList.add('vs-run-action');
      return;
    }
    target = document.querySelector('.car .grid');
    if (!target) return;
    if (sharedRunAction.parentNode !== target) target.appendChild(sharedRunAction);
    sharedRunAction.classList.remove('vs-run-action');
  }

  function mountCar(car) {
    var card = el('article', 'car');
    card.dataset.id = String(car.id);

    var results = el('div', 'results');
    results.setAttribute('aria-live', 'polite');

    function num(key) {
      var input = makeInput({
        type: 'number',
        value: '',
        step: 'any',
        inputMode: 'decimal',
        autocomplete: 'off',
        spellcheck: false
      });
      input.dataset.key = key;
      input.addEventListener('input', function () {
        // A card represents one measurement source. Keep the entry state
        // unambiguous by clearing every other source as soon as this one has
        // a value. The run handler still validates the invariant defensively.
        if (input.value.trim() === '') return;
        card.querySelectorAll('input[data-key]').forEach(function (other) {
          if (other !== input) other.value = '';
        });
      });
      return input;
    }

    var primary = el('div', 'grid');
    primary.appendChild(field('1/8-mile trap, mph', num('trapEighth')));
    primary.appendChild(field('1000-foot trap, mph', num('trap1000')));
    primary.appendChild(field('1/4-mile trap, mph', num('trapQuarter')));
    primary.appendChild(field('Measured 60–130, sec', num('t60_130')));
    primary.appendChild(field('Measured 100–150, sec', num('t100_150')));

    if (!sharedRunAction) primary.appendChild(sharedRunAction = makeRunAction());

    var remove = el('button', 'remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      if (cars.length <= 1) return;
      cars = cars.filter(function (c) { return c.id !== car.id; });
      card.remove();
      ensureRunAction();
      var comparison = document.getElementById('comparison');
      if (comparison) { comparison.hidden = true; comparison.textContent = ''; }
      updateAdd();
    });

    var identity = el('div', 'car-identity car-' + (car.id === 1 ? 'one' : 'two'));
    identity.appendChild(el('span', 'car-identity-kicker', 'MEASUREMENT INPUT'));
    identity.appendChild(el('strong', 'car-identity-name', 'Car ' + (car.id === 1 ? '1' : '2')));
    card.appendChild(identity);
    card.appendChild(primary);
    card.appendChild(results);
    card.appendChild(remove);
    document.getElementById('cars').appendChild(card);
    ensureRunAction();
    return card;
  }

  function updateAdd() {
    document.getElementById('add').disabled = cars.length >= MAX_CARS;
    document.querySelectorAll('.remove').forEach(function (btn) {
      btn.disabled = cars.length <= 1;
    });
    var carBay = document.getElementById('cars');
    if (carBay) {
      carBay.classList.toggle('single', cars.length === 1);
      carBay.classList.toggle('two-up', cars.length === 2);
    }
  }

  function addCar() {
    if (cars.length >= MAX_CARS) return;
    var car = blankCar();
    cars.push(car);
    mountCar(car);
    var comparison = document.getElementById('comparison');
    if (comparison) { comparison.hidden = true; comparison.textContent = ''; }
    updateAdd();
  }

  function marginsFor(rows) {
    var keys = [
      't40_60', 't40_80', 't40_100', 't40_120', 't50_100', 't60_100',
      't60_120', 't60_130', 't80_120', 't100_130', 't100_150', 't100_180',
      't100_200', 't150_200'
    ];
    var best = {};
    keys.forEach(function (k) {
      var min = null;
      rows.forEach(function (row) {
        if (!row || row[k] == null) return;
        if (min == null || row[k] < min) min = row[k];
      });
      best[k] = min;
    });
    return rows.map(function (row) {
      var m = {};
      keys.forEach(function (k) {
        if (!row || row[k] == null || best[k] == null) m[k] = null;
        else m[k] = row[k] - best[k];
      });
      return m;
    });
  }

  function comparisonValue(value, unit, decimals) {
    return value == null ? '—' : value.toFixed(decimals == null ? 4 : decimals) + unit;
  }

  function comparisonDelta(value1, value2, unit, decimals) {
    if (value1 == null || value2 == null) return '—';
    var delta = value2 - value1;
    return (delta >= 0 ? '+' : '') + delta.toFixed(decimals == null ? 4 : decimals) + unit;
  }

  // One shared results bay for VS mode. The cards above remain input-only so
  // adding the second car never duplicates or squeezes the results.
  function renderComparison(rows) {
    var host = document.getElementById('comparison');
    if (!host) return;
    host.textContent = '';
    host.hidden = true;
    host.classList.remove('is-visible');
    if (rows.length !== 2 || !rows[0] || !rows[1] || !rows[0].ok || !rows[1].ok) return;

    var panel = el('section', 'vs-panel');
    var head = el('div', 'vs-head');
    var titleWrap = el('div', 'vs-title-wrap');
    titleWrap.appendChild(el('span', 'vs-kicker', 'HEAD-TO-HEAD'));
    titleWrap.appendChild(el('h2', 'vs-title', 'VS Mode'));
    head.appendChild(titleWrap);
    head.appendChild(el('span', 'vs-rule', 'CAR 2 − CAR 1'));
    panel.appendChild(head);

    var legend = el('div', 'vs-legend');
    legend.appendChild(el('span', 'vs-legend-item car-one', '● Car 1'));
    legend.appendChild(el('span', 'vs-legend-item car-two', '● Car 2'));
    legend.appendChild(el('span', 'vs-legend-item delta', 'Δ = Car 2 − Car 1'));
    panel.appendChild(legend);

    var body = el('div', 'vs-results-body');

    function makeSection(title, tag, className) {
      var block = el('section', 'vs-result-box ' + (className || ''));
      var sectionHead = el('div', 'vs-result-head');
      sectionHead.appendChild(el('h3', 'vs-result-title', title));
      sectionHead.appendChild(el('span', 'vs-result-tag', tag));
      block.appendChild(sectionHead);
      var table = el('div', 'vs-table');
      var tableHead = el('div', 'vs-row vs-table-head');
      tableHead.appendChild(el('span', 'vs-metric', 'Pull / trap'));
      tableHead.appendChild(el('span', 'vs-car-label car-one', 'Car 1'));
      tableHead.appendChild(el('span', 'vs-car-label car-two', 'Car 2'));
      tableHead.appendChild(el('span', 'vs-delta-label', 'Difference'));
      table.appendChild(tableHead);
      block.appendChild(table);
      return { block: block, table: table };
    }

    function measurementCell(row, key, unit, decimals, startMph, endMph, className) {
      var cell = el('span', (className || 'vs-number'));
      cell.appendChild(el('span', 'vs-time-value', comparisonValue(row[key], unit, decimals)));
      cell.appendChild(el('span', 'vs-distance-value', row[key] == null ? 'Distance unavailable' :
        (function () {
          var distance = modelWindowDistance(row, startMph, endMph);
          return distance == null ? 'Distance unavailable' : distance.toFixed(1) + ' ft';
        })()));
      return cell;
    }

    function deltaCell(row1, row2, key, unit, decimals, startMph, endMph, state) {
      var cell = el('span', 'vs-delta' + state);
      cell.appendChild(el('span', 'vs-time-value', comparisonDelta(row1[key], row2[key], unit, decimals)));
      var distance1 = modelWindowDistance(row1, startMph, endMph);
      var distance2 = modelWindowDistance(row2, startMph, endMph);
      if (distance1 == null || distance2 == null) {
        cell.appendChild(el('span', 'vs-distance-value', 'Distance unavailable'));
      } else if (distance2 !== distance1) {
        var distanceDelta = distance2 - distance1;
        cell.appendChild(el('span', 'vs-distance-value', (distanceDelta >= 0 ? '+' : '') +
          distanceDelta.toFixed(1) + ' ft'));
      }
      return cell;
    }

    function addRow(table, label, key, unit, decimals, extraClass, startMph, endMph) {
      var row = el('div', 'vs-row ' + (extraClass || ''));
      row.appendChild(el('span', 'vs-metric', label));
      row.appendChild(measurementCell(rows[0], key, unit, decimals, startMph, endMph, 'vs-number car-one'));
      row.appendChild(measurementCell(rows[1], key, unit, decimals, startMph, endMph, 'vs-number car-two'));
      var delta = rows[0][key] == null || rows[1][key] == null ? null : rows[1][key] - rows[0][key];
      var state = delta == null ? '' : delta > 0 ? ' slower' : delta < 0 ? ' quicker' : ' even';
      row.appendChild(deltaCell(rows[0], rows[1], key, unit, decimals, startMph, endMph, state));
      table.appendChild(row);
    }

    var signature = makeSection('Signature pulls', 'TIME + DISTANCE IN WINDOW', 'signature-box');
    [['60–130', 't60_130', 60, 130], ['100–150', 't100_150', 100, 150], ['40–120', 't40_120', 40, 120]]
      .forEach(function (pull) { addRow(signature.table, pull[0], pull[1], ' s', 4, 'signature-row', pull[2], pull[3]); });
    body.appendChild(signature.block);

    var results = makeSection('Results', 'TIME + DISTANCE IN WINDOW', 'results-box');
    // Keep 40–60, 40–80, 80–120 and 100–180 out of Results.
    [['40–100', 't40_100', 40, 100], ['50–100', 't50_100', 50, 100], ['60–100', 't60_100', 60, 100],
      ['60–120', 't60_120', 60, 120], ['100–130', 't100_130', 100, 130], ['100–200', 't100_200', 100, 200],
      ['150–200', 't150_200', 150, 200]].forEach(function (pull) {
        addRow(results.table, pull[0], pull[1], ' s', 4, 'results-row', pull[2], pull[3]);
      });
    body.appendChild(results.block);

    function trapMap(row) {
      var map = {};
      (row.dragTraps || []).forEach(function (trap) { map[trap.source] = trap.trapMph; });
      return map;
    }
    var traps1 = trapMap(rows[0]);
    var traps2 = trapMap(rows[1]);
    var trapLabels = {
      eighth: '1/8-mile trap', '1000': '1000-foot trap', quarter: '1/4-mile trap',
      'half-mile': '1/2-mile trap', mile: '1-mile trap'
    };
    var drag = makeSection('Drag racing', 'TRAP SPEED + FIXED DISTANCE', 'drag-box');
    ['eighth', '1000', 'quarter', 'half-mile', 'mile'].forEach(function (source) {
      var row = el('div', 'vs-row vs-trap-row');
      row.appendChild(el('span', 'vs-metric', trapLabels[source]));
      var value1 = traps1[source], value2 = traps2[source];
      var distance = sourceDistanceFt(source);
      function trapCell(value, className) {
        var cell = el('span', 'vs-number ' + className + ' trap-number');
        cell.appendChild(el('span', 'vs-time-value', value == null ? '—' : value.toFixed(2) + ' mph'));
        cell.appendChild(el('span', 'vs-distance-value', distance == null ? 'Distance unavailable' : distance.toFixed(0) + ' ft'));
        return cell;
      }
      row.appendChild(trapCell(value1, 'car-one'));
      row.appendChild(trapCell(value2, 'car-two'));
      var delta = value1 == null || value2 == null ? null : value2 - value1;
      var state = delta == null ? '' : delta > 0 ? ' faster' : delta < 0 ? ' slower' : ' even';
      var deltaCellEl = el('span', 'vs-delta' + state);
      deltaCellEl.appendChild(el('span', 'vs-time-value', delta == null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' mph'));
      row.appendChild(deltaCellEl);
      drag.table.appendChild(row);
    });
    body.appendChild(drag.block);
    panel.appendChild(body);

    function addComparisonGraph() {
      var profiles = rows.map(profileForRow);
      if (profiles.some(function (profile) { return !(profile.trap > 0) || !(profile.distance > 0); })) return;
      var graph = el('div', 'speed-graph vs-graph');
      var graphHead = el('div', 'speed-graph-head');
      graphHead.appendChild(el('span', 'speed-graph-title', 'SPEED / TIME TRACE'));
      var gapLabel = el('span', 'speed-graph-gap-label', 'GAP — HOVER GRAPH');
      graphHead.appendChild(gapLabel);
      graphHead.appendChild(el('span', 'speed-graph-legend', 'X TIME (S)  •  Y SPEED (MPH)  •  HOVER FOR BOTH CARS'));
      graph.appendChild(graphHead);
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 760 300');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Interactive projected speed versus time and distance gap for both cars');
      var ns = 'http://www.w3.org/2000/svg';
      function svgEl(tag, attrs) {
        var node = document.createElementNS(ns, tag);
        Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        return node;
      }
      var left = 58, right = 735, top = 22, bottom = 228;
      var endSpeed = 200;
      var endTimes = profiles.map(function (profile) {
        return Roll.rollTime(profile.distance, 40, endSpeed, profile.trap).seconds;
      });
      var endTime = Math.max.apply(Math, endTimes);
      var speedMarks = [40, 80, 100, 130, 150, 200];
      [0, 50, 100, 150, 200, 250].forEach(function (speedMark) {
        var y = bottom - (speedMark / 250) * (bottom - top);
        svg.appendChild(svgEl('line', { x1: left, y1: y, x2: right, y2: y, class: 'graph-grid' }));
        var label = svgEl('text', { x: left - 10, y: y + 4, class: 'graph-y-label', 'text-anchor': 'end' });
        label.textContent = speedMark;
        svg.appendChild(label);
      });
      svg.appendChild(svgEl('line', { x1: left, y1: bottom, x2: right, y2: bottom, class: 'graph-axis' }));
      var yAxisLabel = svgEl('text', { x: 15, y: (top + bottom) / 2, class: 'graph-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 15 ' + ((top + bottom) / 2) + ')' });
      yAxisLabel.textContent = 'SPEED (MPH)';
      svg.appendChild(yAxisLabel);
      var colors = ['car-one', 'car-two'];
      var allSamples = [];
      profiles.forEach(function (profile, carIndex) {
        var samples = [], points = [];
        for (var sample = 0; sample <= 160; sample++) {
          var mph = 40 + sample;
          var elapsed = mph === 40 ? 0 : Roll.rollTime(profile.distance, 40, mph, profile.trap).seconds;
          var x = left + (elapsed / endTime) * (right - left);
          var y = bottom - (mph / 250) * (bottom - top);
          samples.push({ mph: mph, elapsed: elapsed, x: x, y: y });
          points.push(x.toFixed(2) + ',' + y.toFixed(2));
        }
        allSamples.push(samples);
        svg.appendChild(svgEl('polyline', { points: points.join(' '), class: 'graph-line ' + colors[carIndex] }));
        speedMarks.forEach(function (speedMark) {
          var elapsed = speedMark === 40 ? 0 : Roll.rollTime(profile.distance, 40, speedMark, profile.trap).seconds;
          var x = left + (elapsed / endTime) * (right - left);
          var y = bottom - (speedMark / 250) * (bottom - top);
          svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 3, class: 'graph-dot ' + colors[carIndex] }));
        });
      });
      [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
        var x = left + fraction * (right - left);
        svg.appendChild(svgEl('line', { x1: x, y1: bottom, x2: x, y2: bottom + 5, class: 'graph-axis-tick' }));
        var label = svgEl('text', { x: x, y: bottom + 22, class: 'graph-x-label', 'text-anchor': 'middle' });
        label.textContent = (endTime * fraction).toFixed(2) + ' s';
        svg.appendChild(label);
      });
      var timeLabel = svgEl('text', { x: right, y: bottom + 48, class: 'graph-axis-label', 'text-anchor': 'end' });
      timeLabel.textContent = 'TIME (SECONDS)';
      svg.appendChild(timeLabel);

      var hoverLine = svgEl('line', { x1: left, y1: top, x2: left, y2: bottom, class: 'graph-hover-line' });
      var hoverDots = [0, 1].map(function (index) {
        return svgEl('circle', { cx: left, cy: bottom, r: 5, class: 'graph-hover-dot ' + colors[index] });
      });
      var tooltip = document.createElementNS(ns, 'g');
      tooltip.setAttribute('class', 'graph-tooltip');
      tooltip.setAttribute('visibility', 'hidden');
      var tooltipBg = svgEl('rect', { x: 0, y: 0, width: 278, height: 68, rx: 4, class: 'graph-tooltip-bg' });
      var tooltipText = svgEl('text', { x: 9, y: 17, class: 'graph-tooltip-text' });
      var tooltipText2 = svgEl('text', { x: 9, y: 34, class: 'graph-tooltip-text car-two-text' });
      var tooltipText3 = svgEl('text', { x: 9, y: 55, class: 'graph-tooltip-text gap-text' });
      tooltip.appendChild(tooltipBg); tooltip.appendChild(tooltipText); tooltip.appendChild(tooltipText2); tooltip.appendChild(tooltipText3);
      svg.appendChild(hoverLine);
      hoverDots.forEach(function (dot) { svg.appendChild(dot); });
      svg.appendChild(tooltip);
      var hit = svgEl('rect', { x: left, y: top, width: right - left, height: bottom - top,
        class: 'graph-hitarea', 'aria-label': 'Hover to inspect both car speeds, time, and distance gap' });
      svg.appendChild(hit);

      function pointAtViewX(viewX, samples) {
        var x = Math.max(left, Math.min(right, viewX)), index = 0;
        while (index < samples.length - 2 && samples[index + 1].x < x) index += 1;
        var a = samples[index], b = samples[Math.min(index + 1, samples.length - 1)];
        var span = b.x - a.x, ratio = span > 0 ? (x - a.x) / span : 0;
        return { x: x, y: a.y + (b.y - a.y) * ratio,
          mph: a.mph + (b.mph - a.mph) * ratio,
          elapsed: a.elapsed + (b.elapsed - a.elapsed) * ratio };
      }
      function gapLabelFor(distanceGap) {
        if (distanceGap == null || !isFinite(distanceGap)) return 'GAP UNAVAILABLE';
        var feet = Math.abs(distanceGap).toFixed(1);
        if (Math.abs(distanceGap) < 0.05) return 'EVEN • 0.0 FT';
        return distanceGap > 0 ? 'CAR 2 AHEAD BY ' + feet + ' FT' : 'CAR 1 AHEAD BY ' + feet + ' FT';
      }

      function updateHover(event) {
        var viewX, ctm = svg.getScreenCTM && svg.getScreenCTM();
        if (ctm && ctm.inverse) {
          var svgPoint = svg.createSVGPoint(); svgPoint.x = event.clientX; svgPoint.y = event.clientY;
          viewX = svgPoint.matrixTransform(ctm.inverse()).x;
        } else {
          var bounds = svg.getBoundingClientRect(); if (!bounds.width) return;
          viewX = (event.clientX - bounds.left) / bounds.width * 760;
        }
        var pointsAtX = allSamples.map(function (samples) { return pointAtViewX(viewX, samples); });
        var distancesAtX = pointsAtX.map(function (item, index) {
          return modelDistanceAt(rows[index], item.mph);
        });
        var distanceGap = distancesAtX[1] == null || distancesAtX[0] == null
          ? null : distancesAtX[1] - distancesAtX[0];
        var gapLabelText = gapLabelFor(distanceGap);
        var point = pointsAtX[0];
        var tooltipX = Math.max(left, Math.min(right - 278, point.x - 139));
        var tooltipY = Math.max(top, Math.min(bottom - 74, Math.min(pointsAtX[0].y, pointsAtX[1].y) - 80));
        hoverLine.setAttribute('x1', point.x); hoverLine.setAttribute('x2', point.x);
        pointsAtX.forEach(function (item, index) { hoverDots[index].setAttribute('cx', item.x); hoverDots[index].setAttribute('cy', item.y); });
        tooltip.setAttribute('transform', 'translate(' + tooltipX.toFixed(2) + ' ' + tooltipY.toFixed(2) + ')');
        tooltipText.textContent = 'CAR 1  ' + pointsAtX[0].elapsed.toFixed(2) + ' s  •  ' + pointsAtX[0].mph.toFixed(1) + ' mph';
        tooltipText2.textContent = 'CAR 2  ' + pointsAtX[1].elapsed.toFixed(2) + ' s  •  ' + pointsAtX[1].mph.toFixed(1) + ' mph';
        tooltipText3.textContent = gapLabelText;
        gapLabel.textContent = gapLabelText;
        tooltip.setAttribute('visibility', 'visible');
      }
      hit.addEventListener('pointermove', updateHover);
      hit.addEventListener('pointerenter', updateHover);
      hit.addEventListener('pointerleave', function () { tooltip.setAttribute('visibility', 'hidden'); });
      graph.appendChild(svg); panel.appendChild(graph);
    }

    addComparisonGraph();
    panel.appendChild(el('p', 'vs-note', 'Differences are Car 2 minus Car 1. Positive roll time means Car 2 is slower; positive trap speed means Car 2 is faster.'));
    host.appendChild(panel);
    host.hidden = false;
    host.classList.add('is-visible');
  }

  function onRun() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.car'));
    var statuses = document.querySelectorAll('.status');
    statuses.forEach(function (status) { status.textContent = ''; });
    var rows = cards.map(function (card, i) {
      var input = inputOf(card);
      var filled = Object.keys(input).filter(function (key) {
        return String(input[key] == null ? '' : input[key]).trim() !== '';
      });
      if (filled.length > 1) {
        return {
          ok: false,
          name: '',
          issues: ['Use one input at a time. Clear the other fields before running.']
        };
      }
      var row = Roll.runCar(input);
      if (row.ok && !row.name) row.name = 'Car ' + (i + 1);
      return row;
    });
    var margins = marginsFor(rows);
    var any = false;
    cards.forEach(function (card, i) {
      var status = card.querySelector('.status');
      if (!rows[i].ok) {
        showIssues(card, rows[i].issues);
        if (status) status.textContent = rows[i].issues.join(' ');
      } else {
        any = true;
        // With two cars the shared VS bay owns all results. A lone car keeps
        // the original single-car slip presentation.
        if (rows.length === 1) renderResults(card, rows[i], margins[i]);
        if (status) status.textContent = rows[i].inputMode === 'time'
          ? 'Roll windows projected from 60–130.'
          : (rows[i].trapNote || 'Roll windows from trap speed.');
      }
    });
    renderComparison(rows);
    if (!any && statuses[0]) statuses[0].textContent = 'Enter a trap speed or a 60–130 time to run.';
  }

  function init() {
    var scale = document.getElementById('result-scale');
    var scaleValue = document.getElementById('result-scale-value');
    function applyResultScale() {
      var value = Number(scale && scale.value);
      if (!(value > 0)) value = 1.10;
      document.documentElement.style.setProperty('--result-scale', String(value));
      if (scaleValue) scaleValue.textContent = Math.round(value * 100) + '%';
    }
    if (scale) {
      scale.addEventListener('input', applyResultScale);
      applyResultScale();
    }
    addCar();
    document.getElementById('add').addEventListener('click', addCar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
