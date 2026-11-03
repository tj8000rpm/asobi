"""Run every game's browser test page using an installed Chromium browser."""
import argparse
import functools
import http.server
import os
import shutil
import subprocess
import tempfile
import threading
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.passed = False

    def handle_starttag(self, tag, attrs):
        if tag == 'body':
            self.passed = dict(attrs).get('data-status') == 'passed'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', default=os.environ.get('CHROME_BIN'))
    args = parser.parse_args()
    browser = args.browser or next((shutil.which(name) for name in ['google-chrome', 'chromium', 'chromium-browser'] if shutil.which(name)), None)
    if not browser:
        parser.error('Chromium系ブラウザを指定してください: --browser /path/to/chrome')
    pages = sorted((ROOT / 'games').glob('*/tests/index.html'))
    if not pages:
        parser.error('ブラウザテストが見つかりません')
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    except OSError as error:
        parser.exit(1, f'ブラウザテスト用のローカルサーバーを起動できません: {error}\n')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    failures = 0
    try:
        for page in pages:
            url = f'http://127.0.0.1:{server.server_port}/{page.relative_to(ROOT).as_posix()}'
            try:
                with tempfile.TemporaryDirectory(prefix='asobi-chrome-') as profile:
                    result = subprocess.run([browser, '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
                                             f'--user-data-dir={profile}', '--dump-dom', url], capture_output=True, text=True, timeout=45)
            except (OSError, subprocess.TimeoutExpired) as error:
                failures += 1
                print(f'FAIL {page.relative_to(ROOT)}: {error}')
                continue
            parsed = ResultParser()
            parsed.feed(result.stdout)
            if result.returncode != 0 or not parsed.passed:
                failures += 1
                print(f'FAIL {page.relative_to(ROOT)}\n{result.stderr}\n{result.stdout}')
            else:
                print(f'PASS {page.relative_to(ROOT)}')
    finally:
        server.shutdown()
        server.server_close()
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
