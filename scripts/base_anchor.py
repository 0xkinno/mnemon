import json, os, sys
from pathlib import Path
from dotenv import load_dotenv
from web3 import Web3
from solcx import compile_source, install_solc

ROOT=Path(__file__).resolve().parents[1]
load_dotenv(ROOT/".env.local")
RPC=os.getenv("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org")
w3=Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout":30}))
ABI=[{"anonymous":False,"inputs":[{"indexed":False,"internalType":"string","name":"entity","type":"string"},{"indexed":False,"internalType":"string","name":"epoch","type":"string"},{"indexed":False,"internalType":"bytes32","name":"claimHash","type":"bytes32"},{"indexed":False,"internalType":"string","name":"verdict","type":"string"},{"indexed":False,"internalType":"string","name":"operationId","type":"string"}],"name":"Anchored","type":"event"},{"inputs":[{"internalType":"string","name":"entity","type":"string"},{"internalType":"string","name":"epoch","type":"string"},{"internalType":"bytes32","name":"claimHash","type":"bytes32"},{"internalType":"string","name":"verdict","type":"string"},{"internalType":"string","name":"operationId","type":"string"}],"name":"anchor","outputs":[],"stateMutability":"nonpayable","type":"function"}]

def require_wallet():
    key=os.getenv("BASE_PRIVATE_KEY")
    if not key or key.startswith("replace_"): raise RuntimeError("Set BASE_PRIVATE_KEY in .env.local")
    return w3.eth.account.from_key(key)

def deploy():
    install_solc("0.8.20")
    source=(ROOT/"contracts/MnemonAnchor.sol").read_text()
    artifact=compile_source(source, output_values=["abi","bin"], solc_version="0.8.20")["<stdin>:MnemonAnchor"]
    acct=require_wallet(); c=w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bin"])
    tx=c.constructor().build_transaction({"from":acct.address,"nonce":w3.eth.get_transaction_count(acct.address),"chainId":84532,"gas":1000000,"maxFeePerGas":w3.to_wei(0.1,"gwei"),"maxPriorityFeePerGas":w3.to_wei(0.01,"gwei")})
    signed=acct.sign_transaction(tx); h=w3.eth.send_raw_transaction(signed.raw_transaction); receipt=w3.eth.wait_for_transaction_receipt(h)
    out={"contract_address":receipt.contractAddress,"deployment_tx":h.hex(),"block_number":receipt.blockNumber,"explorer":f"https://sepolia.basescan.org/tx/{h.hex()}"}; (ROOT/"proof/base_deployment.json").write_text(json.dumps(out,indent=2)); print(json.dumps(out,indent=2))

def anchor():
    acct=require_wallet(); address=os.getenv("MNEMON_ANCHOR_ADDRESS");
    if not address: raise RuntimeError("Set MNEMON_ANCHOR_ADDRESS in .env.local")
    entity=sys.argv[2] if len(sys.argv)>2 else "risk_verdict/protocol_x"; epoch=sys.argv[3] if len(sys.argv)>3 else "epoch-proof"; claim=sys.argv[4] if len(sys.argv)>4 else "0x"+"00"*32; verdict=sys.argv[5] if len(sys.argv)>5 else "CLEAN"; op=sys.argv[6] if len(sys.argv)>6 else "op-proof"
    c=w3.eth.contract(address=Web3.to_checksum_address(address),abi=ABI); tx=c.functions.anchor(entity,epoch,bytes.fromhex(claim[2:]),verdict,op).build_transaction({"from":acct.address,"nonce":w3.eth.get_transaction_count(acct.address),"chainId":84532,"gas":200000,"maxFeePerGas":w3.to_wei(0.1,"gwei"),"maxPriorityFeePerGas":w3.to_wei(0.01,"gwei")}); signed=acct.sign_transaction(tx); h=w3.eth.send_raw_transaction(signed.raw_transaction); receipt=w3.eth.wait_for_transaction_receipt(h); logs=c.events.Anchored().process_receipt(receipt); out={"tx_hash":h.hex(),"block_number":receipt.blockNumber,"event":dict(logs[0]["args"]) if logs else None,"explorer":f"https://sepolia.basescan.org/tx/{h.hex()}"}; (ROOT/"proof/base_transaction.json").write_text(json.dumps(out,default=str,indent=2)); print(json.dumps(out,default=str,indent=2))

if __name__=="__main__": deploy() if len(sys.argv)>1 and sys.argv[1]=="deploy" else anchor()

