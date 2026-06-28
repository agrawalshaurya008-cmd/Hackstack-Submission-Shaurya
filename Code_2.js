const CONFIG = {
  apiBase: "https://opentdb.com/api.php",
  categoriesUrl: "https://opentdb.com/api_category.php",
  timePerQuestion: 20,
  multiAnswerRatio: 0.35,
  scoring: {
    singleCorrect: 3,
    singleIncorrect: -1,
    multiAllCorrect: 4,
    multiPartialPerOption: 1,
    multiAnyWrongPenalty: -2,
  },
  speedBonus: [
    { minSeconds: 15, bonus: 2 },
    { minSeconds: 5,  bonus: 1 },
    { minSeconds: 0,  bonus: 0 },
  ],
};

const state = {
  questions: [],
  currentIndex: 0,
  score: 0,
  speedBonusTotal: 0,
  correctCount: 0,
  incorrectCount: 0,
  selected: new Set(),
  answered: false,
  timer: {
    remaining: CONFIG.timePerQuestion,
    intervalId: null,
  },
  log: [],
};

const el = {
  screens: {
    setup: document.getElementById("screen-setup"),
    loading: document.getElementById("screen-loading"),
    error: document.getElementById("screen-error"),
    quiz: document.getElementById("screen-quiz"),
    results: document.getElementById("screen-results"),
  },
  selectCategory: document.getElementById("select-category"),
  selectDifficulty: document.getElementById("select-difficulty"),
  selectCount: document.getElementById("select-count"),
  btnStart: document.getElementById("btn-start"),
  setupStatus: document.getElementById("setup-status"),
  errorMessage: document.getElementById("error-message"),
  btnRetry: document.getElementById("btn-retry"),
  qCurrent: document.getElementById("q-current"),
  qTotal: document.getElementById("q-total"),
  qTypeTag: document.getElementById("q-type-tag"),
  qScore: document.getElementById("q-score"),
  qCategory: document.getElementById("q-category"),
  qDifficulty: document.getElementById("q-difficulty"),
  qText: document.getElementById("q-text"),
  qInstruction: document.getElementById("q-instruction"),
  optionsContainer: document.getElementById("options-container"),
  progressFill: document.getElementById("progress-fill"),
  btnSubmit: document.getElementById("btn-submit"),
  btnNext: document.getElementById("btn-next"),
  timerRing: document.getElementById("timer-ring"),
  timerProgress: document.getElementById("timer-progress"),
  timerNum: document.getElementById("timer-num"),
  finalScore: document.getElementById("final-score"),
  finalPct: document.getElementById("final-pct"),
  statTotal: document.getElementById("stat-total"),
  statCorrect: document.getElementById("stat-correct"),
  statIncorrect: document.getElementById("stat-incorrect"),
  statBonus: document.getElementById("stat-bonus"),
  stampMark: document.getElementById("stamp-mark"),
  reviewList: document.getElementById("review-list"),
  btnReviewToggle: document.getElementById("btn-review-toggle"),
  btnRestart: document.getElementById("btn-restart"),
  toast: document.getElementById("toast"),
};

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 27;
let toastTimeoutId = null;

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, screen]) => {
    if (screen) screen.classList.toggle("active", key === name);
  });
}

function decodeHtml(str) {
  if (!str) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(str, "text/html");
  return doc.documentElement.textContent || "";
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showToast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => el.toast.classList.remove("show"), 2600);
}

function getSpeedBonus(secondsRemaining) {
  const tier = CONFIG.speedBonus.find(t => secondsRemaining >= t.minSeconds);
  return tier ? tier.bonus : 0;
}

async function loadCategories() {
  try {
    const res = await fetch(CONFIG.categoriesUrl);
    if (!res.ok) throw new Error("Category request failed");
    
    const data = await res.json();
    const cats = data.trivia_categories || [];
    
    if (!el.selectCategory) return;
    
    cats.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      el.selectCategory.appendChild(opt);
    });
  } catch (err) {
    console.warn("Could not load categories:", err);
    if (el.setupStatus) {
      el.setupStatus.textContent = "Category list unavailable — you can still start with 'Any category'.";
    }
  }
}

