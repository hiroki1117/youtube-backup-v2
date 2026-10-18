import csv
import os
import zipfile
from importlib.metadata import distributions

from build_lambda import normalize_target, write_archive


def test_archive_ignores_checkout_path_wheel_provenance_and_file_metadata(tmp_path):
    archives = []
    for run in (1, 2):
        target = tmp_path / f"checkout-{run}"
        package = target / "example"
        package.mkdir(parents=True)
        (package / "__init__.py").write_text("VALUE = 1\n")
        metadata = target / "example-1.0.dist-info"
        metadata.mkdir()
        (metadata / "METADATA").write_text("Metadata-Version: 2.1\nName: example\nVersion: 1.0\n")
        (metadata / "direct_url.json").write_text(f'{{"url":"file:///checkout-{run}/wheel.whl"}}')
        (target / "bin").mkdir()
        (target / "bin" / "example").write_text(f"#!/checkout-{run}/venv/bin/python\n")
        rows = [
            ["example/__init__.py", "", ""],
            ["example-1.0.dist-info/METADATA", "", ""],
            ["example-1.0.dist-info/RECORD", "", ""],
            ["example-1.0.dist-info/direct_url.json", f"sha256=wheel-{run}", "10"],
            ["../../bin/example", f"sha256=script-{run}", "10"],
        ]
        with (metadata / "RECORD").open("w", newline="") as output:
            csv.writer(output).writerows(rows if run == 1 else reversed(rows))
        for path in target.rglob("*"):
            os.utime(path, (run * 100000000, run * 100000000))
            if path.is_file():
                path.chmod(0o644 if run == 1 else 0o600)
        normalize_target(target)
        installed = list(distributions(path=[str(target)]))
        assert len(installed) == 1 and installed[0].version == "1.0"
        assert len(installed[0].files) == 3
        archive = tmp_path / f"candidate-{run}.zip"
        write_archive(target, archive)
        archives.append(archive.read_bytes())
        with zipfile.ZipFile(archive) as contents:
            assert set(contents.namelist()) == {
                "example/__init__.py",
                "example-1.0.dist-info/METADATA",
                "example-1.0.dist-info/RECORD",
            }
    assert archives[0] == archives[1]
