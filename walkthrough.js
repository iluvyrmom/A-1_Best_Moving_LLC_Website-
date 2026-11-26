// walkthrough.js — the move walk-through wizard on quote.html
// Handles step navigation, option-card selection styling, the calendar
// widget, and building the review summary before submit.

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('quote-form');
  if (!form) return; // not on the quote page
  form.setAttribute('data-walkthrough-ready', 'true');

  var steps = Array.prototype.slice.call(form.querySelectorAll('.wizard-step'));
  var progressSteps = Array.prototype.slice.call(document.querySelectorAll('.wp-step'));
  var backBtn = document.getElementById('wizard-back');
  var nextBtn = document.getElementById('wizard-next');
  var submitBtn = document.getElementById('wizard-submit');
  var current = 1;
  var total = steps.length;

  function stepEl(n) {
    return steps.filter(function (s) { return Number(s.getAttribute('data-step')) === n; })[0];
  }

  function updateProgress() {
    progressSteps.forEach(function (p) {
      var n = Number(p.getAttribute('data-step'));
      p.classList.remove('active', 'done');
      if (n === current) p.classList.add('active');
      else if (n < current) p.classList.add('done');
    });
  }

  function validateStep(n) {
    var el = stepEl(n);
    if (!el) return true;
    var requiredRadios = {};
    var ok = true;
    el.querySelectorAll('input[required]').forEach(function (input) {
      if (input.type === 'radio') {
        requiredRadios[input.name] = Boolean(el.querySelector('input[name="' + input.name + '"]:checked'));
      } else if (!input.value.trim()) {
        ok = false;
      }
    });
    Object.keys(requiredRadios).forEach(function (name) {
      if (!requiredRadios[name]) ok = false;
    });
    if (n === 2 && (!datesField || !datesField.value)) ok = false;
    // The final step also needs the native required text/email/tel inputs to be valid
    if (n === total) {
      el.querySelectorAll('input[required]').forEach(function (input) {
        if (input.type !== 'radio' && !input.checkValidity()) ok = false;
      });
    }
    return ok;
  }

  function showStep(n) {
    steps.forEach(function (s) {
      s.hidden = Number(s.getAttribute('data-step')) !== n;
    });
    current = n;
    form.setAttribute('data-current-step', String(n));
    updateProgress();
    backBtn.style.display = n === 1 ? 'none' : 'inline-flex';
    nextBtn.style.display = n === total ? 'none' : 'inline-flex';
    submitBtn.style.display = n === total ? 'inline-flex' : 'none';
    if (n === total) buildSummary();
  }

  nextBtn.addEventListener('click', function () {
    form.setAttribute('data-next-clicks', String(Number(form.getAttribute('data-next-clicks') || '0') + 1));
    var valid = validateStep(current);
    form.setAttribute('data-last-validation', valid ? 'pass' : 'fail');
    if (!valid) {
      nextBtn.classList.add('shake');
      setTimeout(function () { nextBtn.classList.remove('shake'); }, 300);
      var el = stepEl(current);
      if (el) el.style.outline = '2px solid #c0392b';
      setTimeout(function () { if (el) el.style.outline = ''; }, 900);
      return;
    }
    if (current < total) showStep(current + 1);
  });

  backBtn.addEventListener('click', function () {
    if (current > 1) showStep(current - 1);
  });

  // Option-card selected-state fallback (keeps older browsers in sync with :has())
  form.querySelectorAll('.option-card input').forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.type === 'radio') {
        form.querySelectorAll('input[name="' + input.name + '"]').forEach(function (sibling) {
          sibling.closest('.option-card').classList.toggle('selected', sibling.checked);
        });
      } else {
        input.closest('.option-card').classList.toggle('selected', input.checked);
      }
    });
  });

  // ---- Calendar -------------------------------------------------------
  var calGrid = document.getElementById('wcal-grid');
  var calTitle = document.getElementById('wcal-title');
  var calPrev = document.getElementById('wcal-prev');
  var calNext = document.getElementById('wcal-next');
  var calSelectedLabel = document.getElementById('wcal-selected');
  var dateField = document.getElementById('wizard-date-field');
  var datesField = document.getElementById('wizard-dates-field');

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth(); // 0-indexed
  var maxMonthsAhead = 3;
  var selectedISOs = [];
  var availabilityByDate = {};
  var availabilityReady = false;
  var availabilityFailed = false;

  var requestedDate = new URLSearchParams(window.location.search).get('date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '')) {
    var requestedDateObject = new Date(requestedDate + 'T00:00:00');
    if (!Number.isNaN(requestedDateObject.getTime()) && requestedDateObject >= today) {
      selectedISOs = [requestedDate];
      dateField.value = requestedDate;
      datesField.value = requestedDate;
      viewYear = requestedDateObject.getFullYear();
      viewMonth = requestedDateObject.getMonth();
    }
  }

  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function getDateTier(d) {
    var day = d.getDay(); // 0 Sun ... 6 Sat
    var date = d.getDate();
    if (date >= 24 || date <= 7) return 'premium'; // last/first week, any day
    if (day === 0 || day === 5 || day === 6) return 'weekend';
    return 'weekday';
  }

  var tierLabels = {
    premium: ' (high-demand date)',
    weekend: ' (Friday–Sunday)',
    weekday: ' (best midweek availability)'
  };

  function availabilityStatus(iso) {
    if (!availabilityReady) return 'loading';
    if (availabilityFailed) return 'limited';
    return availabilityByDate[iso] || 'unavailable';
  }

  function displayDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function updateSelectedDates() {
    selectedISOs.sort();
    datesField.value = selectedISOs.join(',');
    dateField.value = selectedISOs[0] || '';
    if (!selectedISOs.length) {
      calSelectedLabel.textContent = 'No move days selected yet';
      return;
    }
    var total = selectedISOs.length * 100;
    calSelectedLabel.textContent = selectedISOs.length + (selectedISOs.length === 1 ? ' day' : ' days') +
      ' selected: ' + selectedISOs.map(displayDate).join(' · ') +
      ' — Deposit: $100 × ' + selectedISOs.length + ' = $' + total;
  }

  function renderCalendar() {
    calTitle.textContent = monthNames[viewMonth] + ' ' + viewYear;
    calGrid.innerHTML = '';

    var firstOfMonth = new Date(viewYear, viewMonth, 1);
    var startWeekday = firstOfMonth.getDay();
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (var i = 0; i < startWeekday; i++) {
      var empty = document.createElement('div');
      empty.className = 'wcal-day empty';
      calGrid.appendChild(empty);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(viewYear, viewMonth, day);
      var iso = cellDate.getFullYear() + '-' + String(cellDate.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var cell = document.createElement('div');
      var isPast = cellDate < today;
      var status = isPast ? 'unavailable' : availabilityStatus(iso);
      var statusClass = status === 'available_to_request' ? 'available' : status;
      cell.className = 'wcal-day ' + (isPast ? 'past' : getDateTier(cellDate)) + ' status-' + statusClass;
      if (selectedISOs.indexOf(iso) !== -1) cell.classList.add('selected');
      cell.innerHTML = '<span>' + day + '</span>' + (isPast ? '' : '<span class="dot"></span>');
      if (!isPast && status !== 'unavailable' && status !== 'loading') {
        cell.addEventListener('click', function () {
          var clickedIso = this.getAttribute('data-iso');
          var selectedIndex = selectedISOs.indexOf(clickedIso);
          if (selectedIndex !== -1) {
            selectedISOs.splice(selectedIndex, 1);
          } else if (selectedISOs.length < 14) {
            selectedISOs.push(clickedIso);
          }
          updateSelectedDates();
          renderCalendar();
        });
      }
      cell.setAttribute('data-iso', iso);
      calGrid.appendChild(cell);
    }

    var atMin = viewYear === today.getFullYear() && viewMonth === today.getMonth();
    var monthsAhead = (viewYear - today.getFullYear()) * 12 + (viewMonth - today.getMonth());
    calPrev.disabled = atMin;
    calNext.disabled = monthsAhead >= maxMonthsAhead;
  }

  calPrev.addEventListener('click', function () {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
  });
  calNext.addEventListener('click', function () {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
  });

  renderCalendar();

  // Render immediately, then fill it with verified availability in the
  // background. This keeps the calendar responsive on mobile without ever
  // exposing another customer's information.
  var endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 119);
  var fromISO = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  var toISO = endDate.getFullYear() + '-' + String(endDate.getMonth() + 1).padStart(2, '0') + '-' + String(endDate.getDate()).padStart(2, '0');
  calSelectedLabel.textContent = selectedISOs.length ? 'Checking selected move days…' : 'Checking current availability…';

  fetch('/.netlify/functions/calendar-availability?from=' + encodeURIComponent(fromISO) + '&to=' + encodeURIComponent(toISO))
    .then(function (response) {
      if (!response.ok) throw new Error('Availability request failed');
      return response.json();
    })
    .then(function (payload) {
      if (!payload || !Array.isArray(payload.dates)) throw new Error('Availability response failed');
      payload.dates.forEach(function (entry) {
        availabilityByDate[entry.date] = entry.status;
      });
      availabilityReady = true;
      var beforeCount = selectedISOs.length;
      selectedISOs = selectedISOs.filter(function (iso) {
        return availabilityStatus(iso) !== 'unavailable';
      });
      updateSelectedDates();
      if (beforeCount > selectedISOs.length) {
        calSelectedLabel.textContent = 'One selected day was taken. Please review the remaining move days.';
      }
      renderCalendar();
    })
    .catch(function () {
      availabilityReady = true;
      availabilityFailed = true;
      updateSelectedDates();
      if (!selectedISOs.length) {
        calSelectedLabel.textContent = 'Choose a move day — exact availability is checked again before payment.';
      }
      renderCalendar();
    });

  // ---- Summary on final step -------------------------------------------
  function buildSummary() {
    var box = document.getElementById('wizard-summary');
    if (!box) return;
    var crew = form.querySelector('input[name="crew_size"]:checked');
    var hours = form.querySelector('input[name="hours_requested"]:checked');
    var preferredTime = form.querySelector('input[name="preferred_time"]:checked');
    var access = form.querySelector('input[name="access"]:checked');
    var parking = form.querySelector('input[name="parking"]:checked');
    var fromEl = document.getElementById('from');
    var toEl = document.getElementById('to');

    var lines = [];
    lines.push('<div><strong>Crew:</strong> ' + escapeHtml(crew ? crew.value : '—') + '</div>');
    lines.push('<div><strong>Hours:</strong> ' + escapeHtml(hours ? hours.value : '—') + '</div>');
    lines.push('<div><strong>Move days:</strong> ' + escapeHtml(selectedISOs.length ? selectedISOs.join(', ') : 'Not selected') + (preferredTime ? ' · ' + escapeHtml(preferredTime.value) : '') + '</div>');
    lines.push('<div><strong>Deposit:</strong> $100 × ' + selectedISOs.length + ' = $' + (selectedISOs.length * 100) + '</div>');
    lines.push('<div><strong>Access:</strong> ' + escapeHtml(access ? access.value : '—') + (parking ? ' · ' + escapeHtml(parking.value) : '') + '</div>');
    if ((fromEl && fromEl.value) || (toEl && toEl.value)) {
      lines.push('<div><strong>Route:</strong> ' + escapeHtml(fromEl ? fromEl.value : '') + ' → ' + escapeHtml(toEl ? toEl.value : '') + '</div>');
    }
    box.innerHTML = lines.join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character];
    });
  }

  showStep(1);
});
