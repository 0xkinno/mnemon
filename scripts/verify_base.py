import json
from pathlib import Path
from dotenv import load_dotenv
from web3 import Web3
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from base_anchor import ABI, RPC

ROOT=Path(__file__).resolve().parents[1]
load_dotenv(ROOT/".env.local")
w3=Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout":30}))
proof=json.loads((ROOT/"proof/base_transaction.json").read_text())
deployment=json.loads((ROOT/"proof/base_deployment.json").read_text())
contract=w3.eth.contract(address=deployment["contract_address"], abi=ABI)
receipt=w3.eth.get_transaction_receipt(proof["tx_hash"])
logs=contract.events.Anchored().process_receipt(receipt)
args=logs[0]["args"]
out={"chain_id":w3.eth.chain_id,"tx_hash":proof["tx_hash"],"receipt_status":receipt.status,"block_number":receipt.blockNumber,"contract_address":deployment["contract_address"],"decoded_event":{"entity":args["entity"],"epoch":args["epoch"],"claimHash":"0x"+bytes(args["claimHash"]).hex(),"verdict":args["verdict"],"operationId":args["operationId"]},"claim_hash_matches":"0x"+bytes(args["claimHash"]).hex()=="0x0067fa32186694de0700069e9aa469d05681839573ef7bd211ea026c8a0dfd27"}
(ROOT/"proof/base_transaction_verified.json").write_text(json.dumps(out,indent=2)); print(json.dumps(out,indent=2))
