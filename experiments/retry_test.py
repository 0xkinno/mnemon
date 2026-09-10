import json
from scenarios import run
print(json.dumps(run()["retry"], indent=2, sort_keys=True))

