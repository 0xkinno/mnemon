from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
os.chdir(Path(__file__).parent)
ThreadingHTTPServer(("127.0.0.1", 8080), SimpleHTTPRequestHandler).serve_forever()

