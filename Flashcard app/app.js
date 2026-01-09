import { STATES } from "./states.js";

const STORAGE_KEY = "state-capitals.flashcards.v1";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sampleDistinct(arr, count, disallowValue) {
  const pool = arr.filter((x) => x !== disallowValue);
  shuffleInPlace(pool);
  return pool.slice(0, count);
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function buildDefaultProgress() {
  const cards = {};
  for (const item of STATES) {
    cards[item.state] = {
      seen: 0,
      correct: 0,
      wrong: 0,
      score: 0, // -3..+6
      lastSeenAt: 0,
    };
  }
  return {
    version: 1,
    cards,
    totals: {
      seen: 0,
      correct: 0,
      streak: 0,
    },
  };
}

function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = safeJsonParse(raw ?? "", null);
  const base = buildDefaultProgress();

  if (!parsed || typeof parsed !== "object") return base;

  // Merge in case the dataset changes.
  const merged = base;
  if (parsed.cards && typeof parsed.cards === "object") {
    for (const [k, v] of Object.entries(parsed.cards)) {
      if (!merged.cards[k] || typeof v !== "object") continue;
      merged.cards[k] = {
        ...merged.cards[k],
        seen: Number(v.seen ?? merged.cards[k].seen) || 0,
        correct: Number(v.correct ?? merged.cards[k].correct) || 0,
        wrong: Number(v.wrong ?? merged.cards[k].wrong) || 0,
        score: Number(v.score ?? merged.cards[k].score) || 0,
        lastSeenAt: Number(v.lastSeenAt ?? merged.cards[k].lastSeenAt) || 0,
      };
    }
  }
  if (parsed.totals && typeof parsed.totals === "object") {
    merged.totals.seen = Number(parsed.totals.seen ?? 0) || 0;
    merged.totals.correct = Number(parsed.totals.correct ?? 0) || 0;
    merged.totals.streak = Number(parsed.totals.streak ?? 0) || 0;
  }
  return merged;
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function masteryLabel(score, seen) {
  if (seen === 0) return "New";
  if (score >= 4) return "Mastered";
  if (score <= -1) return "Weak";
  return "Learning";
}

function isMastered(cardStats) {
  return cardStats.seen > 0 && cardStats.score >= 4;
}

function isWeak(cardStats) {
  return cardStats.seen > 0 && cardStats.score <= -1;
}

function isNew(cardStats) {
  return cardStats.seen === 0;
}

function getDeckByFilter(filter, progress) {
  const out = [];
  for (const item of STATES) {
    const s = progress.cards[item.state];
    if (!s) continue;
    if (filter === "weak" && !isWeak(s)) continue;
    if (filter === "new" && !isNew(s)) continue;
    if (filter === "mastered" && !isMastered(s)) continue;
    out.push(item);
  }
  return out;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.0;
  u.volume = 1.0;
  window.speechSynthesis.speak(u);
}

// --- DOM ---
const directionEl = document.getElementById("direction");
const filterEl = document.getElementById("filter");
const shuffleEl = document.getElementById("shuffle");
const readAloudEl = document.getElementById("readAloud");
const resetProgressEl = document.getElementById("resetProgress");

const tabs = Array.from(document.querySelectorAll(".tab"));
const studyView = document.getElementById("studyView");
const quizView = document.getElementById("quizView");

const flashcardBtn = document.getElementById("flashcard");
const promptLabelEl = document.getElementById("promptLabel");
const promptTextEl = document.getElementById("promptText");
const hintTextEl = document.getElementById("hintText");
const answerLabelEl = document.getElementById("answerLabel");
const answerTextEl = document.getElementById("answerText");
const counterPillEl = document.getElementById("counterPill");
const masteryPillEl = document.getElementById("masteryPill");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const flipBtn = document.getElementById("flipBtn");
const missedBtn = document.getElementById("missedBtn");
const knewBtn = document.getElementById("knewBtn");

const statSeenEl = document.getElementById("statSeen");
const statCorrectEl = document.getElementById("statCorrect");
const statStreakEl = document.getElementById("statStreak");
const statMasteredEl = document.getElementById("statMastered");

const quizCounterPillEl = document.getElementById("quizCounterPill");
const quizScorePillEl = document.getElementById("quizScorePill");
const quizQuestionLabelEl = document.getElementById("quizQuestionLabel");
const quizQuestionEl = document.getElementById("quizQuestion");
const quizChoicesEl = document.getElementById("quizChoices");
const quizFeedbackEl = document.getElementById("quizFeedback");
const quizNextBtn = document.getElementById("quizNextBtn");

// --- App State ---
let progress = loadProgress();

let view = "study"; // "study" | "quiz"
let direction = directionEl.value; // state-to-capital | capital-to-state
let filter = filterEl.value; // all|weak|new|mastered
let shuffled = shuffleEl.checked;

let deck = [];
let order = []; // indices into deck
let idx = 0;
let isFlipped = false;

let quiz = {
  size: 10,
  qIndex: 0,
  score: 0,
  current: null, // { item, correctValue, choices: [string], answered: boolean, correct: boolean }
};

function currentItem() {
  if (deck.length === 0) return null;
  const deckIndex = order[idx] ?? 0;
  return deck[deckIndex] ?? deck[0];
}

function makeOrder() {
  order = Array.from({ length: deck.length }, (_, i) => i);
  if (shuffled) shuffleInPlace(order);
  idx = clamp(idx, 0, Math.max(0, order.length - 1));
}

function refreshDeck(keepPositionState = false) {
  const prev = currentItem();
  deck = getDeckByFilter(filter, progress);
  if (deck.length === 0) {
    // Fall back to all so the app always has something.
    deck = STATES.slice();
  }
  if (!keepPositionState) idx = 0;
  makeOrder();

  if (keepPositionState && prev) {
    const pos = deck.findIndex((d) => d.state === prev.state);
    if (pos >= 0) {
      const orderPos = order.findIndex((x) => x === pos);
      idx = orderPos >= 0 ? orderPos : 0;
    }
  }
}

function updateStatsUI() {
  const mastered = STATES.reduce((acc, it) => {
    const s = progress.cards[it.state];
    return acc + (s && isMastered(s) ? 1 : 0);
  }, 0);

  statSeenEl.textContent = String(progress.totals.seen);
  statCorrectEl.textContent = String(progress.totals.correct);
  statStreakEl.textContent = String(progress.totals.streak);
  statMasteredEl.textContent = String(mastered);
}

function setFlipped(next) {
  isFlipped = next;
  flashcardBtn.classList.toggle("is-flipped", isFlipped);
  hintTextEl.textContent = isFlipped ? "Tap to flip back" : "Tap to reveal";

  if (readAloudEl.checked) {
    const item = currentItem();
    if (!item) return;
    const front = direction === "state-to-capital" ? item.state : item.capital;
    const back = direction === "state-to-capital" ? item.capital : item.state;
    speak(isFlipped ? back : front);
  }
}

function renderStudyCard() {
  const item = currentItem();
  if (!item) return;

  const frontLabel = direction === "state-to-capital" ? "State" : "Capital";
  const backLabel = direction === "state-to-capital" ? "Capital" : "State";
  const frontText = direction === "state-to-capital" ? item.state : item.capital;
  const backText = direction === "state-to-capital" ? item.capital : item.state;

  promptLabelEl.textContent = frontLabel;
  answerLabelEl.textContent = backLabel;
  promptTextEl.textContent = frontText;
  answerTextEl.textContent = backText;

  const s = progress.cards[item.state];
  const label = masteryLabel(s?.score ?? 0, s?.seen ?? 0);
  masteryPillEl.textContent = `Mastery: ${label}`;

  const total = Math.max(1, deck.length);
  counterPillEl.textContent = `Card ${idx + 1} / ${total}`;
}

function go(delta) {
  if (deck.length === 0) return;
  idx = (idx + delta + deck.length) % deck.length;
  setFlipped(false);
  renderStudyCard();
}

function bumpStats(item, didKnow) {
  const s = progress.cards[item.state];
  if (!s) return;

  s.seen += 1;
  s.lastSeenAt = Date.now();
  progress.totals.seen += 1;

  if (didKnow) {
    s.correct += 1;
    s.score = clamp(s.score + 1, -3, 6);
    progress.totals.correct += 1;
    progress.totals.streak += 1;
  } else {
    s.wrong += 1;
    s.score = clamp(s.score - 1, -3, 6);
    progress.totals.streak = 0;
  }

  saveProgress(progress);
  updateStatsUI();
  renderStudyCard();
}

// --- Quiz ---
function buildQuizQuestion() {
  const qDeck = getDeckByFilter(filter, progress);
  const pool = (qDeck.length ? qDeck : STATES).slice();
  const item = pool[Math.floor(Math.random() * pool.length)];

  const askStateToCapital = direction === "state-to-capital";
  const prompt = askStateToCapital
    ? `What is the capital of ${item.state}?`
    : `Which state has the capital ${item.capital}?`;

  const correctValue = askStateToCapital ? item.capital : item.state;
  const wrongValues = askStateToCapital
    ? sampleDistinct(
        pool.map((x) => x.capital),
        3,
        correctValue,
      )
    : sampleDistinct(
        pool.map((x) => x.state),
        3,
        correctValue,
      );

  const choices = shuffleInPlace([correctValue, ...wrongValues]);
  return { item, prompt, correctValue, choices, answered: false, correct: null };
}

function renderQuiz() {
  quizQuestionLabelEl.textContent =
    direction === "state-to-capital" ? "Choose the capital" : "Choose the state";
  quizCounterPillEl.textContent = `Question ${quiz.qIndex + 1} / ${quiz.size}`;
  quizScorePillEl.textContent = `Score: ${quiz.score}`;
  quizFeedbackEl.textContent = "";
  quizNextBtn.disabled = true;

  quiz.current = buildQuizQuestion();
  quizQuestionEl.textContent = quiz.current.prompt;

  if (readAloudEl.checked) speak(quiz.current.prompt);

  quizChoicesEl.innerHTML = "";
  quiz.current.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice";
    btn.dataset.choice = choice;
    btn.dataset.index = String(i);

    const key = document.createElement("div");
    key.className = "choiceKey";
    key.textContent = String(i + 1);

    const label = document.createElement("div");
    label.textContent = choice;

    btn.appendChild(key);
    btn.appendChild(label);
    btn.addEventListener("click", () => answerQuiz(choice, btn));
    quizChoicesEl.appendChild(btn);
  });
}

