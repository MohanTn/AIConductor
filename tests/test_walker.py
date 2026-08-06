from __future__ import annotations

from pathlib import Path

from conftest import write
from hybrid_retrieval.index import classify_lang, discover, hash_bytes, hash_file
from hybrid_retrieval.index.walker import list_candidate_paths


def test_classify_lang():
    assert classify_lang("src/JwtService.cs") == "csharp"
    assert classify_lang("app/main.tsx") == "typescript"
    assert classify_lang("cmd/root.go") == "go"


def test_config_and_doc_files_are_indexable():
    """A dotfiles repo is mostly these; excluding them made most of it invisible."""
    assert classify_lang("install.sh") == "shell"
    assert classify_lang("nvim/init.lua") == "lua"
    assert classify_lang("pyproject.toml") == "toml"
    assert classify_lang("README.md") == "markdown"
    assert classify_lang(".bashrc") == "shell"
    assert classify_lang("image.png") is None


def test_discover_filters_to_known_languages(git_repo: Path):
    write(git_repo, "src/JwtService.cs", "class JwtService {}")
    write(git_repo, "src/app.ts", "export const x = 1;")
    write(git_repo, "README.md", "# docs")
    write(git_repo, "logo.png", b"\x89PNG\r\n\x1a\n")
    found = {r.path for r in discover(git_repo)}
    assert found == {"src/JwtService.cs", "src/app.ts", "README.md"}


def test_gitignore_is_honoured(git_repo: Path):
    write(git_repo, ".gitignore", "generated/\n")
    write(git_repo, "src/Real.cs", "class Real {}")
    write(git_repo, "generated/Fake.cs", "class Fake {}")
    assert {r.path for r in discover(git_repo)} == {"src/Real.cs"}


def test_nested_gitignore_is_honoured(git_repo: Path):
    write(git_repo, "src/Real.cs", "class Real {}")
    write(git_repo, "src/sub/.gitignore", "*.cs\n")
    write(git_repo, "src/sub/Hidden.cs", "class Hidden {}")
    assert {r.path for r in discover(git_repo)} == {"src/Real.cs"}


def test_always_ignored_dirs_excluded(git_repo: Path):
    write(git_repo, "src/Real.cs", "class Real {}")
    write(git_repo, "node_modules/pkg/index.ts", "export {};")
    write(git_repo, "obj/Debug/Temp.cs", "class Temp {}")
    assert {r.path for r in discover(git_repo)} == {"src/Real.cs"}


def test_binary_and_oversized_files_skipped(git_repo: Path):
    write(git_repo, "src/Real.cs", "class Real {}")
    write(git_repo, "src/Blob.cs", b"\x00\x01\x02binary")
    write(git_repo, "src/Huge.cs", "x" * 5000)
    found = {r.path for r in discover(git_repo, max_file_bytes=1000)}
    assert found == {"src/Real.cs"}


def test_record_fields_are_populated(git_repo: Path):
    body = "class JwtService {}"
    write(git_repo, "src/JwtService.cs", body)
    (record,) = list(discover(git_repo))
    assert record.lang == "csharp"
    assert record.size_bytes == len(body)
    assert record.content_hash == hash_bytes(body.encode())
    assert record.mtime > 0


def test_works_without_git(tmp_path: Path):
    write(tmp_path, "src/Real.cs", "class Real {}")
    write(tmp_path, "node_modules/x/y.ts", "export {};")
    assert {r.path for r in discover(tmp_path)} == {"src/Real.cs"}


def test_candidate_paths_are_repo_relative_posix(git_repo: Path):
    write(git_repo, "src/deep/Nested.cs", "class N {}")
    assert "src/deep/Nested.cs" in list_candidate_paths(git_repo)


def test_hashing_is_stable_and_content_addressed(tmp_path: Path):
    a = write(tmp_path, "a.txt", "hello")
    b = write(tmp_path, "b.txt", "hello")
    c = write(tmp_path, "c.txt", "hellO")
    assert hash_file(a) == hash_file(b) == hash_bytes(b"hello")
    assert hash_file(c) != hash_file(a)
