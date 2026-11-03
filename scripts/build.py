"""Collect each game's public files without third-party dependencies."""
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def collect(directory, prefix=Path()):
    files = []
    for entry in sorted(directory.iterdir()):
        if entry.name.startswith('.'):
            continue
        relative = prefix / entry.name
        if entry.is_symlink():
            raise ValueError(f'公開フォルダのシンボリックリンクは使用できません: {entry}')
        if entry.is_dir():
            files.extend(collect(entry, relative))
        elif entry.is_file():
            files.append((entry, relative))
        else:
            raise ValueError(f'通常のファイルではありません: {entry}')
    return files


def build(root=ROOT, output=None):
    root = Path(root).resolve()
    output = Path(output).absolute() if output is not None else root / 'dist'
    resolved = output.resolve()
    if output.name != 'dist' or resolved == root or resolved in root.parents or output.is_symlink():
        raise ValueError('出力先には専用の dist ディレクトリを指定してください')
    games = json.loads((root / 'games.json').read_text(encoding='utf-8'))
    if not isinstance(games, list) or not games:
        raise ValueError('games.json にゲームを登録してください')
    ids, files = set(), []
    for game in games:
        game_id = game.get('id') if isinstance(game, dict) else None
        if not isinstance(game_id, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', game_id) or game_id in ids:
            raise ValueError('ゲームIDが不正または重複しています')
        for key in ['title', 'description', 'icon']:
            if not isinstance(game.get(key), str) or not game[key].strip():
                raise ValueError(f'{game_id}: {key} が必要です')
        ids.add(game_id)
    for game in games:
        game_id = game['id']
        source = root / 'games' / game_id / 'public'
        if any(entry.is_symlink() for entry in [source, source.parent, source.parent.parent]):
            raise ValueError('ゲームの公開元には実ディレクトリを指定してください')
        public_files = collect(source)
        if not any(relative == Path('index.html') for _, relative in public_files):
            raise ValueError(f'{game_id}: public/index.html が必要です')
        files.extend((source_file, Path(game_id) / relative) for source_file, relative in public_files)
    template = (root / 'site/index.html').read_text(encoding='utf-8')
    if '<!-- GAME_CARDS -->' not in template:
        raise ValueError('一覧テンプレートの挿入位置がありません')
    cards = []
    for game in games:
        title, description, icon = (html.escape(game[key], quote=True) for key in ['title', 'description', 'icon'])
        cards.append(f'<a class="game-card" href="./{game["id"]}/index.html"><span class="game-icon" aria-hidden="true">{icon}</span><div><h2>{title}</h2><p>{description}</p></div><span class="arrow" aria-hidden="true">→</span></a>')
    # All inputs are validated before replacing the previous build.
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for source_file, relative in files:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_file, destination)
    (output / 'index.html').write_text(template.replace('<!-- GAME_CARDS -->', '\n'.join(cards)), encoding='utf-8')
    return {'output': output, 'games': [game['id'] for game in games], 'file_count': len(files) + 1}


if __name__ == '__main__':
    import sys
    try:
        result = build()
        print(f"Built {', '.join(result['games'])} → {result['output']} ({result['file_count']} files)")
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
