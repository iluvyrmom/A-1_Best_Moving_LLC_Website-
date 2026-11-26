(function () {
  var title = document.getElementById('booking-result-title');
  var copy = document.getElementById('booking-result-copy');
  var details = document.getElementById('booking-result-details');
  var receipt = document.getElementById('booking-result-receipt');
  var icon = document.getElementById('booking-result-icon');
  var sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
  var attempts = 0;

  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    showProblem('We could not identify this payment.', 'Return to the booking form and try again.');
    return;
  }

  function checkStatus() {
    attempts += 1;
    fetch('/api/booking-status?session_id=' + encodeURIComponent(sessionId), { cache: 'no-store' })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) throw new Error(body.error || 'Status unavailable');
          return body;
        });
      })
      .then(function (body) {
        if (body.status === 'paid') {
          sessionStorage.removeItem('a1-booking-request-id');
          icon.textContent = '✓';
          icon.classList.add('verified');
          title.textContent = 'Payment verified. Your move days are reserved.';
          copy.textContent = 'A-1 Best Moving received your reservation deposit.';
          var dates = Array.isArray(body.requestedDates) ? body.requestedDates : [];
          var amount = Number(body.amountCents || 0) / 100;
          details.hidden = false;
          details.textContent = (dates.length === 1 ? 'Move day: ' : 'Move days: ') +
            dates.join(', ') + ' · Deposit paid: $' + amount.toFixed(2);
          receipt.hidden = false;
          return;
        }
        if (body.status === 'expired' || body.status === 'cancelled') {
          showProblem('This reservation was not completed.', 'No move day was confirmed. Return to the booking form to try again.');
          return;
        }
        if (attempts < 20) {
          setTimeout(checkStatus, 1500);
        } else {
          title.textContent = 'Payment received—confirmation is still processing.';
          copy.textContent = 'Stripe will email your receipt. Refresh this page in a moment to see the verified reservation.';
        }
      })
      .catch(function () {
        if (attempts < 20) {
          setTimeout(checkStatus, 1500);
        } else {
          title.textContent = 'We are still checking the confirmation.';
          copy.textContent = 'Do not pay again. Stripe will email your receipt if the payment succeeded.';
        }
      });
  }

  function showProblem(problemTitle, problemCopy) {
    icon.textContent = '!';
    icon.classList.add('problem');
    title.textContent = problemTitle;
    copy.textContent = problemCopy;
  }

  checkStatus();
})();
