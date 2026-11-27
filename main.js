// ---------------------------------------------------------------------
// Mason: freeform AI conversation, full two-way voice.
// Ring states on his avatar: rotating = listening/idle, pulsing =
// thinking, solid glow = speaking. Voice input uses the browser's
// built-in speech recognition where available; text input is always
// there as a fallback (and for anyone who'd rather type). Mute toggle
// lets people turn his voice off entirely.
// ---------------------------------------------------------------------
var MASON_GREETING = "A-1 Best Moving, how may I help you?";

document.addEventListener('DOMContentLoaded', function () {
  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.mobile-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var isOpen = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // ---- Mason widget -----------------------------------------------
  var launcher = document.querySelector('.mason-launcher');
  var panel = document.querySelector('.mason-panel');
  var closeBtn = document.querySelector('.mason-panel-close');
  var thread = document.getElementById('mason-thread');
  var micBtn = document.getElementById('mason-mic');
  var muteBtn = document.getElementById('mason-mute');
  var textInput = document.getElementById('mason-text-input');
  var sendBtn = document.getElementById('mason-send');
  var panelAvatar = panel ? panel.querySelector('.mason-panel-head .mason-avatar') : null;

  var hasStarted = false;
  var history = []; // [{role:'user'|'assistant', content:'...'}]
  var conversationId = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : 'a1-web-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  var isMuted = (localStorage.getItem('masonMuted') === 'true');
  var currentAudio = null;
  var lastAudio = null;
  var recognition = null;
  var isListening = false;
  var audioUnlocked = false;
  // ElevenLabs responses can finish out of order. Keep their downloads fast,
  // but serialize playback so Mason can never speak on two tracks at once.
  var speechEpoch = 0;
  var speechQueue = Promise.resolve();
  var pendingSpeechControllers = [];
  var calendarPayload = null;
  var calendarOverlay = null;
  var calendarViewYear = null;
  var calendarViewMonth = null;
  var calendarSelectedISO = null;

  // Mobile browsers only allow audio.play() when it happens right inside a
  // user tap. Our real speak() call happens after a network round-trip, by
  // which point the tap is "too old" and the browser silently blocks it —
  // no error, just silence. The fix: the moment someone taps anything that
  // could lead to Mason speaking, immediately play a near-silent clip
  // synchronously. That one successful play() unlocks audio for the rest
  // of the page session, so the later real audio.play() (after the
  // network call returns) is allowed to actually play.
  function unlockAudio() {
    if (audioUnlocked) { return; }
    audioUnlocked = true;
    try {
      var unlock = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABmYWN0BAAAAAAAAABkYXRhAAAAAA==');
      unlock.play().catch(function () { /* ignore — best effort */ });
    } catch (e) { /* ignore */ }
  }

  function scrollToBottom() {
    if (thread) { thread.scrollTop = thread.scrollHeight; }
  }

  function addBubble(text, isUser) {
    var bubble = document.createElement('div');
    bubble.className = 'mason-bubble' + (isUser ? ' user' : '');
    bubble.textContent = text;
    thread.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function setRingState(state) {
    if (!panelAvatar) { return; }
    panelAvatar.classList.remove('state-thinking', 'state-speaking');
    if (state === 'thinking' || state === 'speaking') {
      panelAvatar.classList.add('state-' + state);
    }
    // default (no class) = rotating = listening/idle
  }

  function updateMuteBtn() {
    if (!muteBtn) { return; }
    muteBtn.textContent = isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    muteBtn.classList.toggle('muted', isMuted);
  }
  updateMuteBtn();

  if (panelAvatar) {
    panelAvatar.addEventListener('click', function () {
      unlockAudio();
      if (panelAvatar.classList.contains('audio-blocked') && lastAudio && !isMuted) {
        var retryAudio = lastAudio;
        stopSpeaking();
        lastAudio = retryAudio;
        currentAudio = retryAudio;
        panelAvatar.classList.remove('audio-blocked');
        setRingState('speaking');
        retryAudio.currentTime = 0;
        var finishRetry = function () {
          if (currentAudio === retryAudio) { currentAudio = null; }
          setRingState('idle');
        };
        retryAudio.addEventListener('ended', finishRetry, { once: true });
        retryAudio.addEventListener('error', finishRetry, { once: true });
        retryAudio.play().catch(function () {
          finishRetry();
          panelAvatar.classList.add('audio-blocked');
        });
      }
    });
  }

  function stopSpeaking() {
    speechEpoch += 1;
    pendingSpeechControllers.forEach(function (controller) { controller.abort(); });
    pendingSpeechControllers = [];
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    speechQueue = Promise.resolve();
  }

  function speak(text) {
    if (isMuted || !text) { setRingState('idle'); return Promise.resolve(); }

    var epoch = speechEpoch;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) { pendingSpeechControllers.push(controller); }
    var requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    };
    if (controller) { requestOptions.signal = controller.signal; }

    // Start generating audio immediately. Playback waits for anything already
    // speaking, so the site stays responsive without overlapping voices.
    var audioRequest = fetch('/.netlify/functions/mason-speak', requestOptions)
      .then(function (res) {
        if (res.status === 204 || !res.ok) { return null; }
        return res.json();
      })
      .finally(function () {
        if (!controller) { return; }
        pendingSpeechControllers = pendingSpeechControllers.filter(function (item) { return item !== controller; });
      });

    var playback = speechQueue
      .catch(function () { /* keep the single-track queue moving */ })
      .then(function () { return audioRequest; })
      .then(function (data) {
        if (epoch !== speechEpoch || isMuted || !data || !data.audio) { return; }
        setRingState('speaking');
        var audio = new Audio('data:' + data.mime + ';base64,' + data.audio);
        audio.preload = 'auto';
        currentAudio = audio;
        lastAudio = audio;
        return new Promise(function (resolve) {
          var settled = false;
          var finish = function (wasBlocked) {
            if (settled) { return; }
            settled = true;
            if (currentAudio === audio) { currentAudio = null; }
            if (epoch === speechEpoch) { setRingState('idle'); }
            if (wasBlocked && panelAvatar) { panelAvatar.classList.add('audio-blocked'); }
            resolve();
          };
          audio.addEventListener('ended', function () { finish(false); }, { once: true });
          audio.addEventListener('error', function () { finish(false); }, { once: true });
          audio.play().catch(function () {
            // Autoplay was blocked even after the unlock attempt — leave a
            // visible way to retry instead of failing completely silently.
            finish(true);
          });
        });
      })
      .catch(function (error) {
        if (epoch === speechEpoch && (!error || error.name !== 'AbortError')) { setRingState('idle'); }
      });

    speechQueue = playback.catch(function () { /* keep later speech available */ });
    return playback;
  }

  function showTyping() {
    var typing = document.createElement('div');
    typing.className = 'mason-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    thread.appendChild(typing);
    scrollToBottom();
    return typing;
  }

  function calendarDateLabel(iso) {
    var date = new Date(iso + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function ensureCalendarOverlay() {
    if (calendarOverlay) { return calendarOverlay; }

    calendarOverlay = document.createElement('div');
    calendarOverlay.className = 'mason-calendar-overlay';
    calendarOverlay.setAttribute('aria-hidden', 'true');
    calendarOverlay.innerHTML = [
      '<div class="mason-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="mason-calendar-title">',
      '  <button type="button" class="mason-calendar-close" aria-label="Close calendar">✕</button>',
      '  <div class="mason-calendar-kicker">A-1 Best Moving</div>',
      '  <h2 id="mason-calendar-title">Available move dates</h2>',
      '  <p class="mason-calendar-sub">Customer details stay private. Open dates are requests until availability and the deposit are verified.</p>',
      '  <div class="wcal-head">',
      '    <button type="button" class="wcal-nav mason-cal-prev" aria-label="Previous month">←</button>',
      '    <span class="wcal-title mason-cal-title"></span>',
      '    <button type="button" class="wcal-nav mason-cal-next" aria-label="Next month">→</button>',
      '  </div>',
      '  <div class="wcal-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>',
      '  <div class="wcal-grid mason-cal-grid"></div>',
      '  <div class="wcal-legend">',
      '    <span><i class="dot dot-save"></i> Available to request</span>',
      '    <span><i class="dot dot-premium"></i> Limited</span>',
      '    <span><i class="dot dot-unavailable"></i> Unavailable</span>',
      '  </div>',
      '  <p class="mason-calendar-selection" aria-live="polite">Choose an available date</p>',
      '  <a class="btn btn-accent mason-calendar-continue" href="quote.html#quote-form">Continue booking request</a>',
      '</div>'
    ].join('');
    document.body.appendChild(calendarOverlay);

    calendarOverlay.querySelector('.mason-calendar-close').addEventListener('click', closeMasonCalendar);
    calendarOverlay.querySelector('.mason-cal-prev').addEventListener('click', function () {
      calendarViewMonth -= 1;
      if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear -= 1; }
      renderMasonCalendar();
    });
    calendarOverlay.querySelector('.mason-cal-next').addEventListener('click', function () {
      calendarViewMonth += 1;
      if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear += 1; }
      renderMasonCalendar();
    });
    calendarOverlay.addEventListener('click', function (event) {
      if (event.target === calendarOverlay) { closeMasonCalendar(); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && calendarOverlay.classList.contains('open')) { closeMasonCalendar(); }
    });
    return calendarOverlay;
  }

  function renderMasonCalendar() {
    if (!calendarPayload || !calendarOverlay) { return; }
    var grid = calendarOverlay.querySelector('.mason-cal-grid');
    var title = calendarOverlay.querySelector('.mason-cal-title');
    var prev = calendarOverlay.querySelector('.mason-cal-prev');
    var next = calendarOverlay.querySelector('.mason-cal-next');
    var firstAvailableDate = new Date(calendarPayload.from + 'T00:00:00');
    var lastAvailableDate = new Date(calendarPayload.to + 'T00:00:00');
    var viewDate = new Date(calendarViewYear, calendarViewMonth, 1);
    var minMonth = new Date(firstAvailableDate.getFullYear(), firstAvailableDate.getMonth(), 1);
    var maxMonth = new Date(lastAvailableDate.getFullYear(), lastAvailableDate.getMonth(), 1);
    var availability = {};
    calendarPayload.dates.forEach(function (entry) { availability[entry.date] = entry.status; });

    title.textContent = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    prev.disabled = viewDate <= minMonth;
    next.disabled = viewDate >= maxMonth;
    grid.innerHTML = '';

    var startWeekday = new Date(calendarViewYear, calendarViewMonth, 1).getDay();
    var daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
    for (var emptyIndex = 0; emptyIndex < startWeekday; emptyIndex += 1) {
      var empty = document.createElement('div');
      empty.className = 'wcal-day empty';
      grid.appendChild(empty);
    }

    for (var day = 1; day <= daysInMonth; day += 1) {
      var date = new Date(calendarViewYear, calendarViewMonth, day);
      var iso = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var status = availability[iso];
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'wcal-day';
      cell.innerHTML = '<span>' + day + '</span><span class="dot"></span>';
      cell.setAttribute('data-iso', iso);

      if (!status || status === 'unavailable') {
        cell.disabled = true;
        cell.classList.add('status-unavailable');
        cell.setAttribute('aria-label', calendarDateLabel(iso) + ', unavailable');
      } else {
        cell.classList.add(status === 'limited' ? 'status-limited' : 'status-available');
        cell.setAttribute('aria-label', calendarDateLabel(iso) + ', ' + (status === 'limited' ? 'limited availability' : 'available to request'));
        cell.addEventListener('click', function () {
          calendarSelectedISO = this.getAttribute('data-iso');
          renderMasonCalendar();
        });
      }
      if (iso === calendarSelectedISO) { cell.classList.add('selected'); }
      grid.appendChild(cell);
    }

    var selection = calendarOverlay.querySelector('.mason-calendar-selection');
    var continueLink = calendarOverlay.querySelector('.mason-calendar-continue');
    if (calendarSelectedISO) {
      selection.textContent = 'Selected: ' + calendarDateLabel(calendarSelectedISO);
      continueLink.href = 'quote.html?date=' + encodeURIComponent(calendarSelectedISO) + '#quote-form';
      continueLink.classList.add('ready');
    } else {
      selection.textContent = 'Choose an available date';
      continueLink.classList.remove('ready');
    }
  }

  function openMasonCalendar(payload) {
    if (!payload || !Array.isArray(payload.dates) || !payload.from || !payload.to) { return; }
    calendarPayload = payload;
    var firstDate = new Date(payload.from + 'T00:00:00');
    calendarViewYear = firstDate.getFullYear();
    calendarViewMonth = firstDate.getMonth();
    calendarSelectedISO = null;
    ensureCalendarOverlay();
    renderMasonCalendar();
    calendarOverlay.classList.add('open');
    calendarOverlay.setAttribute('aria-hidden', 'false');
    calendarOverlay.querySelector('.mason-calendar-close').focus();
  }

  function closeMasonCalendar() {
    if (!calendarOverlay) { return; }
    calendarOverlay.classList.remove('open');
    calendarOverlay.setAttribute('aria-hidden', 'true');
  }

  function addCalendarAction(payload) {
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'mason-calendar-action';
    action.textContent = 'View available dates';
    action.addEventListener('click', function () { openMasonCalendar(payload); });
    thread.appendChild(action);
    scrollToBottom();
  }

  // Some phone browsers report one spoken sentence several times in a row,
  // and a fast double tap can do the same. Every message leaves the page
  // through here, so this is the one place that refuses an exact repeat
  // sent moments apart. A customer who truly repeats themselves later is
  // still heard.
  var DUPLICATE_WINDOW_MS = 3000;
  var lastSentText = '';
  var lastSentAt = 0;

  function sendToMason(userText) {
    if (!userText) { return; }
    var normalized = userText.replace(/\s+/g, ' ').trim().toLowerCase();
    var now = Date.now();
    if (normalized === lastSentText && now - lastSentAt < DUPLICATE_WINDOW_MS) { return; }
    lastSentText = normalized;
    lastSentAt = now;
    addBubble(userText, true);
    history.push({ role: 'user', content: userText });
    if (textInput) { textInput.value = ''; }
    setRingState('thinking');
    setVoiceStatus('thinking');
    var typing = showTyping();

    fetch('/.netlify/functions/mason-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conversationId, message: userText })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { throw new Error(data && data.error ? data.error : 'Mason request failed'); }
          return data;
        });
      })
      .then(function (data) {
        typing.remove();
        var reply = (data && data.reply) ? data.reply : "Sorry, I'm having trouble connecting right now \u2014 mind trying again in a moment?";
        addBubble(reply, false);
        history.push({ role: 'assistant', content: reply });
        if (data && data.calendar && data.calendar.show) {
          addCalendarAction(data.calendar);
          openMasonCalendar(data.calendar);
        }
        setVoiceStatus(handsFree ? 'speaking' : 'idle');
        speak(reply).then(resumeHandsFree, resumeHandsFree);
      })
      .catch(function () {
        // Let the customer resend the same words right away after a failure.
        lastSentText = '';
        typing.remove();
        setRingState('idle');
        addBubble("Sorry, I'm having trouble connecting right now \u2014 mind trying again in a moment?", false);
        resumeHandsFree();
      });
  }

  // ---- Text input ----
  if (sendBtn && textInput) {
    sendBtn.addEventListener('click', function () { endHandsFree(); stopSpeaking(); unlockAudio(); sendToMason(textInput.value.trim()); });
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { endHandsFree(); stopSpeaking(); unlockAudio(); sendToMason(textInput.value.trim()); }
    });
  }

  // ---- Mute toggle ----
  if (muteBtn) {
    muteBtn.addEventListener('click', function () {
      isMuted = !isMuted;
      localStorage.setItem('masonMuted', isMuted ? 'true' : 'false');
      updateMuteBtn();
      if (isMuted) { stopSpeaking(); setRingState('idle'); }
    });
  }

  // ---- Voice input (mic): hands-free conversation ----
  // One tap on the mic starts a hands-free conversation: the customer
  // talks, Mason answers out loud, then the mic turns itself back on so
  // they can simply keep talking. Mason never listens while he is
  // speaking (so he can't hear himself). After two quiet turns in a row
  // the mic rests, and a status line explains how to continue.
  //
  // Phones end a listening session at the first short pause, which made
  // Mason answer before the customer finished. So each finished piece is
  // collected, the mic keeps listening, and the whole message is sent only
  // after SILENCE_BEFORE_SEND_MS of quiet. Tapping the mic while talking
  // sends right away.
  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SILENCE_BEFORE_SEND_MS = 2000;
  var handsFree = false;
  var quietTurns = 0;
  var heardSpeech = false;
  var sentThisTurn = false;
  var resumeTimer = null;
  var sendTimer = null;
  var pendingSpeech = '';   // finished pieces of this turn, oldest first
  var sessionFinal = '';    // finished words from the current listening session
  var sessionLive = '';     // words still being recognized in this session
  var MAX_QUIET_TURNS = 2;

  var voiceStatus = null;
  var inputRow = panel ? panel.querySelector('.mason-input-row') : null;
  if (inputRow && inputRow.parentNode && typeof document.createElement === 'function') {
    voiceStatus = document.createElement('div');
    voiceStatus.className = 'mason-voice-status';
    voiceStatus.setAttribute('aria-live', 'polite');
    inputRow.parentNode.insertBefore(voiceStatus, inputRow.nextSibling);
  }
  var VOICE_TEXT = {
    idle: 'Tap the microphone to talk with Mason, or type below.',
    listening: 'Listening… take your time. Mason replies when you pause.',
    thinking: 'Mason is thinking…',
    speaking: 'Mason is answering. The microphone turns back on when he finishes.',
    resting: 'Tap the microphone whenever you’re ready to keep talking.',
    tapToAnswer: 'Tap the microphone to answer Mason.',
    allowMic: 'To talk out loud, allow the microphone for this site. You can also type below.',
    typeOnly: 'Type your message below to chat with Mason.'
  };
  function setVoiceStatus(key) {
    if (!voiceStatus) { return; }
    if (!recognition && key !== 'thinking') { key = 'typeOnly'; }
    voiceStatus.textContent = VOICE_TEXT[key] || VOICE_TEXT.idle;
    voiceStatus.setAttribute('data-state', key);
  }

  function joinWords(first, second) {
    return (String(first || '') + ' ' + String(second || '')).replace(/\s+/g, ' ').trim();
  }

  function clearSendTimer() {
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  }

  function clearPendingSpeech() {
    clearSendTimer();
    pendingSpeech = '';
    sessionFinal = '';
    sessionLive = '';
  }

  function wordsSoFar() {
    return joinWords(pendingSpeech, sessionFinal || sessionLive);
  }

  // The customer has finished: stop listening and send everything once.
  function finishTurn() {
    var message = wordsSoFar();
    clearPendingSpeech();
    if (!message || sentThisTurn) { return; }
    sentThisTurn = true;
    quietTurns = 0;
    if (recognition && isListening) { try { recognition.stop(); } catch (err) { /* ignore */ } }
    stopSpeaking();
    sendToMason(message);
  }

  function startListening() {
    if (!recognition || isListening || !panel.classList.contains('open')) { return false; }
    heardSpeech = false;
    sessionFinal = '';
    sessionLive = '';
    try {
      recognition.start();
      return true;
    } catch (err) {
      return false;
    }
  }

  function endHandsFree() {
    handsFree = false;
    quietTurns = 0;
    clearPendingSpeech();
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    if (recognition && isListening) { try { recognition.stop(); } catch (err) { /* ignore */ } }
  }

  // Called after Mason finishes answering (or if the answer failed).
  function resumeHandsFree() {
    if (!handsFree) { setVoiceStatus('idle'); return; }
    if (resumeTimer) { clearTimeout(resumeTimer); }
    // Short pause so the tail of Mason's voice isn't picked up.
    resumeTimer = setTimeout(function () {
      resumeTimer = null;
      if (!handsFree) { return; }
      sentThisTurn = false;
      clearPendingSpeech();
      if (!startListening()) { setVoiceStatus('tapToAnswer'); }
    }, 350);
  }

  if (SpeechRecognitionCtor && micBtn) {
    recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.addEventListener('start', function () {
      isListening = true;
      micBtn.classList.add('active');
      setVoiceStatus('listening');
    });
    recognition.addEventListener('result', function (e) {
      if (sentThisTurn) { return; }
      // Rebuild from the full list every time, so a phone that reports the
      // same words twice changes nothing.
      var finalText = '';
      var liveText = '';
      for (var i = 0; i < e.results.length; i++) {
        var piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) { finalText += piece; } else { liveText += piece; }
      }
      finalText = finalText.trim();
      liveText = liveText.trim();
      if (!finalText && !liveText) { return; }
      heardSpeech = true;
      quietTurns = 0;
      clearSendTimer(); // still talking
      stopSpeaking();
      sessionFinal = finalText;
      sessionLive = joinWords(finalText, liveText);
      // Show the customer their words as they speak.
      if (textInput) { textInput.value = wordsSoFar(); }
    });
    recognition.addEventListener('error', function (e) {
      isListening = false;
      micBtn.classList.remove('active');
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        endHandsFree();
        setVoiceStatus('allowMic');
      }
    });
    recognition.addEventListener('end', function () {
      isListening = false;
      micBtn.classList.remove('active');
      if (sentThisTurn) { return; } // Mason is now answering.
      if (voiceStatus && voiceStatus.getAttribute('data-state') === 'allowMic') { return; }

      // Keep what was said in this session, then keep listening for more.
      var heardThisSession = sessionFinal || sessionLive;
      if (heardThisSession) { pendingSpeech = joinWords(pendingSpeech, heardThisSession); }
      sessionFinal = '';
      sessionLive = '';

      if (pendingSpeech) {
        clearSendTimer();
        sendTimer = setTimeout(function () { sendTimer = null; finishTurn(); }, SILENCE_BEFORE_SEND_MS);
        if (!startListening()) { clearSendTimer(); finishTurn(); }
        return;
      }

      if (!handsFree) { setVoiceStatus('idle'); return; }
      if (!heardSpeech) { quietTurns += 1; }
      if (quietTurns >= MAX_QUIET_TURNS) {
        endHandsFree();
        setVoiceStatus('resting');
        return;
      }
      if (!startListening()) { setVoiceStatus('tapToAnswer'); }
    });

    micBtn.addEventListener('click', function () {
      unlockAudio();
      if (wordsSoFar()) {
        // Tapping while talking means "I'm done": send now.
        finishTurn();
        return;
      }
      if (isListening || (handsFree && resumeTimer)) {
        // Tapping again ends the hands-free conversation.
        endHandsFree();
        setVoiceStatus('idle');
        return;
      }
      stopSpeaking();
      handsFree = true;
      quietTurns = 0;
      sentThisTurn = false;
      if (!startListening()) { setVoiceStatus('tapToAnswer'); }
    });
  } else if (micBtn) {
    // Voice input unsupported in this browser (e.g. an iOS in-app browser) —
    // disable the mic but leave typing and Mason's spoken replies working.
    micBtn.disabled = true;
    micBtn.title = 'Voice input isn’t available in this browser — type your message instead';
  }
  setVoiceStatus('idle');

  function openPanel() {
    panel.classList.add('open');
    if (launcher) { launcher.setAttribute('aria-expanded', 'true'); }
    if (!hasStarted && thread) {
      hasStarted = true;
      addBubble(MASON_GREETING, false);
      history.push({ role: 'assistant', content: MASON_GREETING });
      speak(MASON_GREETING);
    }
  }
  function closePanel() {
    panel.classList.remove('open');
    if (launcher) { launcher.setAttribute('aria-expanded', 'false'); }
    stopSpeaking();
    setRingState('idle');
    endHandsFree();
    setVoiceStatus('idle');
  }

  if (launcher && panel) {
    launcher.addEventListener('click', function () {
      unlockAudio();
      if (panel.classList.contains('open')) { closePanel(); } else { openPanel(); }
    });
  }
  if (closeBtn) { closeBtn.addEventListener('click', closePanel); }

  // Any button with class "mason-trigger" (hero, quote sidebar, etc.) opens the same chat panel
  var triggers = document.querySelectorAll('.mason-trigger');
  if (triggers.length && panel) {
    triggers.forEach(function (el) {
      el.addEventListener('click', function () {
        unlockAudio();
        openPanel();
        if (!document.body.classList.contains('reference-home')) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        var starterMessage = el.getAttribute('data-mason-message');
        if (starterMessage && el.getAttribute('data-mason-sent') !== 'true') {
          el.setAttribute('data-mason-sent', 'true');
          // Let the greeting render first, then hand Mason the customer's
          // one-tap crew choice so he can continue with date, route, and contact.
          setTimeout(function () { sendToMason(starterMessage); }, 150);
        }
      });
    });
  }

  // Quote form: A-1 asks HURKL to hold the selected days, then A-1's own
  // server creates Stripe Checkout. Card data stays on Stripe's hosted page.
  var quoteForm = document.querySelector('#quote-form');
  if (quoteForm) {
    var paymentMessage = document.getElementById('payment-message');
    if (new URLSearchParams(window.location.search).get('payment') === 'cancelled' && paymentMessage) {
      paymentMessage.textContent = 'Payment was canceled. Your move days are not confirmed; you can review the form and try again.';
      paymentMessage.classList.add('show');
    }

    quoteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submitBtn = quoteForm.querySelector('button[type="submit"]');
      var originalLabel = submitBtn ? submitBtn.textContent : '';
      var data = new FormData(quoteForm);
      var moveDates = String(data.get('move_dates') || '').split(',').filter(Boolean);
      var requestId = sessionStorage.getItem('a1-booking-request-id');
      if (!requestId) {
        requestId = (window.crypto && typeof window.crypto.randomUUID === 'function')
          ? window.crypto.randomUUID()
          : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12);
        sessionStorage.setItem('a1-booking-request-id', requestId);
      }
      var checkoutRequest = {
        requestId: requestId,
        name: data.get('name'),
        phone: data.get('phone'),
        email: data.get('email'),
        from: data.get('from'),
        to: data.get('to'),
        moveDates: moveDates,
        preferredTime: data.get('preferred_time'),
        crewSize: data.get('crew_size'),
        hoursRequested: data.get('hours_requested'),
        access: data.get('access'),
        parking: data.get('parking'),
        notes: data.get('notes')
      };

      if (paymentMessage) {
        paymentMessage.textContent = '';
        paymentMessage.classList.remove('show');
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Opening secure checkout…'; }

      fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutRequest)
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok) {
              var error = new Error(body.error || 'Secure payment could not be opened.');
              error.status = response.status;
              throw error;
            }
            return body;
          });
        })
        .then(function (body) {
          if (!body.checkoutUrl) throw new Error('Secure payment could not be opened.');

          // Netlify Forms keeps a non-authoritative checkout-started backup.
          // Paid/confirmed state comes only from Stripe's signed webhook.
          fetch('/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(data).toString(),
            keepalive: true
          }).catch(function () {});
          window.location.assign(body.checkoutUrl);
        })
        .catch(function (error) {
          if (error && error.status === 409) {
            sessionStorage.removeItem('a1-booking-request-id');
          }
          if (paymentMessage) {
            paymentMessage.textContent = error && error.message
              ? error.message
              : 'Secure payment could not be opened. Please try again.';
            paymentMessage.classList.add('show');
            paymentMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        })
        .finally(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
        });
    });
  }
});
