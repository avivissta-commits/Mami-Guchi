"use strict";

const ASSETS = {
  idle: {
    breathing: "animations/idle/idle_breathing.mp4",
    variation: "animations/idle/idle_variation.mp4",
  },
  needs: {
    hunger: ["animations/needs/need_hungry_stomach.mp4"],
    sleep: ["animations/needs/need_sleepy_yawn.mp4"],
    love: [
      "animations/needs/need_love_cry.mp4",
      "animations/needs/need_love_lonely.mp4",
    ],
    fun: ["animations/needs/need_bored_yawn.mp4"],
  },
  distress: [
    "animations/distress/distress_cry.mp4",
    "animations/distress/distress_lonely.mp4",
  ],
  actions: {
    food: "animations/actions/action_eating.mp4",
    sleep: "animations/actions/action_sleeping.mp4",
    game: "animations/actions/action_gaming.mp4",
    love: "animations/actions/action_hug.mp4",
  },
};

const ACTIONS = [
  {
    id: "food",
    primary: "hunger",
    effects: { hunger: 40, sleep: -14 },
    wastePenalty: { sleep: -6, fun: -4 },
    repeatPenalty: { fun: -5, love: -2 },
  },
  {
    id: "sleep",
    primary: "sleep",
    effects: { sleep: 42, fun: -9 },
    wastePenalty: { fun: -12, love: -2 },
    repeatPenalty: { fun: -7, hunger: -2 },
  },
  {
    id: "game",
    primary: "fun",
    effects: { fun: 38, hunger: -8, sleep: -3 },
    wastePenalty: { hunger: -6, sleep: -4 },
    repeatPenalty: { hunger: -4, sleep: -3 },
  },
  {
    id: "love",
    primary: "love",
    effects: { love: 40 },
    wastePenalty: { fun: -3, sleep: -2 },
    repeatPenalty: { fun: -3 },
  },
];

const STAT_KEYS = ["hunger", "sleep", "love", "fun"];
const STORAGE_KEY = "quiet-pixel-pet-v2";
const LOW_NEED = 35;
const CRITICAL_NEED = 20;
const DECAY_INTERVAL_MS = 3000;
const ACTION_MS = 5000;
const NEED_IDLE_MS = 5200;
const NEED_SHOW_MS = 4700;
const DISTRESS_IDLE_MS = 4300;
const DISTRESS_SHOW_MS = 4700;
const VARIATION_SHOW_MS = 4200;
const SAME_ACTION_WINDOW_MS = 35000;
const INITIAL_STATS = { hunger: 92, sleep: 90, love: 88, fun: 91 };
const DECAY_PER_TICK = { hunger: 0.62, sleep: 0.46, love: 0.38, fun: 0.54 };

const els = {
  video: document.querySelector("#petVideo"),
  icons: [...document.querySelectorAll(".icon-slot")],
  controls: [...document.querySelectorAll(".control-zone")],
};

let state = createInitialState();

function clampStat(value) {
  return Math.max(0, Math.min(100, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function nextVariationAt(now) {
  return now + randomBetween(30000, 60000);
}

function loadPersistedStats() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...INITIAL_STATS };
    }

    const saved = JSON.parse(raw);
    if (!saved || !saved.stats || typeof saved.savedAt !== "number") {
      return { ...INITIAL_STATS };
    }

    const elapsed = Math.max(0, Math.min(Date.now() - saved.savedAt, 6 * 60 * 60 * 1000));
    const ticks = Math.floor(elapsed / DECAY_INTERVAL_MS);
    return decayStats(saved.stats, ticks);
  } catch {
    return { ...INITIAL_STATS };
  }
}

function persistStats(stats) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ stats, savedAt: Date.now() })
    );
  } catch {
    // Private browsing or storage limits should not affect the living state.
  }
}

function createInitialState() {
  const now = performance.now();
  return {
    stats: loadPersistedStats(),
    selectedIndex: 0,
    visual: { src: ASSETS.idle.breathing, kind: "idle" },
    phase: { kind: "calm", startedAt: now, cycleIndex: 0, loveVariant: 0 },
    nextDecayAt: now + DECAY_INTERVAL_MS,
    nextVariationAt: nextVariationAt(now),
    action: null,
    lastActionId: "",
    lastActionAt: -Infinity,
  };
}

