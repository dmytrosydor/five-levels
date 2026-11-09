// Перевірки логіки сервісу. Запуск: node --test test.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  ANTHROPIC,
  ANTHROPIC_MODELS,
  ANTHROPIC_URL,
  FREE_AUTO,
  FREE_MODELS,
  LEVELS,
  OPENROUTER,
  OPENROUTER_URL,
  anthropicErrorText,
  buildAnthropicRequest,
  buildOpenRouterRequest,
  cleanTopic,
  errorText,
  explainTopic,
  isFreeModel,
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

test("isFreeModel пропускає лише безкоштовні моделі", () => {
  for (const model of [...FREE_MODELS, "nvidia/nemotron-3.5-super-vl:free"]) {
    assert.equal(isFreeModel(model), true, model);
  }
  for (const model of ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "free", ":free", "", undefined]) {
    assert.equal(isFreeModel(model), false, String(model));
  }
});

test("buildOpenRouterRequest: одна безкоштовна модель або список", () => {
  const one = buildOpenRouterRequest("тема", "google/gemma-4-31b-it:free");
  assert.equal(one.model, "google/gemma-4-31b-it:free");
  assert.equal(one.models, undefined);
  assert.equal(one.response_format.type, "json_object");
  assert.match(one.messages[1].content, /<<<тема>>>/);

  const auto = buildOpenRouterRequest("тема", FREE_AUTO);
  assert.deepEqual(auto.models, FREE_MODELS);
  assert.equal(auto.model, undefined);
  assert.ok(FREE_MODELS.every(isFreeModel));
});

test("ключ OpenRouter не використовується для платних моделей", async () => {
  assert.throws(() => buildOpenRouterRequest("тема", "anthropic/claude-haiku-5.5"), /безкоштовними/);

  const { impl, calls } = fakeFetch(200, {});
  await assert.rejects(explainTopic(OPENROUTER, "тема", "k", "openai/gpt-6-luna", impl), (error) => {
    assert.match(error.userMessage, /безкоштовними/);
    return true;
  });
  assert.equal(calls.length, 0); // запит навіть не надсилається
});

test("buildAnthropicRequest: схема з п'ятьма рівнями, без temperature", () => {
  const body = buildAnthropicRequest("тема", "claude-sonnet-5-5");
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(typeof body.system, "string");
  assert.deepEqual(body.messages, [{ role: "user", content: "Тема: <<<тема>>>" }]);
  assert.equal(body.temperature, undefined);
  const { format } = body.output_config;
  assert.equal(format.type, "json_schema");
  assert.deepEqual(format.schema.required, LEVELS.map(({ key }) => key));
  assert.equal(format.schema.additionalProperties, false);
  assert.equal(buildAnthropicRequest("тема").model, ANTHROPIC_MODELS[0].id);
});

test("explainTopic через OpenRouter: один запит і п'ять пояснень", async () => {
  const { impl, calls } = fakeFetch(200, {
    model: "google/gemma-4-31b-it:free",
    choices: [{ message: { content: `Ось відповідь: ${JSON.stringify(SAMPLE)}` } }],
  });
  const out = await explainTopic(OPENROUTER, "тема", "sk-test", FREE_AUTO, impl);
  assert.deepEqual(out, { levels: SAMPLE, model: "google/gemma-4-31b-it:free" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_URL);
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
});

test("explainTopic через Anthropic: один запит, свої заголовки, блоки роздумів пропущено", async () => {
  const { impl, calls } = fakeFetch(200, {
    type: "message",
    model: "claude-haiku-5-5",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: JSON.stringify(SAMPLE) },
    ],
  });
  const out = await explainTopic(ANTHROPIC, "тема", "sk-ant-test", "claude-haiku-5-5", impl);
  assert.deepEqual(out, { levels: SAMPLE, model: "claude-haiku-5-5" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ANTHROPIC_URL);
  const { headers } = calls[0].options;
  assert.equal(headers["x-api-key"], "sk-ant-test");
  assert.equal(headers.Authorization, undefined);
  assert.ok(headers["anthropic-version"]);
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(JSON.parse(calls[0].options.body).model, "claude-haiku-5-5");
});

test("explainTopic перетворює помилки OpenRouter на зрозумілі повідомлення", async () => {
  const cases = [
    [fakeFetch(401, { error: { message: "No auth", code: 401 } }), /не прийняв ключ/],
    [fakeFetch(429, { error: { message: "rate", code: 429 } }), /перевантажена/],
    [fakeFetch(200, { error: { message: "Provider returned error", code: 429 } }), /перевантажена/],
    [fakeFetch(200, { choices: [{ message: { content: "" } }] }), /порожню відповідь/],
    [fakeFetch(200, { choices: [{ message: { content: "Не можу." } }] }), /не у форматі JSON/],
    [fakeFetch(500, { error: { message: "boom" } }), /помилку 500\. boom/],
  ];
  for (const [{ impl }, pattern] of cases) {
    await assert.rejects(explainTopic(OPENROUTER, "тема", "k", FREE_AUTO, impl), (error) => {
      assert.match(error.userMessage, pattern);
      return true;
    });
  }
});

test("explainTopic перетворює помилки Anthropic на зрозумілі повідомлення", async () => {
  const apiError = (type, message) => ({ type: "error", error: { type, message } });
  const cases = [
    [fakeFetch(401, apiError("authentication_error", "invalid x-api-key")), /Anthropic не прийняв ключ/],
    [fakeFetch(400, apiError("invalid_request_error", "Your credit balance is too low")), /немає коштів/],
    [fakeFetch(402, apiError("billing_error", "billing")), /немає коштів/],
    [fakeFetch(404, apiError("not_found_error", "model: claude-x")), /недоступна/],
    [fakeFetch(429, apiError("rate_limit_error", "rate")), /ліміт запитів/],
    [fakeFetch(529, apiError("overloaded_error", "Overloaded")), /перевантажений/],
    [fakeFetch(400, apiError("invalid_request_error", "bad field")), /помилку 400\. bad field/],
    [fakeFetch(200, { stop_reason: "refusal", content: [] }), /відмовилась/],
    [fakeFetch(200, { stop_reason: "max_tokens", content: [{ type: "text", text: '{"child":' }] }), /ліміт довжини/],
    [fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }] }), /порожню відповідь/],
  ];
  for (const [{ impl }, pattern] of cases) {
    await assert.rejects(explainTopic(ANTHROPIC, "тема", "k", "claude-haiku-5-5", impl), (error) => {
      assert.match(error.userMessage, pattern);
      return true;
    });
  }
});

test("explainTopic повідомляє про проблеми з мережею", async () => {
  const failing = async () => {
    throw new TypeError("Failed to fetch");
  };
  for (const [provider, model, name] of [
    [OPENROUTER, FREE_AUTO, /OpenRouter/],
    [ANTHROPIC, "claude-haiku-5-5", /Anthropic/],
  ]) {
    await assert.rejects(explainTopic(provider, "тема", "k", model, failing), (error) => {
      assert.match(error.userMessage, /з'єднатися/);
      assert.match(error.userMessage, name);
      return true;
    });
  }
});

test("errorText для невідомого статусу без деталей", () => {
  assert.equal(errorText(503, {}), "OpenRouter повернув помилку 503.");
  assert.equal(anthropicErrorText(503, {}), "Anthropic повернув помилку 503.");
});

test("example.json містить усі п'ять рівнів", async () => {
  const example = JSON.parse(await readFile(new URL("./example.json", import.meta.url), "utf8"));
  assert.ok(example.topic && example.model);
  assert.equal(Object.keys(parseLevels(JSON.stringify(example.levels))).length, 5);
});
