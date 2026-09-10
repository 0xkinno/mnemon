"""Local static preview for the deployed surface.

    python scripts/serve_app.py     ->  http://127.0.0.1:8080

The app/ directory is a static site; it is not part of the proof harness.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os

os.chdir(Path(__file__).resolve().parents[1] / "app")
ThreadingHTTPServer(("127.0.0.1", 8080), SimpleHTTPRequestHandler).serve_forever()