function reducer(current, event) {
  if (event.type === "cycle") {
    return {
      ...current,
      selectedIndex: (current.selectedIndex + 1) % ACTIONS.length,
    };
  }

  if (event.type === "select") {
    return {
      ...current,
      selectedIndex: event.index,
    };
  }

  if (event.type === "confirm") {
    return startAction(current, event.now);
  }

  if (event.type === "tick") {
    let next = current;

    while (event.now >= next.nextDecayAt) {
      next = {
        ...next,
        stats: decayStats(next.stats, 1),
        nextDecayAt: next.nextDecayAt + DECAY_INTERVAL_MS,
      };
    }

    return resolveVisual(next, event.now);
  }

  return current;
}

function decayStats(stats, ticks) {
  const next = { ...stats };

  for (const key of STAT_KEYS) {
    const start = typeof next[key] === "number" ? next[key] : INITIAL_STATS[key];
    next[key] = clampStat(start - DECAY_PER_TICK[key] * ticks);
  }

  return next;
}

function applyEffects(stats, effects) {
  const next = { ...stats };

  for (const [key, amount] of Object.entries(effects)) {
    next[key] = clampStat((next[key] ?? INITIAL_STATS[key]) + amount);
  }

  return next;
}

function startAction(current, now) {
  if (current.action && current.action.until > now) {
    return current;
  }

  const action = ACTIONS[current.selectedIndex];
  const repeated =
    current.lastActionId === action.id && now - current.lastActionAt < SAME_ACTION_WINDOW_MS;
  const unnecessary = current.stats[action.primary] > 76;
  let stats = applyEffects(current.stats, action.effects);

  if (unnecessary) {
    stats = applyEffects(stats, action.wastePenalty);
  }

  if (repeated) {
    stats = applyEffects(stats, action.repeatPenalty);
  }

  return {
    ...current,
    stats,
    action: {
      id: action.id,
      src: ASSETS.actions[action.id],
      until: now + ACTION_MS,
    },
    phase: { kind: "action", startedAt: now, cycleIndex: 0, loveVariant: 0 },
    visual: { src: ASSETS.actions[action.id], kind: `action-${action.id}` },
    lastActionId: action.id,
    lastActionAt: now,
  };
}

function resolveVisual(current, now) {
  if (current.action && now < current.action.until) {
    return {
      ...current,
      visual: { src: current.action.src, kind: `action-${current.action.id}` },
    };
  }

  let next = current.action ? { ...current, action: null } : current;
  const critical = STAT_KEYS.filter((key) => next.stats[key] < CRITICAL_NEED);
  const low = STAT_KEYS.filter((key) => next.stats[key] < LOW_NEED);

  if (critical.length >= 2) {
    return resolveDistress(next, now);
  }

  if (low.length > 0) {
    return resolveNeed(next, now, low);
  }

  return resolveCalm(next, now);
}

function resolveDistress(current, now) {
  const phase =
    current.phase.kind === "distress"
      ? current.phase
      : { kind: "distress", startedAt: now, cycleIndex: 0, loveVariant: 0 };
  const period = DISTRESS_IDLE_MS + DISTRESS_SHOW_MS;
  const elapsed = now - phase.startedAt;
  const cycleIndex = Math.floor(elapsed / period);
  const position = elapsed % period;
  const inDistress = position >= DISTRESS_IDLE_MS;
  const variant = cycleIndex % ASSETS.distress.length;

  return {
    ...current,
    phase: { ...phase, cycleIndex },
    visual: inDistress
      ? { src: ASSETS.distress[variant], kind: "distress" }
      : { src: ASSETS.idle.breathing, kind: "idle-between-distress" },
  };
}