function answerQuiz(choiceValue, clickedBtn) {
  if (!quiz.current || quiz.current.answered) return;
  quiz.current.answered = true;

  const isCorrect = choiceValue === quiz.current.correctValue;
  quiz.current.correct = isCorrect;

  // Mark buttons.
  const buttons = Array.from(quizChoicesEl.querySelectorAll(".choice"));
  for (const b of buttons) {
    b.disabled = true;
    const val = b.dataset.choice;
    if (val === quiz.current.correctValue) b.classList.add("is-correct");
  }
  if (!isCorrect) clickedBtn.classList.add("is-wrong");

  quizFeedbackEl.textContent = isCorrect
    ? "Nice! That’s correct."
    : `Close! The correct answer is ${quiz.current.correctValue}.`;

  // Update progress using the same state key.
  bumpStats(quiz.current.item, isCorrect);
  if (isCorrect) quiz.score += 1;

  quizScorePillEl.textContent = `Score: ${quiz.score}`;
  quizNextBtn.disabled = false;

  if (readAloudEl.checked) {
    speak(isCorrect ? "Correct!" : `The correct answer is ${quiz.current.correctValue}.`);
  }
}

function nextQuizQuestion() {
  if (quiz.qIndex + 1 >= quiz.size) {
    quizFeedbackEl.textContent = `Quiz finished! Your score: ${quiz.score} / ${quiz.size}.`;
    quizNextBtn.disabled = false;
    quizNextBtn.textContent = "Start a new quiz";
    quiz.current = null;
    quiz.qIndex = quiz.size; // mark finished
    return;
  }
  quiz.qIndex += 1;
  renderQuiz();
}

