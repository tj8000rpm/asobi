import json
import re
import tempfile
import unittest
from urllib.parse import urljoin, urlparse
from pathlib import Path
from scripts.build import ROOT, build

GAME = {'id': 'sample', 'title': '<hello>', 'description': '"test" & play', 'icon': '✈'}


class BuildTests(unittest.TestCase):
    def folder(self):
        temporary = tempfile.TemporaryDirectory(prefix='asobi-build-')
        self.addCleanup(temporary.cleanup)
        return Path(temporary.name)

    def fixture(self, games):
        root = self.folder()
        (root / 'site').mkdir()
        (root / 'site/index.html').write_text('<!-- GAME_CARDS -->', encoding='utf-8')
        (root / 'games.json').write_text(json.dumps(games), encoding='utf-8')
        return root

    def public(self, root, game_id='sample'):
        directory = root / 'games' / game_id / 'public'
        directory.mkdir(parents=True)
        (directory / 'index.html').write_text('hello', encoding='utf-8')
        return directory

    def test_public_files_only_and_valid_relative_assets(self):
        output = self.folder() / 'dist'
        build(output=output)
        self.assertEqual(sorted(p.name for p in output.iterdir()), ['airport', 'index.html'])
        self.assertEqual(sorted(p.name for p in (output / 'airport').iterdir()), ['game.js', 'index.html', 'simulation.js', 'style.css'])
        self.assertIn('./airport/index.html', (output / 'index.html').read_text(encoding='utf-8'))
        source = (output / 'airport/index.html').read_text(encoding='utf-8')
        for reference in re.findall(r'(?:src|href)="([^"#]+)"', source):
            self.assertTrue((output / 'airport' / reference).is_file(), reference)

    def test_github_pages_project_subpath_resolves_assets_and_game_links(self):
        output = self.folder() / 'dist'
        build(output=output)
        for page in output.rglob('*.html'):
            page_url = 'https://example.github.io/asobi/' + page.relative_to(output).as_posix()
            for reference in re.findall(r'(?:src|href)="([^"#]+)"', page.read_text(encoding='utf-8')):
                target = urlparse(urljoin(page_url, reference))
                self.assertEqual(target.netloc, 'example.github.io')
                self.assertTrue(target.path.startswith('/asobi/'))
                self.assertTrue((output / target.path.removeprefix('/asobi/')).is_file(), reference)

    def test_rebuild_removes_stale_output_and_is_repeatable(self):
        output = self.folder() / 'dist'
        build(output=output)
        before = {p.relative_to(output): p.read_bytes() for p in output.rglob('*') if p.is_file()}
        (output / 'stale.txt').write_text('old')
        build(output=output)
        self.assertEqual(before, {p.relative_to(output): p.read_bytes() for p in output.rglob('*') if p.is_file()})

    def test_multiple_games_escaping_and_hidden_files(self):
        root = self.fixture([GAME, {**GAME, 'id': 'second'}])
        public = self.public(root)
        (public / '.env').write_text('private')
        self.public(root, 'second')
        result = build(root=root)
        self.assertEqual(result['games'], ['sample', 'second'])
        self.assertEqual(sorted(p.name for p in (result['output'] / 'sample').iterdir()), ['index.html'])
        self.assertIn('&lt;hello&gt;', (result['output'] / 'index.html').read_text(encoding='utf-8'))

    def test_bad_registry_is_rejected(self):
        for games in [[], {}, [None], [{**GAME, 'id': '../escape'}], [GAME, GAME], [{**GAME, 'title': ''}]]:
            with self.subTest(games=games), self.assertRaises(ValueError):
                build(root=self.fixture(games))

    def test_missing_entrypoint_is_rejected(self):
        root = self.fixture([GAME])
        public = self.public(root)
        (public / 'index.html').unlink()
        with self.assertRaises(ValueError):
            build(root=root)

    def test_public_symlinks_are_rejected(self):
        root = self.fixture([GAME])
        public = self.public(root)
        (public / 'leak.json').symlink_to(root / 'games.json')
        with self.assertRaisesRegex(ValueError, 'シンボリックリンク'):
            build(root=root)

    def test_unsafe_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'dist'):
            build(output=ROOT)
        directory = self.folder()
        (directory / 'dist').symlink_to(directory, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'dist'):
            build(output=directory / 'dist')

    def test_invalid_build_preserves_previous_output(self):
        root = self.fixture([GAME])
        self.public(root)
        output = build(root=root)['output']
        (root / 'games.json').write_text('[]')
        with self.assertRaises(ValueError):
            build(root=root)
        self.assertTrue((output / 'sample/index.html').is_file())


if __name__ == '__main__':
    unittest.main()
