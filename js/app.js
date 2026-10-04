/**
 * FromForty page. Trap speed → roll times. Does not load PowerCurve.
 */
(function (global) {
  'use strict';

  var Roll = global.FromFortyRoll;
  if (!Roll || typeof document === 'undefined') return;

  var MAX_CARS = 4;
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

  function renderResults(card, row, margins) {
    var host = card.querySelector('.results');
    host.textContent = '';

    var head = el('div', 'slip-header');
    head.appendChild(el('p', 'result-name', row.name));
    head.appendChild(el('span', 'slip-tag', row.inputMode === 'time'
      ? row.referenceLabel + ' INPUT' : 'TRAP INPUT'));
    host.appendChild(head);

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
      return margin === 0 ? 'quickest' : '+' + margin.toFixed(4) + ' s';
    }

    function addRollRow(block, label, key) {
      var line = el('div', 'pull');
      line.appendChild(el('span', 'pull-name', label));
      var time = row[key];
      if (time == null) {
        line.appendChild(el('span', 'pull-time miss', '—'));
        line.appendChild(el('span', 'pull-margin', row.notes[key] || 'No time'));
      } else {
        line.appendChild(el('span', 'pull-time', time.toFixed(4) + ' s'));
        var m = el('span', 'pull-margin' + (margins[key] === 0 ? ' best' : ''), marginText(key));
        line.appendChild(m);
      }
      block.appendChild(line);
    }

    function addFeature(block, label, key) {
      var metric = el('div', 'metric');
      metric.appendChild(el('span', 'metric-label', 'signature'));
      metric.appendChild(el('span', 'range', label));
      var time = row[key];
      if (time == null) {
        metric.appendChild(el('span', 'time miss', '—'));
        metric.appendChild(el('span', 'metric-margin', row.notes[key] || 'No time'));
      } else {
        metric.appendChild(el('span', 'time', time.toFixed(4) + ' s'));
        metric.appendChild(el('span', 'metric-margin' + (margins[key] === 0 ? ' best' : ''), marginText(key)));
      }
      block.appendChild(metric);
    }

    var slipBody = el('div', 'slip-body');
    var roll = section('Roll Racing', 'SPEED WINDOWS', 'roll-panel');
    var rollLayout = el('div', 'roll-window-layout');
    var feature = el('div', 'card b-feature');
    [
      ['60–130', 't60_130'],
      ['100–150', 't100_150'],
      ['40–120', 't40_120']
    ].forEach(function (pull) { addFeature(feature, pull[0], pull[1]); });
    rollLayout.appendChild(feature);

    var rest = el('div', 'card b-rest');
    var restHead = el('div', 'b-rest-head');
    restHead.appendChild(el('span', null, 'Other windows'));
    restHead.appendChild(el('span', null, 'time'));
    rest.appendChild(restHead);
    [
      ['40–60', 't40_60'],
      ['40–80', 't40_80'],
      ['40–100', 't40_100'],
      ['50–100', 't50_100'],
      ['60–100', 't60_100'],
      ['60–120', 't60_120'],
      ['80–120', 't80_120'],
      ['100–130', 't100_130'],
      ['100–180', 't100_180'],
      ['100–200', 't100_200'],
      ['150–200', 't150_200']
    ].forEach(function (pull) { addRollRow(rest, pull[0], pull[1]); });
    rollLayout.appendChild(rest);
    roll.appendChild(rollLayout);
    slipBody.appendChild(roll);

    var dragTraps = row.dragTraps || [];
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
        quarter: '1/4-mile trap'
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
        dragLine.appendChild(el('span', 'pull-time trap-speed', trap.trapMph.toFixed(2)));
        dragLine.appendChild(el('span', 'pull-margin trap-unit', 'mph'));
        drag.appendChild(dragLine);
      });
    }
    slipBody.appendChild(drag);
    host.appendChild(slipBody);
  }

  function showIssues(card, issues) {
    var host = card.querySelector('.results');
    host.textContent = '';
    issues.forEach(function (text) {
      host.appendChild(el('p', 'error', text));
    });
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
      return input;
    }

    var primary = el('div', 'grid');
    primary.appendChild(field('1/8-mile trap, mph', num('trapEighth')));
    primary.appendChild(field('1000-foot trap, mph', num('trap1000')));
    primary.appendChild(field('1/4-mile trap, mph', num('trapQuarter')));
    primary.appendChild(field('Measured 60–130, sec', num('t60_130')));
    primary.appendChild(field('Measured 100–150, sec', num('t100_150')));

    var runAction = el('div', 'run-action');
    var run = el('button', 'run', 'Run');
    run.type = 'button';
    if (car.id === 1) run.id = 'run';
    run.addEventListener('click', onRun);
    runAction.appendChild(run);
    var status = el('p', 'status', '');
    if (car.id === 1) status.id = 'status';
    runAction.appendChild(status);
    primary.appendChild(runAction);


    var remove = el('button', 'remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      if (cars.length <= 1) return;
      cars = cars.filter(function (c) { return c.id !== car.id; });
      card.remove();
      updateAdd();
    });

    card.appendChild(results);
    card.appendChild(primary);
    card.appendChild(remove);
    document.getElementById('cars').appendChild(card);
    return card;
  }

  function updateAdd() {
    document.getElementById('add').disabled = cars.length >= MAX_CARS;
    document.querySelectorAll('.remove').forEach(function (btn) {
      btn.disabled = cars.length <= 1;
    });
  }

  function addCar() {
    if (cars.length >= MAX_CARS) return;
    var car = blankCar();
    cars.push(car);
    mountCar(car);
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

  function onRun() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.car'));
    var statuses = document.querySelectorAll('.status');
    statuses.forEach(function (status) { status.textContent = ''; });
    var rows = cards.map(function (card, i) {
      var row = Roll.runCar(inputOf(card));
      if (row.ok && !row.name) row.name = 'Car ' + (i + 1);
      return row;
    });
    var margins = marginsFor(rows);
    var any = false;
    cards.forEach(function (card, i) {
      if (!rows[i].ok) showIssues(card, rows[i].issues);
      else {
        any = true;
        renderResults(card, rows[i], margins[i]);
        var status = card.querySelector('.status');
        if (status) status.textContent = rows[i].inputMode === 'time'
          ? 'Roll windows projected from 60–130.'
          : (rows[i].trapNote || 'Roll windows from trap speed.');
      }
    });
    if (!any && statuses[0]) statuses[0].textContent = 'Enter a trap speed or a 60–130 time to run.';
  }

  function init() {
    addCar();
    document.getElementById('add').addEventListener('click', addCar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