async function fetchQuestions({ category, difficulty, amount }) {
  const params = new URLSearchParams({ amount: String(amount), type: "multiple" });
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);

  const res = await fetch(`${CONFIG.apiBase}?${params}`);
  if (!res.ok) throw new Error(`Network error (${res.status})`);
  
  const data = await res.json();
  
  switch (data.response_code) {
    case 1:
      throw new Error("Not enough questions exist for that combination. Try a broader selection.");
    case 0:
      if (data.results?.length) return data.results;
      throw new Error("No questions came back for that selection.");
    default:
      throw new Error("The question bank returned an unexpected error response.");
  }
}
function normalizeSingle(raw) {
  const correct = decodeHtml(raw.correct_answer);
  const options = shuffle([correct, ...raw.incorrect_answers.map(decodeHtml)]).map((text, i) => ({
    id: `o${i}`,
    text,
  }));
  
  return {
    type: "single",
    category: decodeHtml(raw.category),
    difficulty: raw.difficulty,
    question: decodeHtml(raw.question),
    options,
    correctIds: options.filter(o => o.text === correct).map(o => o.id),
  };
}

function buildMultiFromPair(rawA, rawB) {
  const correctA = decodeHtml(rawA.correct_answer);
  const correctB = decodeHtml(rawB.correct_answer);
  const distractors = shuffle([
    ...rawA.incorrect_answers.map(decodeHtml),
    ...rawB.incorrect_answers.map(decodeHtml),
  ]).slice(0, 2);

  const options = shuffle([correctA, correctB, ...distractors]).map((text, i) => ({ id: `o${i}`, text }));
  const topic = decodeHtml(rawA.category);

  return {
    type: "multi",
    category: topic,
    difficulty: rawA.difficulty,
    question: `Which of the following statements are true regarding ${topic}?`,
    sourceFacts: [
      `${decodeHtml(rawA.question)} → ${correctA}`,
      `${decodeHtml(rawB.question)} → ${correctB}`,
    ],
    options,
    correctIds: options.filter(o => o.text === correctA || o.text === correctB).map(o => o.id),
  };
}

function buildQuestionSet(rawResults, amount) {
  const desiredMulti = Math.round(amount * CONFIG.multiAnswerRatio);
  const pool = shuffle(rawResults);
  const questions = [];
  let i = 0;
  let multiBuilt = 0;

  while (i < pool.length && questions.length < amount) {
    if (multiBuilt < desiredMulti && i + 1 < pool.length) {
      questions.push(buildMultiFromPair(pool[i], pool[i + 1]));
      i += 2;
      multiBuilt++;
    } else {
      questions.push(normalizeSingle(pool[i]));
      i++;
    }
  }
  return shuffle(questions).slice(0, amount);
}
async function startQuiz() {
  const category = el.selectCategory?.value;
  const difficulty = el.selectDifficulty?.value;
  const amount = parseInt(el.selectCount?.value || "10", 10);
  const fetchAmount = Math.min(50, amount + Math.ceil(amount * CONFIG.multiAnswerRatio));

  showScreen("loading");
  try {
    const raw = await fetchQuestions({ category, difficulty, amount: fetchAmount });
    const questions = buildQuestionSet(raw, amount);
    if (!questions.length) throw new Error("No questions could be built from the response.");

    resetQuizState(questions);
    showScreen("quiz");
    renderQuestion();
  } catch (err) {
    if (el.errorMessage) el.errorMessage.textContent = err.message || "Something interrupted the connection.";
    showScreen("error");
  }
}

function resetQuizState(questions) {
  Object.assign(state, {
    questions,
    currentIndex: 0,
    score: 0,
    speedBonusTotal: 0,
    correctCount: 0,
    incorrectCount: 0,
    log: [],
  });
  if (el.qTotal) el.qTotal.textContent = questions.length;
  if (el.qScore) el.qScore.textContent = "0";
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  state.selected.clear();
  state.answered = false;

  if (el.qCurrent) el.qCurrent.textContent = state.currentIndex + 1;
  if (el.qCategory) el.qCategory.textContent = q.category;
  if (el.qDifficulty) el.qDifficulty.textContent = q.difficulty;
  if (el.qText) el.qText.textContent = q.question;
  if (el.qTypeTag) el.qTypeTag.textContent = q.type === "multi" ? "Multiple answer" : "Single answer";
  if (el.qInstruction) {
    el.qInstruction.textContent = q.type === "multi" ? "Select every option you think is correct." : "Select one answer.";
  }

  if (el.optionsContainer) {
    el.optionsContainer.dataset.type = q.type;
    el.optionsContainer.innerHTML = "";

    q.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.type = "button";
      btn.dataset.id = opt.id;
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = `
        <span class="option-marker">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="option-text"></span>
      `;
      btn.querySelector(".option-text").textContent = opt.text;
      btn.addEventListener("click", () => toggleOption(opt.id, q.type));
      el.optionsContainer.appendChild(btn);
    });
  }

  if (el.btnSubmit) {
    el.btnSubmit.disabled = true;
    el.btnSubmit.classList.remove("hidden");
  }
  if (el.btnNext) el.btnNext.classList.add("hidden");
  if (el.progressFill) el.progressFill.style.width = `${(state.currentIndex / state.questions.length) * 100}%`;

  startTimer();
}