function startQuiz() {
  quiz.size = 10;
  quiz.qIndex = 0;
  quiz.score = 0;
  quizNextBtn.textContent = "Next question";
  renderQuiz();
}

// --- Tabs ---
function setView(nextView) {
  view = nextView;
  const isStudy = view === "study";

  studyView.classList.toggle("is-active", isStudy);
  quizView.classList.toggle("is-active", !isStudy);

  for (const t of tabs) {
    t.classList.toggle("is-active", t.dataset.tab === view);
  }

  if (isStudy) {
    renderStudyCard();
  } else {
    startQuiz();
  }
}

// --- Events ---
directionEl.addEventListener("change", () => {
  direction = directionEl.value;
  setFlipped(false);
  renderStudyCard();
  if (view === "quiz") startQuiz();
});

filterEl.addEventListener("change", () => {
  filter = filterEl.value;
  refreshDeck(true);
  setFlipped(false);
  renderStudyCard();
  if (view === "quiz") startQuiz();
});

shuffleEl.addEventListener("change", () => {
  shuffled = shuffleEl.checked;
  refreshDeck(true);
  setFlipped(false);
  renderStudyCard();
});

resetProgressEl.addEventListener("click", () => {
  const ok = window.confirm(
    "Reset all progress on this device? (This cannot be undone.)",
  );
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  progress = loadProgress();
  refreshDeck(false);
  updateStatsUI();
  setFlipped(false);
  renderStudyCard();
  if (view === "quiz") startQuiz();
});

for (const t of tabs) {
  t.addEventListener("click", () => setView(t.dataset.tab));
}

flashcardBtn.addEventListener("click", () => setFlipped(!isFlipped));
flipBtn.addEventListener("click", () => setFlipped(!isFlipped));

prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));

missedBtn.addEventListener("click", () => {
  const item = currentItem();
  if (!item) return;
  bumpStats(item, false);
  go(1);
});

knewBtn.addEventListener("click", () => {
  const item = currentItem();
  if (!item) return;
  bumpStats(item, true);
  go(1);
});

quizNextBtn.addEventListener("click", () => {
  // If finished, restart.
  if (quiz.qIndex >= quiz.size) {
    startQuiz();
    return;
  }
  // Only allow next after answering.
  if (quiz.current && !quiz.current.answered) return;
  nextQuizQuestion();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;

  if (view === "study") {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setFlipped(!isFlipped);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
      return;
    }
    if (e.key.toLowerCase() === "k") {
      e.preventDefault();
      knewBtn.click();
      return;
    }
    if (e.key.toLowerCase() === "m") {
      e.preventDefault();
      missedBtn.click();
      return;
    }
  } else {
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      e.preventDefault();
      const btn = quizChoicesEl.querySelector(
        `.choice[data-index="${n - 1}"]`,
      );
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (e.key === "Enter") {
      if (!quizNextBtn.disabled) quizNextBtn.click();
    }
  }
});

// --- Init ---
refreshDeck(false);
updateStatsUI();
setFlipped(false);
renderStudyCard();

