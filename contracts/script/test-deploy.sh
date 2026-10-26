#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

image=ghcr.io/foundry-rs/foundry:v1.5.0
name="yen16-anvil-$$"
cleanup() {
  podman rm --force "$name" >/dev/null 2>&1 || true
  podman network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Cache the pinned compiler before disconnecting the deployment from the internet.
podman run --rm --userns=keep-id --entrypoint sh \
  -v "$PWD/contracts:/work:Z" -w /work "$image" -c \
  'forge build --skip test --skip script && cp /home/foundry/.svm/0.8.30/solc-0.8.30 cache/solc-0.8.30'
mkdir -p contracts/broadcast/local
podman network create --internal "$name" >/dev/null
podman run --detach --name "$name" --network "$name" --userns=keep-id \
  --entrypoint anvil -v "$PWD/contracts:/work:Z" -w /work \
  -p 127.0.0.1::8545 "$image" --host 0.0.0.0 --chain-id 31337 >/dev/null
for attempt in {1..30}; do
  if podman exec "$name" cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
# This key comes only from this disposable Anvil instance's printed test accounts.
throwaway_key=$(podman logs "$name" | awk '
  /Private Keys/ { keys=1 }
  keys && /^\(0\)/ { print $2; keys=0 }
')
test -n "$throwaway_key"
publisher=0x000000000000000000000000000000000000bEEF
deploy() {
  podman exec --env AMOY_RPC_URL=http://127.0.0.1:8545 \
    --env ROOT_REGISTRY_PUBLISHER="$publisher" \
    --env THROWAWAY_PRIVATE_KEY="$throwaway_key" "$name" sh -c \
    'forge script script/Deploy.s.sol:Deploy --use cache/solc-0.8.30 --offline \
      --rpc-url amoy --private-key "$THROWAWAY_PRIVATE_KEY" --broadcast'
}
if deploy >contracts/broadcast/local/wrong-chain.log 2>&1; then
  echo 'Deployment unexpectedly accepted chain 31337' >&2
  exit 1
fi
grep -F 'WrongChain(31337' contracts/broadcast/local/wrong-chain.log
podman exec "$name" cast rpc --rpc-url http://127.0.0.1:8545 anvil_setChainId 80002
deploy
unset throwaway_key

export AMOY_RPC_URL="http://$(podman port "$name" 8545/tcp)"
export ROOT_REGISTRY_PUBLISHER="$publisher"
broadcast=contracts/broadcast/Deploy.s.sol/80002/run-latest.json
manifest=contracts/broadcast/local/manifest.json
cp contracts/deployments/amoy.schema.json contracts/broadcast/local/amoy.schema.json
node contracts/script/write-manifest.mjs "$broadcast" "$manifest"
cat "$manifest"

bad_manifest=contracts/broadcast/local/rejected-manifest.json
rm -f "$bad_manifest"
if ROOT_REGISTRY_PUBLISHER=0x0000000000000000000000000000000000000001 \
  node contracts/script/write-manifest.mjs "$broadcast" "$bad_manifest" \
    >contracts/broadcast/local/wrong-publisher.log 2>&1; then
  echo 'Manifest unexpectedly accepted a different publisher' >&2
  exit 1
fi
grep -F 'Creation bytecode or constructor publisher differs from the build' \
  contracts/broadcast/local/wrong-publisher.log
test ! -e "$bad_manifest"
echo 'Local deployment verified; wrong chain and wrong publisher rejected. No Amoy RPC was used.'
