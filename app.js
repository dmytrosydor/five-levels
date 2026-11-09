// Робота зі сторінкою: форма, запит, показ результату, перемикання рівнів.

import {
  DEFAULT_MODEL,
  LEVELS,
  MAX_TOPIC_LEN,
  cleanTopic,
  explainTopic,
  parseLevels,
  textStats,
} from "./levels.js";

const form = document.querySelector("#form");
const topicInput = document.querySelector("#topic");
const keyInput = document.querySelector("#key");
const modelSelect = document.querySelector("#model");
const customModelInput = document.querySelector("#custom-model");
const goButton = document.querySelector("#go");
const exampleButton = document.querySelector("#example");
const errorBox = document.querySelector("#error");
const result = document.querySelector("#result");

const CUSTOM = "custom";
let level = 1; // обраний рівень зберігається між результатами

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // лише textContent: текст моделі не стає HTML
  return node;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function applyLevel() {
  const root = result.querySelector(".fl[data-level]");
  if (!root) return;
  root.dataset.level = level;
  for (const node of root.querySelectorAll(".fl-panel, .fl-tick")) {
    const on = Number(node.dataset.l) === level;
    node.classList.toggle("on", on);
    if (node.classList.contains("fl-panel")) node.setAttribute("aria-hidden", String(!on));
    else node.setAttribute("aria-pressed", String(on));
  }
  const range = root.querySelector(".fl-range");
  range.value = level;
  const current = LEVELS[level - 1];
  range.setAttribute("aria-valuetext", `${current.name}, ${current.audience}`);
}

/** Будує блок результату: повзунок і п'ять пояснень, з яких видно одне. */
function renderResult(topic, levels, note) {
  const root = el("section", "fl");
  root.dataset.level = level;
  root.append(el("p", "fl-eyebrow", "Тема"), el("h2", "fl-topic", topic));

  const control = el("div", "fl-control");
  const range = el("input", "fl-range");
  Object.assign(range, { type: "range", min: 1, max: LEVELS.length, step: 1, value: level });
  range.setAttribute("aria-label", "Рівень пояснення");
  const ticks = el("div", "fl-ticks");
  const card = el("div", "fl-card");

  LEVELS.forEach(({ key, name, audience }, index) => {
    const number = index + 1;

    const tick = el("button", "fl-tick");
    tick.type = "button";
    tick.dataset.l = number;
    tick.append(el("span", "fl-tick-name", name), el("span", "fl-tick-aud", audience));
    ticks.append(tick);

    const panel = el("article", "fl-panel");
    panel.dataset.l = number;
    const numeral = el("span", "fl-numeral", String(number));
    numeral.setAttribute("aria-hidden", "true");
    panel.append(
      numeral,
      el("p", "fl-kicker", `Рівень ${number} з ${LEVELS.length} · ${name}, ${audience}`),
      el("p", "fl-text", levels[key]),
      el("p", "fl-stats", textStats(levels[key])),
    );
    card.append(panel);
  });

  control.append(range, ticks);
  root.append(control, card, el("p", "fl-note", note));
  result.replaceChildren(root);
  applyLevel();
}

function renderLoading(topic) {
  const root = el("section", "fl fl-loading");
  root.append(el("p", "fl-eyebrow", "Тема"), el("h2", "fl-topic", topic));
  const card = el("div", "fl-card");
  card.append(el("p", "fl-wait", "Модель пише п'ять пояснень. Зазвичай це займає до 10 секунд."));
  for (const width of ["92%", "100%", "84%", "64%"]) {
    const line = el("span", "fl-skeleton");
    line.style.width = width;
    card.append(line);
  }
  root.append(card);
  result.replaceChildren(root);
}

function setBusy(busy) {
  goButton.disabled = busy;
  exampleButton.disabled = busy;
  goButton.textContent = busy ? "Пояснюю…" : "Пояснити";
}

async function onSubmit(event) {
  event.preventDefault();
  clearError();

  const topic = cleanTopic(topicInput.value);
  if (!topic) return fail("Введи тему, яку треба пояснити.", topicInput);
  if (topic.length > MAX_TOPIC_LEN) {
    return fail(`Тема задовга. Скороти її до ${MAX_TOPIC_LEN} символів.`, topicInput);
  }
  const apiKey = keyInput.value.trim();
  if (!apiKey) return fail("Введи ключ OpenRouter у полі «Ключ OpenRouter».", keyInput);

  let model = modelSelect.value;
  if (model === CUSTOM) {
    model = customModelInput.value.trim();
    if (!model) return fail("Впиши назву моделі або обери модель зі списку.", customModelInput);
  }

  const previous = [...result.childNodes];
  setBusy(true);
  renderLoading(topic);
  try {
    const { levels, model: usedModel } = await explainTopic(topic, apiKey, model || DEFAULT_MODEL);
    renderResult(topic, levels, `Модель: ${usedModel} · один виклик LLM`);
  } catch (error) {
    result.replaceChildren(...previous); // повертаємо те, що було до запиту
    showError(error.userMessage ?? "Сталася неочікувана помилка. Спробуй ще раз.");
  } finally {
    setBusy(false);
  }
}

function fail(message, field) {
  showError(message);
  field.focus();
}

/** Показує збережену відповідь моделі. Запит до LLM не виконується. */
async function onExample() {
  clearError();
  try {
    const example = await (await fetch("example.json")).json();
    renderResult(
      example.topic,
      parseLevels(JSON.stringify(example.levels)),
      `Збережений приклад · модель: ${example.model} · запит не виконувався`,
    );
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    showError("Не вдалося завантажити приклад.");
  }
}

form.addEventListener("submit", onSubmit);
exampleButton.addEventListener("click", onExample);

modelSelect.addEventListener("change", () => {
  const custom = modelSelect.value === CUSTOM;
  customModelInput.hidden = !custom;
  if (custom) customModelInput.focus();
});

document.querySelector("#chips").addEventListener("click", (event) => {
  const chip = event.target.closest("button");
  if (!chip) return;
  topicInput.value = chip.textContent;
  topicInput.focus();
});

result.addEventListener("input", (event) => {
  if (event.target.classList.contains("fl-range")) {
    level = Number(event.target.value);
    applyLevel();
  }
});

result.addEventListener("click", (event) => {
  const tick = event.target.closest(".fl-tick");
  if (tick) {
    level = Number(tick.dataset.l);
    applyLevel();
  }
});
