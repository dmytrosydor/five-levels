# /// script
# requires-python = ">=3.10"
# dependencies = ["huggingface_hub"]
# ///
"""Розміщує застосунок на HuggingFace Spaces.

Запуск (спершу один раз увійти: uvx --from huggingface_hub hf auth login):
    uv run deploy.py

Викладаються лише файли з останнього коміту, тому .env з ключем у Space не потрапить.
"""

import subprocess
import tarfile
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

SPACE_NAME = "five-levels"
HERE = Path(__file__).parent


def main() -> None:
    api = HfApi()
    user = api.whoami()["name"]
    repo_id = f"{user}/{SPACE_NAME}"

    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "head.tar"
        subprocess.run(["git", "archive", "-o", str(archive), "HEAD"], cwd=HERE, check=True)
        folder = Path(tmp) / "space"
        with tarfile.open(archive) as tar:
            tar.extractall(folder)
        files = sorted(p.name for p in folder.iterdir())
        print(f"Space: {repo_id}\nФайли: {', '.join(files)}")

        api.create_repo(repo_id, repo_type="space", space_sdk="gradio", exist_ok=True)
        api.upload_folder(
            repo_id=repo_id,
            repo_type="space",
            folder_path=folder,
            commit_message="Deploy five-levels",
        )

    print(f"Готово: https://huggingface.co/spaces/{repo_id}")


if __name__ == "__main__":
    main()
