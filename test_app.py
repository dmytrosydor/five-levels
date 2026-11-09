"""Перевірки розбору відповіді моделі та побудови HTML. Запуск: pytest test_app.py"""

import json

import pytest

import app

LEVELS = {key: f"Пояснення для рівня {key}." for key, _, _ in app.LEVELS}


def test_parse_plain_json():
    assert app.parse_levels(json.dumps(LEVELS)) == LEVELS


def test_parse_drops_intro_and_markdown_fence():
    raw = "Звичайно, ось пояснення:\n```json\n" + json.dumps(LEVELS) + "\n```\nСподіваюся, допомогло!"
    assert app.parse_levels(raw) == LEVELS


def test_parse_rejects_missing_level():
    broken = {k: v for k, v in LEVELS.items() if k != "expert"}
    with pytest.raises(ValueError, match="expert"):
        app.parse_levels(json.dumps(broken))


def test_parse_rejects_text_without_json():
    with pytest.raises(ValueError):
        app.parse_levels("Вибач, я не можу відповісти.")


def test_parse_rejects_empty_and_non_string_values():
    for bad in ("   ", 5, None, ["текст"]):
        with pytest.raises(ValueError):
            app.parse_levels(json.dumps({**LEVELS, "child": bad}))


def test_render_escapes_html_and_template_syntax():
    levels = {**LEVELS, "child": "<script>alert(1)</script> {{x}} ${y}"}
    page = app.render("<b>тема</b>", levels, "примітка")
    assert "<script>" not in page and "<b>тема</b>" not in page
    assert "{{" not in page and "${" not in page
    assert page.count('class="fl-panel"') == 5


def test_plural_forms():
    forms = ("слово", "слова", "слів")
    assert [app.plural(n, *forms) for n in (1, 2, 5, 11, 12, 21, 22, 25, 111)] == [
        "слово", "слова", "слів", "слів", "слів", "слово", "слова", "слів", "слів",
    ]


def test_text_stats_counts_words_and_sentences():
    assert app.text_stats("Це перше речення. А це друге, довше речення!") == (
        "8 слів · у середньому 4 слова у реченні"
    )


def test_example_file_is_valid():
    page = app.show_example()
    assert page.count('class="fl-panel"') == 5