function resolveNeed(current, now, low) {
  const needKey = low.reduce((lowest, key) =>
    current.stats[key] < current.stats[lowest] ? key : lowest
  );
  const phase =
    current.phase.kind === "need" && current.phase.needKey === needKey
      ? current.phase
      : {
          kind: "need",
          needKey,
          startedAt: now,
          cycleIndex: 0,
          loveVariant: Math.floor(Math.random() * ASSETS.needs.love.length),
        };
  const period = NEED_IDLE_MS + NEED_SHOW_MS;
  const elapsed = now - phase.startedAt;
  const cycleIndex = Math.floor(elapsed / period);
  const position = elapsed % period;
  const inNeed = position >= NEED_IDLE_MS;
  let loveVariant = phase.loveVariant;

  if (needKey === "love" && cycleIndex !== phase.cycleIndex) {
    loveVariant = Math.floor(Math.random() * ASSETS.needs.love.length);
  }

  return {
    ...current,
    phase: { ...phase, cycleIndex, loveVariant },
    visual: inNeed
      ? { src: needAssetFor(needKey, loveVariant), kind: `need-${needKey}` }
      : { src: ASSETS.idle.breathing, kind: `idle-between-${needKey}` },
  };
}

function resolveCalm(current, now) {
  if (current.phase.kind === "variation") {
    const elapsed = now - current.phase.startedAt;

    if (elapsed < VARIATION_SHOW_MS) {
      return {
        ...current,
        visual: { src: ASSETS.idle.variation, kind: "idle-variation" },
      };
    }

    return {
      ...current,
      phase: { kind: "calm", startedAt: now, cycleIndex: 0, loveVariant: 0 },
      nextVariationAt: nextVariationAt(now),
      visual: { src: ASSETS.idle.breathing, kind: "idle" },
    };
  }

  if (now >= current.nextVariationAt) {
    return {
      ...current,
      phase: { kind: "variation", startedAt: now, cycleIndex: 0, loveVariant: 0 },
      visual: { src: ASSETS.idle.variation, kind: "idle-variation" },
    };
  }

  if (current.phase.kind !== "calm") {
    return {
      ...current,
      phase: { kind: "calm", startedAt: now, cycleIndex: 0, loveVariant: 0 },
      visual: { src: ASSETS.idle.breathing, kind: "idle" },
    };
  }

  return {
    ...current,
    visual: { src: ASSETS.idle.breathing, kind: "idle" },
  };
}

function needAssetFor(key, loveVariant) {
  if (key === "love") {
    return ASSETS.needs.love[loveVariant % ASSETS.needs.love.length];
  }

  return ASSETS.needs[key][0];
}

function dispatch(event) {
  state = reducer(state, event);
  render();
  persistStats(state.stats);
}

function render() {
  for (let index = 0; index < els.icons.length; index += 1) {
    els.icons[index].classList.toggle("is-selected", index === state.selectedIndex);
  }

  if (els.video.dataset.src !== state.visual.src) {
    els.video.dataset.src = state.visual.src;
    els.video.loop = true;
    els.video.src = state.visual.src;
    els.video.load();
    const playRequest = els.video.play();

    if (playRequest && typeof playRequest.catch === "function") {
      playRequest.catch(() => undefined);
    }
  }

  document.documentElement.dataset.visual = state.visual.kind;
  document.documentElement.dataset.selected = ACTIONS[state.selectedIndex].id;
}

function confirmSelected() {
  dispatch({ type: "confirm", now: performance.now() });
}

function cycleSelection() {
  dispatch({ type: "cycle", now: performance.now() });
}

els.icons.forEach((button, index) => {
  button.addEventListener("click", (event) => {
    event.currentTarget.blur();

    if (index === state.selectedIndex) {
      confirmSelected();
      return;
    }

    dispatch({ type: "select", index, now: performance.now() });
  });
});

els.controls.forEach((button) => {
  button.addEventListener("click", (event) => {
    event.currentTarget.blur();

    if (button.dataset.control === "cycle") {
      cycleSelection();
    } else {
      confirmSelected();
    }
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === " " || event.key === "Tab") {
    event.preventDefault();
    cycleSelection();
  }

  if (event.key === "Enter") {
    event.preventDefault();
    confirmSelected();
  }
});

document.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    state = {
      ...state,
      stats: loadPersistedStats(),
      nextDecayAt: performance.now() + DECAY_INTERVAL_MS,
    };
    dispatch({ type: "tick", now: performance.now() });
  }
});

Object.defineProperty(window, "__quietPixelPet", {
  get() {
    return {
      stats: { ...state.stats },
      selected: ACTIONS[state.selectedIndex].id,
      visual: { ...state.visual },
      phase: { ...state.phase },
    };
  },
});

render();
setInterval(() => dispatch({ type: "tick", now: performance.now() }), 250);