function toggleOption(id, type) {
  if (state.answered) return;

  if (type === "single") {
    state.selected = new Set([id]);
  } else {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  }

  el.optionsContainer?.querySelectorAll(".option").forEach((btn) => {
    const isSelected = state.selected.has(btn.dataset.id);
    btn.classList.toggle("selected", isSelected);
    btn.setAttribute("aria-pressed", String(isSelected));
  });

  if (el.btnSubmit) el.btnSubmit.disabled = state.selected.size === 0;
}

function startTimer() {
  clearInterval(state.timer.intervalId);
  state.timer.remaining = CONFIG.timePerQuestion;
  updateTimerDisplay();

  state.timer.intervalId = setInterval(() => {
    state.timer.remaining--;
    updateTimerDisplay();

    if (state.timer.remaining <= 0) {
      clearInterval(state.timer.intervalId);
      if (!state.answered) {
        showToast("Time's up — auto-submitting.");
        submitAnswer({ timedOut: true });
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  const { remaining } = state.timer;
  const safeRemaining = Math.max(remaining, 0);

  if (el.timerNum) el.timerNum.textContent = safeRemaining;
  
  if (el.timerProgress) {
    const fraction = safeRemaining / CONFIG.timePerQuestion;
    el.timerProgress.style.strokeDashoffset = String(TIMER_CIRCUMFERENCE * (1 - fraction));
  }
  
  if (el.timerRing) el.timerRing.classList.toggle("urgent", safeRemaining <= 5);
}

function scoreQuestion(q, selectedIds, secondsRemaining) {
  const correctSet = new Set(q.correctIds);
  const selectedSet = new Set(selectedIds);
  const { scoring } = CONFIG;
  
  let points = 0;
  let isFullyCorrect = false;

  if (q.type === "single") {
    const pickedId = [...selectedSet][0];
    isFullyCorrect = correctSet.has(pickedId);
    points = isFullyCorrect ? scoring.singleCorrect : scoring.singleIncorrect;
  } else {
    const correctPicked = [...selectedSet].filter(id => correctSet.has(id));
    const wrongPicked = [...selectedSet].filter(id => !correctSet.has(id));
    
    isFullyCorrect = correctPicked.length === correctSet.size && wrongPicked.length === 0;

    if (isFullyCorrect) {
      points = scoring.multiAllCorrect;
    } else {
      points = wrongPicked.length > 0 ? scoring.multiAnyWrongPenalty : correctPicked.length * scoring.multiPartialPerOption;
    }
  }

  let bonus = 0;
  if (isFullyCorrect && secondsRemaining > 0) {
    bonus = getSpeedBonus(secondsRemaining);
    points += bonus;
  }

  return { points, bonus, isFullyCorrect };
}

function submitAnswer({ timedOut = false } = {}) {
  if (state.answered) return;
  state.answered = true;
  clearInterval(state.timer.intervalId);

  const q = state.questions[state.currentIndex];
  const selectedIds = [...state.selected];
  
  const { points, bonus, isFullyCorrect } = timedOut
    ? { points: q.type === "single" ? CONFIG.scoring.singleIncorrect : 0, bonus: 0, isFullyCorrect: false }
    : scoreQuestion(q, selectedIds, state.timer.remaining);

  state.score += points;
  state.speedBonusTotal += bonus;
  isFullyCorrect ? state.correctCount++ : state.incorrectCount++;

  if (el.qScore) el.qScore.textContent = state.score;

  const correctSet = new Set(q.correctIds);
  el.optionsContainer?.querySelectorAll(".option").forEach((btn) => {
    btn.disabled = true;
    const id = btn.dataset.id;
    const wasSelected = selectedIds.includes(id);
    const isCorrectOption = correctSet.has(id);

    if (isCorrectOption && wasSelected) btn.classList.add("correct");
    else if (isCorrectOption && !wasSelected) btn.classList.add("missed");
    else if (!isCorrectOption && wasSelected) btn.classList.add("incorrect");
  });

  if (el.btnSubmit) el.btnSubmit.classList.add("hidden");
  if (el.btnNext) {
    el.btnNext.classList.remove("hidden");
    el.btnNext.textContent = state.currentIndex === state.questions.length - 1 ? "See results" : "Next question";
  }

  state.log.push({
    question: q.question,
    type: q.type,
    options: q.options,
    correctIds: q.correctIds,
    selectedIds,
    points,
    bonus,
    isFullyCorrect,
    timedOut,
  });
}

function goToNext() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex++;
    renderQuestion();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  clearInterval(state.timer.intervalId);
  if (el.progressFill) el.progressFill.style.width = "100%";

  const total = state.questions.length;
  const pct = total > 0 ? Math.round((state.correctCount / total) * 100) : 0;

  if (el.finalScore) el.finalScore.textContent = state.score;
  if (el.finalPct) el.finalPct.textContent = `${pct}% correct`;
  if (el.statTotal) el.statTotal.textContent = total;
  if (el.statCorrect) el.statCorrect.textContent = state.correctCount;
  if (el.statIncorrect) el.statIncorrect.textContent = state.incorrectCount;
  if (el.statBonus) el.statBonus.textContent = `+${state.speedBonusTotal}`;

  if (el.stampMark) {
    el.stampMark.className = ""; 
    if (pct >= 80) {
      el.stampMark.textContent = "EXCELLENT";
      el.stampMark.classList.add("tone-good");
    } else if (pct >= 50) {
      el.stampMark.textContent = "GOOD WORK";
      el.stampMark.classList.add("tone-mid");
    } else {
      el.stampMark.textContent = "KEEP PRACTICING";
    }
  }

  renderReview();
  if (el.reviewList) el.reviewList.classList.remove("open");
  if (el.btnReviewToggle) el.btnReviewToggle.textContent = "Show review";
  showScreen("results");
}

function renderReview() {
  if (!el.reviewList) return;
  el.reviewList.innerHTML = "";

  state.log.forEach((entry, idx) => {
    const optById = Object.fromEntries(entry.options.map(o => [o.id, o.text]));
    const correctText = entry.correctIds.map(id => optById[id]).join(", ");
    const selectedText = entry.selectedIds.length
      ? entry.selectedIds.map(id => optById[id]).join(", ")
      : "No answer (time expired)";

    const item = document.createElement("div");
    item.className = "review-item";
    item.innerHTML = `
      <p class="review-item-q">${idx + 1}. ${entry.question}</p>
      <p class="review-item-line ${entry.isFullyCorrect ? "ok" : "bad"}">Your answer: ${selectedText}</p>
      <p class="review-item-line ok">Correct answer: ${correctText}</p>
      <span class="review-item-pts">${entry.points >= 0 ? "+" : ""}${entry.points} pts${entry.bonus ? ` (incl. +${entry.bonus} speed)` : ""}</span>
    `;
    el.reviewList.appendChild(item);
  });
}

function toggleReview() {
  if (!el.reviewList || !el.btnReviewToggle) return;
  const isOpen = el.reviewList.classList.toggle("open");
  el.btnReviewToggle.textContent = isOpen ? "Hide review" : "Show review";
}

el.btnStart?.addEventListener("click", startQuiz);
el.btnRetry?.addEventListener("click", startQuiz);
el.btnSubmit?.addEventListener("click", () => submitAnswer());
el.btnNext?.addEventListener("click", goToNext);
el.btnReviewToggle?.addEventListener("click", toggleReview);
el.btnRestart?.addEventListener("click", () => showScreen("setup"));

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (el.btnSubmit && !el.btnSubmit.classList.contains("hidden") && !el.btnSubmit.disabled) {
      submitAnswer();
    } else if (el.btnNext && !el.btnNext.classList.contains("hidden")) {
      goToNext();
    }
  }
});

loadCategories();