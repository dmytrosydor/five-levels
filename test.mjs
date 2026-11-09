// Перевірки логіки сервісу. Запуск: node --test test.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FREE,
  FREE_MODELS,
  LEVELS,
  buildRequest,
  cleanTopic,
  errorText,
  explainTopic,
  parseLevels,
  plural,
  textStats,
} from "./levels.js";

const SAMPLE = Object.fromEntries(LEVELS.map(({ key }) => [key, `Пояснення для рівня ${key}.`]));

/** Підроблений fetch: повертає задану відповідь і запам'ятовує запит. */
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl, calls };
}

test("parseLevels читає звичайний JSON", () => {
  assert.deepEqual(parseLevels(JSON.stringify(SAMPLE)), SAMPLE);
});

test("parseLevels відкидає вступ, післямову і markdown-обгортку", () => {
  const raw = `Звичайно, ось пояснення:\n\`\`\`json\n${JSON.stringify(SAMPLE)}\n\`\`\`\nСподіваюся, допомогло!`;
  assert.deepEqual(parseLevels(raw), SAMPLE);
});

test("parseLevels не приймає відповідь без одного з рівнів", () => {
  const { expert, ...rest } = SAMPLE;
  assert.throws(() => parseLevels(JSON.stringify(rest)), /expert/);
});

test("parseLevels не приймає текст без JSON, зламаний JSON і не-об'єкт", () => {
  assert.throws(() => parseLevels("Вибач, я не можу відповісти."));
  assert.throws(() => parseLevels('{"child": "текст"'));
  assert.throws(() => parseLevels("{ не json }"));
});

test("parseLevels не приймає порожні й нетекстові значення", () => {
  for (const bad of ["   ", 5, null, ["текст"]]) {
    assert.throws(() => parseLevels(JSON.stringify({ ...SAMPLE, child: bad })));
  }
});

test("plural обирає форму слова", () => {
  const forms = [1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, "слово", "слова", "слів"));
  assert.deepEqual(forms, ["слово", "слова", "слів", "слів", "слів", "слово", "слова", "слів", "слів"]);
});

test("textStats рахує слова й речення", () => {
  assert.equal(
    textStats("Це перше речення. А це друге, довше речення!"),
    "8 слів · у середньому 4 слова у реченні",
  );
  assert.equal(textStats("Розв'язок Керра-Ньюмена."), "2 слова · у середньому 2 слова у реченні");
});

test("cleanTopic прибирає зайві пробіли", () => {
  assert.equal(cleanTopic("  чорна \n  діра  "), "чорна діра");
  assert.equal(cleanTopic(undefined), "");
});

test("buildRequest: одна модель або список безкоштовних", () => {
  const paid = buildRequest("тема", "anthropic/claude-haiku-5.5");
  assert.equal(paid.model, "anthropic/claude-haiku-5.5");
  assert.equal(paid.models, undefined);
  assert.equal(paid.response_format.type, "json_object");
  assert.match(paid.messages[1].content, /<<<тема>>>/);

  const free = buildRequest("тема", FREE);
  assert.deepEqual(free.models, FREE_MODELS);
  assert.equal(free.model, undefined);
});

test("explainTopic робить рівно один запит і повертає п'ять пояснень", async () => {
  const { impl, calls } = fakeFetch(200, {
    model: "test/model",
    choices: [{ message: { content: `Ось відповідь: ${JSON.stringify(SAMPLE)}` } }],
  });
  const out = await explainTopic("тема", "sk-test", "test/model", impl);
  assert.deepEqual(out, { levels: SAMPLE, model: "test/model" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
});

test("explainTopic перетворює помилки на зрозумілі повідомлення", async () => {
  const cases = [
    [fakeFetch(401, { error: { message: "No auth", code: 401 } }), /не прийняв ключ/],
    [fakeFetch(429, { error: { message: "rate", code: 429 } }), /перевантажена/],
    [fakeFetch(200, { error: { message: "Provider returned error", code: 429 } }), /перевантажена/],
    [fakeFetch(200, { choices: [{ message: { content: "" } }] }), /порожню відповідь/],
    [fakeFetch(200, { choices: [{ message: { content: "Не можу." } }] }), /не у форматі JSON/],
    [fakeFetch(500, { error: { message: "boom" } }), /помилку 500\. boom/],
  ];
  for (const [{ impl }, pattern] of cases) {
    await assert.rejects(explainTopic("тема", "k", "m", impl), (error) => {
      assert.match(error.userMessage, pattern);
      return true;
    });
  }
});

test("explainTopic повідомляє про проблеми з мережею", async () => {
  const failing = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(explainTopic("тема", "k", "m", failing), (error) => {
    assert.match(error.userMessage, /з'єднатися/);
    return true;
  });
});

test("errorText для невідомого статусу без деталей", () => {
  assert.equal(errorText(503, {}), "OpenRouter повернув помилку 503.");
});

test("example.json містить усі п'ять рівнів", async () => {
  const example = JSON.parse(await readFile(new URL("./example.json", import.meta.url), "utf8"));
  assert.ok(example.topic && example.model);
  assert.equal(Object.keys(parseLevels(JSON.stringify(example.levels))).length, 5);
});
